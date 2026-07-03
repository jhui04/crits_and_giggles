import os
import json
import re
import time
import random
import argparse
import sys

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass
from bs4 import BeautifulSoup
from urllib.parse import urljoin
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from scraper_base import ScraperManager, RequestLimitExceeded

STATE_FILE = "tools/state/magic_item_scraper_state.json"
DATA_FILE = "public/data/magic_items.json"
BASE_URL = "https://www.dndbeyond.com"

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

SOURCE_EXCEPTIONS = {
    "Monstrous Compendium Vol. 1: Spelljammer Creatures": "Spelljammer: Adventures in Space",
    "Spelljammer: Adventures in Space Boo’s Astral Menagerie": "Spelljammer: Adventures in Space",
    "Monster Manual": "Monster Manual (2014)"
}

def clean_source_name(raw_source):
    s = re.sub(r'(?i),*\s*p(?:age|g)?\.?\s*\d+', '', raw_source).strip(', ')
    s = s.split('•')[0].strip()
    if s in SOURCE_EXCEPTIONS:
        s = SOURCE_EXCEPTIONS[s]
    return s

def parse_details_string(details_str):
    res = {
        'type': 'Unknown',
        'rarity': 'Unknown',
        'requires_attunement': False,
        'attunement_notes': ''
    }
    
    if not details_str:
        return res
        
    details_str_lower = details_str.lower()
    
    # 1. Check for attunement
    if 'requires attunement' in details_str_lower:
        res['requires_attunement'] = True
        # Extract what is in the parentheses or after 'requires attunement'
        match = re.search(r'requires attunement([^)]*)', details_str_lower)
        if match:
            att_notes = match.group(1).strip()
            if att_notes.startswith('by '):
                res['attunement_notes'] = 'requires attunement ' + att_notes.strip()
            else:
                res['attunement_notes'] = 'requires attunement'
        else:
            res['attunement_notes'] = 'requires attunement'
    
    # 2. Extract rarity
    rarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies']
    found_rarity = 'Unknown'
    for r in rarities:
        if re.search(r'\b' + r + r'\b', details_str_lower):
            found_rarity = r.capitalize()
            if r == 'very rare':
                found_rarity = 'Very Rare'
            break
    res['rarity'] = found_rarity
    
    # 3. Extract type
    parts = details_str.split(',')
    if parts:
        first_part = parts[0].strip()
        type_match = re.match(r'^([^(]+)', first_part)
        if type_match:
            res['type'] = type_match.group(1).strip()
            
    return res

def parse_magic_item_detail_html(html_content, url=""):
    soup = BeautifulSoup(html_content, 'html.parser')
    data = {}
    
    # Check if page redirected to a shop/marketplace page
    title_text = soup.find('title').get_text(strip=True) if soup.find('title') else ""
    is_redirected = "Marketplace" in title_text or "Shop" in title_text or "What's inside" in title_text or "Choose Your Plan" in title_text
    
    detail_content_div = soup.select_one('.detail-content')
    if not detail_content_div or is_redirected:
        raise ValueError("Magic item detail page is locked/unowned.")
        
    # We successfully loaded the details page
    
    # 1. Source
    source_el = detail_content_div.select_one('.source.item-source, .more-info-footer-source')
    if source_el:
        raw_source = clean_text(source_el.get_text().replace('Source:', '').strip())
        data['source'] = clean_source_name(raw_source)
    else:
        data['source'] = 'Unknown'
        
    # 2. Type, Rarity, Attunement details
    details_span = detail_content_div.select_one('.item-info .details span')
    details_str = clean_text(details_span.get_text()) if details_span else ""
    parsed = parse_details_string(details_str)
    data.update(parsed)
    
    # 3. Description (as a list of LoreItem structures)
    desc_div = detail_content_div.select_one('.more-info-content')
    if desc_div:
        description_items = []
        for child in desc_div.children:
            if child.name == 'p':
                # Skip the notes-string paragraph to prevent duplicating it in the description list
                if child.has_attr('class') and 'notes-string' in child['class']:
                    continue
                text = clean_text(child.get_text())
                if text:
                    description_items.append(text)
            elif child.name in ['ul', 'ol']:
                items = [clean_text(li.get_text()) for li in child.find_all('li') if clean_text(li.get_text())]
                if items:
                    description_items.append({"type": "list", "items": items})
            elif child.name == 'table':
                rows = []
                for tr in child.find_all('tr'):
                    cells = [clean_text(td.get_text()) for td in tr.find_all(['td', 'th'])]
                    if any(cells):
                        rows.append(cells)
                if rows:
                    description_items.append({"type": "table", "rows": rows})
        data['description'] = description_items
        data['html_description'] = str(desc_div)
    else:
        data['description'] = []
        data['html_description'] = ""
        
    # 4. Notes (clean standard list values)
    notes_el = detail_content_div.select_one('.notes-string')
    if notes_el:
        notes_text = clean_text(notes_el.get_text())
        if notes_text.lower().startswith('notes:'):
            notes_text = notes_text[6:].strip()
        data['notes'] = notes_text
        
    # 5. Tags
    tags = []
    for tag_el in detail_content_div.select('.tags.item-tags .tag.item-tag'):
        tags.append(clean_text(tag_el.get_text()))
    data['tags'] = tags
    
    return data

