import os
import json
import re
import time
import random
import argparse
import uuid
import sys
from bs4 import BeautifulSoup
from urllib.parse import urljoin

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from scraper_base import ScraperManager, RequestLimitExceeded, ChromeConnectionError

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(ROOT_DIR, "tools/state/world_scraper_state.json")
DATA_FILE = os.path.join(ROOT_DIR, "public/data/scraped_world.json")
URL_FILE = os.path.join(ROOT_DIR, "url.txt")
MAPPING_FILE = os.path.join(ROOT_DIR, "tools/state/wildemount_asset_ids.json")
WILDEMOUNT_WORLD_ID = "4a2b9c3d-1e5f-4a7b-8c9d-1e5f4a7b8c9d"


def slugify(text):
    text = text.lower()
    text = re.sub(r'[\\/]+', '-', text)
    text = re.sub(r'[:*?"<>|]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def validate_world_page(html_content, url):
    soup = BeautifulSoup(html_content, 'html.parser')
    # Valid pages should contain an article or main body content block
    is_valid = (soup.select_one('.p-article-content') is not None or 
                soup.select_one('article') is not None or 
                soup.select_one('.primary-content') is not None)
    return is_valid, "Explorer's Guide to Wildemount"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Reparse all chapters, preserving state lists')
    parser.add_argument('--reset-state', action='store_true', help='Ignore persistent state entirely')
    parser.add_argument('--offline', action='store_true', help='Do not make web requests. Only process cached files.')
    parser.add_argument('--limit', type=int, default=10, help='Limit the number of HTTP requests to make during this run')
    args = parser.parse_args()

    base_url = "https://www.dndbeyond.com"
    if os.path.exists(URL_FILE):
        with open(URL_FILE, 'r', encoding='utf-8') as f:
            base_url = f.read().strip()

    manager = ScraperManager(
        cache_dir=os.path.join(ROOT_DIR, "dnd_beyond/egtw"),
        state_file=STATE_FILE,
        validate_asset_fn=validate_world_page,
        offline=args.offline,
        force=args.force,
        reset_state=args.reset_state,
        max_requests=args.limit
    )

    try:
        heading_logs = []
        # Load existing world or initialize new
        world_data = {
            "id": WILDEMOUNT_WORLD_ID,
            "name": "Wildemount",
            "description": "A continent of Exandria, home to the Dwendalian Empire, the Kryn Dynasty, and the Clovis Concord. It is a land of rich magic, ancient history, and brewing conflict.",
            "assets": []
        }

        # 1. Fetch EGTW Index to get chapter links
        index_url = f"{base_url}/sources/egtw"
        if "dndbeyond.com" not in base_url:
            # Under a mock/test server, try /sources/egtw or similar
            index_url = urljoin(base_url, "/sources/egtw")
            
        print(f"Fetching EGTW index page from {index_url}...")
        index_html = manager.get_list_page(index_url, 0)
        
        # If /sources/egtw fails or returns nothing, try /sources/dnd/egtw
        if not index_html and not args.offline:
            fallback_index_url = f"{base_url}/sources/dnd/egtw" if "dndbeyond.com" in base_url else urljoin(base_url, "/sources/dnd/egtw")
            print(f"Index fetch failed, trying fallback: {fallback_index_url}...")
            index_html = manager.get_list_page(fallback_index_url, 0)

        if not index_html:
            # Check if page0.html is cached under cache_dir
            page0_path = os.path.join(manager.cache_dir, "page0.html")
            if os.path.exists(page0_path):
                with open(page0_path, 'r', encoding='utf-8') as f:
                    index_html = f.read()
            else:
                print("Could not obtain index HTML. Exiting.")
                return

        soup = BeautifulSoup(index_html, 'html.parser')
        
        # Find chapter links
        chapter_links = []
        for a in soup.find_all('a'):
            href = a.get('href', '')
            if '/sources/egtw/' in href or '/sources/dnd/egtw/' in href:
                # Strip anchor tags to avoid duplicating the same page
                base_href = href.split('#')[0]
                full_url = urljoin(base_url, base_href)
                # Deduplicate and skip known non-world pages
                if full_url not in [link[1] for link in chapter_links]:
                    slug = base_href.split('/')[-1]
                    # Skip adventures (Ch 5), bestiary, treasures/magic items, etc.
                    if any(skip_word in slug for skip_word in ['adventures', 'bestiary', 'treasures', 'monsters', 'magic-items', 'spells']):
                        continue
                    chapter_links.append((clean_text(a.get_text()), full_url, slug))

        print(f"Found {len(chapter_links)} EGTW chapter pages to process.")

        overrides = manager.state.get("overrides", {})
        assets = []
        name_to_id = {}
        connections = []
        seen_ids = set()
        asset_counter = 0
        conn_counter = 0

        # List of location descriptors for tagging
        loc_indicators = [
            "city", "town", "village", "metropolis", "ruins", "fortress", "castle", "temple",
            "outpost", "island", "forest", "mountain", "river", "lake", "valley", "cave", "bay"
        ]

        # 2. Scrape and Parse Content by Chapter
        for title, url, slug in chapter_links:
            print(f"\nProcessing section: '{title}' ({slug})...")
            
            # Determine main asset type based on chapter / slug context
            primary_type = "Lore"
            if "faction" in slug or "faction" in title.lower():
                primary_type = "Faction"
            elif "gazetteer" in slug or "gazetteer" in title.lower() or "region" in slug:
                primary_type = "Location"
            elif "character-options" in slug or "options" in slug:
                primary_type = "CharacterOption" # Will specialize during parsing
            elif "pantheon" in slug or "religion" in slug or "pantheon" in title.lower():
                primary_type = "Religion"

            html = None
            try:
                html = manager.get_asset_html(slug, url)
            except RequestLimitExceeded:
                print("Request limit reached. Saving progress and stopping.")
                break
            except ChromeConnectionError as e:
                print(f"Fatal connection error: {e}")
                raise e
            except Exception as e:
                print(f"Failed to fetch {url}: {e}")
                continue

            if not html:
                continue

            chapter_soup = BeautifulSoup(html, 'html.parser')
            content_area = (chapter_soup.select_one('.p-article-content') or 
                            chapter_soup.select_one('article') or 
                            chapter_soup.select_one('.primary-content'))

            if not content_area:
                print(f"Warning: No content area found in {slug}")
                continue

            current_sub_section = None
            current_asset = None
            last_header_of_level = {}
            last_header_name_of_level = {}
            active_sub_section_overrides = {}

            # Parse elements sequentially to build descriptions and connections
            for child in content_area.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'table', 'blockquote']):
                text = clean_text(child.get_text())
                if not text:
                    continue

                if child.name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                    level = int(child.name[1])
                    
                    lower_text = text.lower().replace('’', "'").rstrip('?:.')

                    # 1. Clean up active overrides for levels >= current level
                    for l in list(active_sub_section_overrides.keys()):
                        if l >= level:
                            active_sub_section_overrides.pop(l)

                    # 2. Determine active parent override default (closest level < current level)
                    parent_override = None
                    for l in sorted(active_sub_section_overrides.keys(), reverse=True):
                        if l < level:
                            parent_override = active_sub_section_overrides[l]
                            break

                    # Clean up last header names for levels >= current level
                    for l in list(last_header_name_of_level.keys()):
                        if l >= level:
                            last_header_name_of_level.pop(l)

                    # Determine active parent heading name
                    parent_name = None
                    for l in sorted(last_header_name_of_level.keys(), reverse=True):
                        if l < level:
                            parent_name = last_header_name_of_level[l]
                            break

                    # Save the current header name
                    last_header_name_of_level[level] = text

                    # 3. Look up explicit override in JSON
                    heading_override = overrides.get(lower_text)
                    
                    heading_type = None
                    sub_section_default = None

                    if re.match(r"^areas \([a-z]-[a-z]\)$", lower_text):
                        heading_type = "SKIPPED"
                    elif parent_name and lower_text == parent_name.lower().replace('’', "'").rstrip('?:.'):
                        heading_type = "EMBEDDED"
                    elif heading_override:
                        heading_type = heading_override.get("type")
                        sub_section_default = heading_override.get("sub_section")
                    elif parent_override:
                        # Inherit from parent override if no explicit override is defined
                        heading_type = parent_override
                        sub_section_default = parent_override

                    # 4. Save the active sub_section_default for lower levels if defined
                    if sub_section_default is not None:
                        active_sub_section_overrides[level] = sub_section_default

                    # 5. Handle "SKIPPED" status
                    if heading_type == "SKIPPED":
                        current_asset = None
                        heading_logs.append(f"H{level} {text}: skipped")
                        continue

                    # Update sub-section context for Chapter 3 / Character Options or Religion
                    if primary_type == "CharacterOption" or "character-options" in slug:
                        if "race" in lower_text:
                            current_sub_section = "race"
                        elif "subclass" in lower_text or "class" in lower_text or "dunamancy" in lower_text:
                            current_sub_section = "class"
                        elif "background" in lower_text:
                            current_sub_section = "background"
                        elif "spell" in lower_text:
                            current_sub_section = "spell"
                    elif level == 3:
                        if primary_type == "Faction":
                            current_sub_section = None

                    # Skip spelling sections (covered elsewhere)
                    if current_sub_section == "spell":
                        current_asset = None
                        continue

                    # Skip main chapter page titles
                    if level == 1 and ("chapter" in text.lower() or text.lower() == title.lower()):
                        heading_logs.append(f"H{level} {text}: skipped")
                        continue

                    # Check if this header should just be appended to the current asset instead of creating a new one
                    compress_exact = {
                        "depiction", "enemies", "province", "provinces",
                        "goals", "relationships", "headquarters", "symbol", "sigil",
                        "demographics", "government", "defenses", "crime", "industry", "trade",
                        "geography", "climate", "traits", "ability score increase",
                        "age", "alignment", "size", "speed", "languages", "history", "culture",
                        "appearance", "society", "magic", "religion"
                    }
                    compress_starts_with = (
                        "commandments of", "holy day", "figures of interest", "adventures in"
                    )

                    lower_text_clean = text.lower().strip()
                    is_sub_section_to_compress = False
                    
                    # Sometimes traits include the race name like "Pallid Elf Traits"
                    if "traits" in lower_text_clean:
                        is_sub_section_to_compress = True
                    elif lower_text_clean in compress_exact:
                        is_sub_section_to_compress = True
                    elif lower_text_clean.endswith(" adventures"):
                        is_sub_section_to_compress = True
                    elif any(lower_text_clean.startswith(prefix) for prefix in compress_starts_with):
                        is_sub_section_to_compress = True

                    if current_asset and (is_sub_section_to_compress or heading_type == "EMBEDDED"):
                        # Append the header text as a markdown section inside the current asset
                        current_asset["description"] += f"### {text}\n\n"
                        heading_logs.append(f"H{level} {text}: embedded")
                        continue

                    # Special case for Religion, Location, and NPCs
                    if heading_type is not None:
                        asset_type = heading_type
                    else:
                        asset_type = primary_type
                        if current_sub_section == "faction":
                            asset_type = "Faction"
                        elif primary_type == "Religion" or current_sub_section == "religion" or "pantheon" in text.lower() or "deities" in text.lower():
                            asset_type = "Religion"
                        elif primary_type == "Location" or (current_sub_section == "location" and "calamity" not in text.lower()) or "gazetteer" in text.lower():
                            asset_type = "Location"
                        elif current_sub_section == "npc":
                            asset_type = "NPC"
                        elif primary_type == "CharacterOption" or "character-options" in slug:
                            if current_sub_section == "race":
                                asset_type = "Race"
                            elif current_sub_section == "class":
                                asset_type = "Class"
                            elif current_sub_section == "background":
                                asset_type = "Background"
                            else:
                                asset_type = "Lore"

                    # Generate auto-incrementing integer IDs
                    asset_counter += 1
                    asset_id = str(asset_counter)
                    seen_ids.add(asset_id)
                    
                    current_asset = {
                        "id": asset_id,
                        "type": asset_type,
                        "name": text,
                        "description": "",
                        "tags": [],
                        "connections": []
                    }
                    assets.append(current_asset)
                    name_to_id[text.lower()] = asset_id
                    heading_logs.append(f"H{level} {text}: {asset_type}")

                    # Establish Hierarchical Connections
                    last_header_of_level[level] = asset_id
                    # Clear lower levels
                    for l in list(last_header_of_level.keys()):
                        if l > level:
                            last_header_of_level.pop(l)

                    # Look for closest higher level parent in Gazetteer
                    if asset_type == "Location":
                        parent_id = None
                        for l in sorted(last_header_of_level.keys(), reverse=True):
                            if l < level:
                                parent_id = last_header_of_level[l]
                                break
                        if parent_id:
                            # Create connection: child is located in parent
                            conn_counter += 1
                            conn_id = str(conn_counter)
                            current_asset["connections"].append({
                                "id": conn_id,
                                "targetId": parent_id,
                                "relationship": "is located in"
                            })

                    parent_override = None
                    if active_sub_section_overrides:
                        closest_level = max(active_sub_section_overrides.keys())
                        parent_override = active_sub_section_overrides[closest_level]

                    if parent_override == "SKIPPED":
                        continue

                    if current_asset:
                        # Append description text
                        if child.name == 'p':
                            # Check for tags in first paragraph
                            if not current_asset["description"]:
                                # Look for city indicators: e.g. "(Small City)" or "Large City" in parentheses or italics
                                italic_elem = child.find('em') or child.find('i')
                                if italic_elem:
                                    italic_text = clean_text(italic_elem.get_text())
                                    for ind in loc_indicators:
                                        if ind in italic_text.lower():
                                            tag = italic_text.strip('() ')
                                            if tag and tag not in current_asset["tags"]:
                                                current_asset["tags"].append(tag)
                                # Regular patterns: "Nicodranas (Small City)..."
                                paren_match = re.search(r'\(([^)]+)\)', text[:100])
                                if paren_match:
                                    for ind in loc_indicators:
                                        if ind in paren_match.group(1).lower():
                                            tag = paren_match.group(1).strip()
                                            if tag and tag not in current_asset["tags"]:
                                                current_asset["tags"].append(tag)

                            current_asset["description"] += f"{text}\n\n"
                        elif child.name in ['ul', 'ol']:
                            list_items = []
                            for li in child.find_all('li'):
                                li_text = clean_text(li.get_text())
                                if li_text:
                                    list_items.append(li_text)
                                    # Capture sub-references or list tags if helpful
                            if list_items:
                                markdown_list = "\n".join([f"- {item}" for item in list_items])
                                current_asset["description"] += f"{markdown_list}\n\n"
                        elif child.name == 'table':
                            # Convert table to simple markdown string
                            rows = []
                            for tr in child.find_all('tr'):
                                cells = [clean_text(td.get_text()) for td in tr.find_all(['td', 'th'])]
                                if any(cells):
                                    rows.append(" | ".join(cells))
                            if rows:
                                current_asset["description"] += "\n".join(rows) + "\n\n"
                        else:
                            current_asset["description"] += f"{text}\n\n"

        # Cleanup whitespace on descriptions
        for as_item in assets:
            as_item["description"] = as_item["description"].strip()

        # 3. Pass 2: Establish Cross-Reference Connections
        print("\nPass 2: Analyzing cross-reference connections...")
        for asset_a in assets:
            desc_lower = asset_a["description"].lower()
            for name_b, id_b in name_to_id.items():
                if asset_a["id"] == id_b:
                    continue
                # Match full name with word boundaries
                if re.search(r'\b' + re.escape(name_b) + r'\b', desc_lower):
                    # Check if connection already exists
                    already_connected = any(c["targetId"] == id_b for c in asset_a["connections"])
                    if not already_connected:
                        conn_counter += 1
                        conn_id = str(conn_counter)
                        asset_a["connections"].append({
                            "id": conn_id,
                            "targetId": id_b,
                            "relationship": "references"
                        })

        world_data["assets"] = assets

        # 4. Save JSON outputs
        os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(world_data, f, indent=2)
        print(f"Saved {len(assets)} world assets to {DATA_FILE}")

        os.makedirs(os.path.dirname(MAPPING_FILE), exist_ok=True)
        with open(MAPPING_FILE, 'w', encoding='utf-8') as f:
            json.dump(name_to_id, f, indent=2)
        print(f"Saved asset-to-ID mapping dictionary to {MAPPING_FILE}")

        headings_file = os.path.join(ROOT_DIR, "tools/state/world_headings.txt")
        os.makedirs(os.path.dirname(headings_file), exist_ok=True)
        with open(headings_file, 'w', encoding='utf-8') as f:
            f.write("\n".join(heading_logs) + "\n")
        print(f"Saved heading parse logs to {headings_file}")

    finally:
        manager.close_playwright()

if __name__ == "__main__":
    main()