def validate_magic_item(html_content, url):
    try:
        detail_data = parse_magic_item_detail_html(html_content, url)
        return True, detail_data.get('source', 'Unknown')
    except ValueError:
        return False, 'Unknown'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Reparse all assets starting from page 1, preserving persistent state lists')
    parser.add_argument('--reset-state', action='store_true', help='Ignore persistent state entirely, starting with a clean/blank state')
    parser.add_argument('--offline', action='store_true', help='Do not make web requests. Only process cached files.')
    parser.add_argument('--limit', type=int, default=1000, help='Limit the number of HTTP requests to make during this run')
    args = parser.parse_args()

    manager = ScraperManager(
        cache_dir="dnd_beyond/magic_items",
        state_file=STATE_FILE,
        validate_asset_fn=validate_magic_item,
        offline=args.offline,
        force=args.force,
        reset_state=args.reset_state,
        max_requests=args.limit
    )

    try:
        # Load existing magic items
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                all_items = json.load(f)
        else:
            all_items = []

        # Deduplicate existing items by ID, excluding locked items
        unique_items = {}
        for item in all_items:
            if "id" in item and not item.get('is_locked'):
                unique_items[item["id"]] = item
        all_items = list(unique_items.values())

        if len(all_items) > 0:
            os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(all_items, f, indent=2)

        success_count = 0
        current_page = manager.state["last_page"]
        previous_page_items = set()

        print(f"Starting scraper. Limit: {args.limit} requests.")

        try:
            while True:
                url = f"{BASE_URL}/magic-items?filter-partnered-content=t&page={current_page}"
                page_html = manager.get_list_page(url, current_page)
                if not page_html:
                    break

                soup = BeautifulSoup(page_html, 'html.parser')
                item_rows = soup.select('.listing-rpgmagic-item .info')
                
                if not item_rows:
                    print(f"No more items found on page {current_page}.")
                    break

                current_page_items = set()
                for row in item_rows:
                    name_elem = row.select_one('.item-name .name a')
                    if name_elem:
                        current_page_items.add(name_elem.get_text(strip=True))

                if current_page_items == previous_page_items and len(current_page_items) > 0:
                    print(f"Page {current_page} has the exact same items as the previous page. End of list reached.")
                    break
                    
                previous_page_items = current_page_items

                for row in item_rows:
                    name_link = row.select_one('.item-name .name a')
                    if not name_link:
                        continue

                    item_name = clean_text(name_link.get_text())
                    href = name_link.get('href', '')
                    item_url = urljoin(BASE_URL, href)

                    if item_url in manager.state.get("unowned_urls", []):
                        print(f"Skipping '{item_name}' (marked as unowned in state)")
                        continue

                    # ID and Slug from URL
                    id_match = re.search(r'/magic-items/(\d+)-([^/]+)', href)
                    if id_match:
                        item_id = id_match.group(1)
                        item_slug = id_match.group(2)
                    else:
                        item_id = slugify(item_name)
                        item_slug = slugify(item_name)

                    # Rarity
                    rarity_el = row.select_one('.item-name .rarity')
                    item_rarity = clean_text(rarity_el.get_text()) if rarity_el else 'Unknown'

                    # Type
                    type_el = row.select_one('.item-type .type')
                    item_type = clean_text(type_el.get_text()) if type_el else 'Unknown'

                    # Subtype
                    subtype_el = row.select_one('.item-type .subtype')
                    item_subtype = clean_text(subtype_el.get_text()) if subtype_el else ''

                    # Attunement
                    attunement_el = row.select_one('.requires-attunement')
                    att_text = clean_text(attunement_el.get_text()) if attunement_el else ''
                    requires_att = False
                    att_notes = ''
                    if att_text and att_text not in ['•', '—', '–', '-', '——', '']:
                        requires_att = True
                        att_notes = att_text

                    # Notes (extra row info)
                    notes_el = row.select_one('.notes')
                    item_notes = clean_text(notes_el.get_text()) if notes_el else ''

                    # Check if item is already in json
                    already_in_json = False
                    target_idx = -1
                    for idx, item in enumerate(all_items):
                        if item.get('id') == item_id:
                            already_in_json = True
                            target_idx = idx
                            break

                    html_content = manager.get_asset_html(item_slug, item_url)
                    if html_content is None:
                        if already_in_json:
                            all_items = [x for x in all_items if x.get('id') != item_id]
                            print(f"Removed '{item_name}' from JSON.")
                            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                                json.dump(all_items, f, indent=2)
                        continue

                    # Prepare baseline item dictionary
                    item_data = {
                        "id": item_id,
                        "name": item_name,
                        "url": item_url,
                        "slug": slugify(item_name),
                        "type": item_type,
                        "subtype": item_subtype,
                        "rarity": item_rarity,
                        "requires_attunement": requires_att,
                        "attunement_notes": att_notes,
                        "notes": item_notes,
                        "tags": [],
                        "source": "Unknown",
                        "description": [],
                        "html_description": "",
                        "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    }

                    try:
                        # Parse the detailed HTML
                        detail_data = parse_magic_item_detail_html(html_content, item_url)

                        # Merge list-level metadata and detail-level metadata for unlocked items
                        for key, val in detail_data.items():
                            if val is not None and val != "Unknown" and val != "":
                                # Overwrite baseline with details page info if detailed page info is valid
                                item_data[key] = val

                        # Save to JSON
                        if already_in_json:
                            all_items[target_idx] = item_data
                            print(f"Updated '{item_name}' ({item_data['source']}) in JSON.")
                        else:
                            all_items.append(item_data)
                            print(f"Successfully scraped '{item_name}' ({item_data['source']}).")
                            success_count += 1

                        # Save to file after each item to prevent loss
                        os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
                        with open(DATA_FILE, 'w', encoding='utf-8') as f:
                            json.dump(all_items, f, indent=2)
                    except Exception as e:
                        print(f"Failed to parse '{item_name}': {e}")
                        if already_in_json:
                            all_items = [x for x in all_items if x.get('id') != item_id]
                            print(f"Removed '{item_name}' from JSON due to parsing failure.")
                            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                                json.dump(all_items, f, indent=2)

                current_page += 1
                manager.state["last_page"] = current_page
                manager.save_state()

        except RequestLimitExceeded as e:
            print(f"Stopping scraper: {e}")

        manager.state["last_page"] = current_page
        manager.save_state()
        print(f"Scrape run complete. Scraped {success_count} items. Total items in dataset: {len(all_items)}")

    finally:
        manager.close_playwright()

if __name__ == "__main__":
    main()
