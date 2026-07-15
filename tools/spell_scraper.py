import os
import json
import re
import time
import random
import argparse
import sqlite3
import sys
from bs4 import BeautifulSoup
from urllib.parse import urljoin

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from scraper_base import ScraperManager, RequestLimitExceeded, PageNotFoundError

# Set up utf-8 encoding for standard outputs if available
if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8')
    except: pass
if hasattr(sys.stderr, 'reconfigure'):
    try: sys.stderr.reconfigure(encoding='utf-8')
    except: pass

STATE_FILE = "tools/state/spell_scraper_state.json"
DATA_FILE = "public/data/spells.json"
DB_FILE = "tools/state/spells.sqlite3"
BASE_URL = "https://www.dndbeyond.com"

def slugify(text):
    text = text.lower()
    text = text.replace("'", "")
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-')

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

SOURCE_EXCEPTIONS = {
    "Monstrous Compendium Vol. 1: Spelljammer Creatures": "Spelljammer: Adventures in Space",
    "Spelljammer: Adventures in Space Boo’s Astral Menagerie": "Spelljammer: Adventures in Space",
    "Monster Manual": "Monster Manual (2014)",
    "Player \u0301s Handbook 2024": "Player's Handbook 2024",
    "Player \u0301s Handbook 2024 (BR)": "Player's Handbook 2024"
}

def clean_source_name(raw_source):
    s = re.sub(r'(?i),*\s*p(?:age|g)?\.?\s*\d+', '', raw_source).strip(', ')
    s = s.split('•')[0].strip()
    if s in SOURCE_EXCEPTIONS:
        s = SOURCE_EXCEPTIONS[s]
    return s

def parse_spell_html(html_content, url):
    soup = BeautifulSoup(html_content, 'html.parser')
    
    # Check if page redirected to a shop/marketplace page
    title_text = soup.find('title').get_text(strip=True) if soup.find('title') else ""
    is_redirected = "Marketplace" in title_text or "Shop" in title_text or "What's inside" in title_text or "Choose Your Plan" in title_text or "Subscription" in title_text
    
    detail_content_div = soup.select_one('.detail-content')
    if not detail_content_div or is_redirected:
        raise ValueError("Spell detail page is locked/unowned.")

    name_elem = detail_content_div.select_one('.page-title') or soup.find('h1')
    if not name_elem:
        raise ValueError("Could not find spell name/heading.")
    name = clean_text(name_elem.get_text())
    slug = slugify(name)
    
    id_match = re.search(r'/spells/(\d+)-', url)
    if id_match:
        spell_id = int(id_match.group(1))
    else:
        spell_id = int(hash(name) % 10000000)

    source = 'Unknown'
    source_el = detail_content_div.select_one('.source.spell-source')
    if source_el:
        raw_source = clean_text(source_el.get_text().replace('Source:', '').strip())
        source = clean_source_name(raw_source)

    level = 0
    school = 'Unknown'
    casting_time = 'Unknown'
    range_val = 'Unknown'
    components = ''
    required_materials = None
    duration = 'Unknown'
    concentration_required = 0
    ritual = 0
    melee_spell_attack = 0
    ranged_spell_attack = 0
    saving_throw = None
    damage = None

    statblock = detail_content_div.select_one('.ddb-statblock-spell')
    if statblock:
        level_el = statblock.select_one('.ddb-statblock-item-level .ddb-statblock-item-value')
        if level_el:
            level_str = clean_text(level_el.get_text()).lower()
            if 'cantrip' in level_str:
                level = 0
            else:
                l_match = re.search(r'\d+', level_str)
                level = int(l_match.group()) if l_match else 0
        
        school_el = statblock.select_one('.ddb-statblock-item-school .ddb-statblock-item-value')
        if school_el:
            school = clean_text(school_el.get_text())

        casting_time_el = statblock.select_one('.ddb-statblock-item-casting-time .ddb-statblock-item-value')
        if casting_time_el:
            if casting_time_el.select_one('.i-ritual') or 'ritual' in casting_time_el.get_text().lower():
                ritual = 1
                base_text = clean_text(casting_time_el.get_text().replace('Ritual', '').strip())
                casting_time = f"{base_text} or Ritual" if base_text else "Ritual"
            else:
                casting_time = clean_text(casting_time_el.get_text())
                
        range_el = statblock.select_one('.ddb-statblock-item-range-area .ddb-statblock-item-value')
        if range_el:
            range_val = clean_text(range_el.get_text())

        comp_el = statblock.select_one('.ddb-statblock-item-components .ddb-statblock-item-value')
        if comp_el:
            components = clean_text(comp_el.get_text().replace('*', '')).strip()
            if 'M' in components:
                blurb_el = detail_content_div.select_one('.components-blurb')
                if blurb_el:
                    blurb_text = clean_text(blurb_el.get_text())
                    m_match = re.search(r'\((.*)\)', blurb_text)
                    if m_match:
                        required_materials = m_match.group(1).strip()
                    else:
                        required_materials = re.sub(r'^\*\s*-\s*', '', blurb_text).strip('() ')

        duration_el = statblock.select_one('.ddb-statblock-item-duration .ddb-statblock-item-value')
        if duration_el:
            duration = clean_text(duration_el.get_text())
            if 'concentration' in duration.lower():
                concentration_required = 1

        att_save_el = statblock.select_one('.ddb-statblock-item-attack-save .ddb-statblock-item-value')
        if att_save_el:
            val_text = clean_text(att_save_el.get_text()).lower()
            if 'melee' in val_text:
                melee_spell_attack = 1
            elif 'ranged' in val_text:
                ranged_spell_attack = 1
            
            SAVE_MAPPING = {
                "str": "Strength",
                "dex": "Dexterity",
                "con": "Constitution",
                "int": "Intelligence",
                "wis": "Wisdom",
                "cha": "Charisma"
            }
            for abbrev, full_name in SAVE_MAPPING.items():
                if abbrev in val_text or full_name.lower() in val_text:
                    saving_throw = full_name
                    break

        dmg_effect_el = statblock.select_one('.ddb-statblock-item-damage-effect .ddb-statblock-item-value')
        if dmg_effect_el:
            dmg_type = clean_text(dmg_effect_el.get_text()).strip()
            if dmg_type:
                desc_div = detail_content_div.select_one('.more-info-content')
                desc_text = desc_div.get_text() if desc_div else ""
                dice_match = re.search(r'\b(\d+d\d+(?:\s*[-+]\s*\d+)?)\b', desc_text)
                if dice_match:
                    damage = f"{dice_match.group(1)} {dmg_type}"
                else:
                    damage = dmg_type

    class_spell_lists = []
    CLASSES = ["Artificer", "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"]
    for tag in detail_content_div.select('.tag.class-tag'):
        tag_text = clean_text(tag.get_text())
        for cls in CLASSES:
            if tag_text.lower().startswith(cls.lower()):
                if cls not in class_spell_lists:
                    class_spell_lists.append(cls)
                break

    paragraphs = []
    higher_level_description = None
    desc_div = detail_content_div.select_one('.more-info-content')
    if desc_div:
        for child in desc_div.children:
            if child.name == 'p':
                p_text = clean_text(child.get_text())
                if not p_text:
                    continue
                if p_text.lower().startswith("at higher levels"):
                    clean_p = re.sub(r'(?i)^at\s+higher\s+levels[\s.:-]*', '', p_text).strip()
                    higher_level_description = clean_p
                else:
                    paragraphs.append(p_text)
                    
    description = "\n\n".join(paragraphs)

    return {
        "id": spell_id,
        "name": name,
        "slug": slug,
        "url": url,
        "level": level,
        "school": school,
        "class_spell_lists": class_spell_lists,
        "casting_time": casting_time,
        "range": range_val,
        "components": components,
        "required_materials": required_materials,
        "duration": duration,
        "concentration_required": concentration_required,
        "ritual": ritual,
        "melee_spell_attack": melee_spell_attack,
        "ranged_spell_attack": ranged_spell_attack,
        "saving_throw": saving_throw,
        "damage": damage,
        "description": description,
        "higher_level_description": higher_level_description,
        "source": source
    }

def validate_spell(html_content, url):
    try:
        detail_data = parse_spell_html(html_content, url)
        return True, detail_data.get('source', 'Unknown')
    except ValueError:
        return False, 'Unknown'

def deduplicate_spells(spells_list):
    stubs = []
    full_spells = []
    
    # 1. Separate existing stubs ('duplicate_of' in s) from full spells.
    for s in spells_list:
        if 'duplicate_of' in s:
            stubs.append(s)
        else:
            full_spells.append(s)
            
    # 2. Group full spells by a normalized name key.
    groups = {}
    for s in full_spells:
        name_key = s.get('name', '').lower().strip()
        groups.setdefault(name_key, []).append(s)
        
    final_output = []
    
    # 3. For groups containing multiple spells, sort them by id so the earliest ID is chosen as the "original".
    for name_key, group in groups.items():
        group_sorted = sorted(group, key=lambda x: x.get('id', 0))
        
        originals = []
        for spell in group_sorted:
            matched_original = None
            for orig in originals:
                # Compare spell and orig, ignoring 'id', 'url', and 'source' keys
                keys_to_ignore = {'id', 'url', 'source'}
                all_keys = set(spell.keys()) | set(orig.keys())
                keys_to_compare = all_keys - keys_to_ignore
                
                is_match = True
                for k in keys_to_compare:
                    if spell.get(k) != orig.get(k):
                        is_match = False
                        break
                
                if is_match:
                    matched_original = orig
                    break
            
            if matched_original is not None:
                # 5. If a match is found, generate a stub and add to final output list
                stub = {"id": spell["id"], "duplicate_of": matched_original["id"]}
                final_output.append(stub)
            else:
                # 6. If no match is found, add it to the originals list and the final output list.
                originals.append(spell)
                final_output.append(spell)
                
    # 7. Return the combined list of new stubs, preserved existing stubs, and originals, sorted by id.
    combined = final_output + stubs
    combined.sort(key=lambda x: x.get('id', 0))
    return combined

def load_initial_spells():
    dnd_beyond_spells = {}
    
    if os.path.exists(DATA_FILE):
        print(f"Loading existing scraped D&D Beyond spells from JSON data file {DATA_FILE}...")
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                spells_list = data.get("spells", [])
                for s in spells_list:
                    # Identify D&D Beyond spells by URL or check if it is a stub
                    if (s.get('url') and 'dndbeyond.com' in s['url']) or 'duplicate_of' in s:
                        spell_id = s['id']
                        dnd_beyond_spells[spell_id] = s
            print(f"Loaded {len(dnd_beyond_spells)} scraped D&D Beyond spells.")
        except Exception as e:
            print(f"Warning: Failed to parse existing JSON file: {e}")

    return dnd_beyond_spells

def save_merged_spells(dnd_beyond_spells):
    # 1. Start with the scraped D&D Beyond spells
    combined = list(dnd_beyond_spells.values())
    
    # Clean source names of scraped/loaded spells
    for s in combined:
        if 'source' in s:
            s['source'] = clean_source_name(s['source'])

    # Keep track of (name.lower(), source.lower()) and used IDs
    seen = set()
    used_ids = set()
    for s in combined:
        if 'name' in s and 'source' in s:
            seen.add((s['name'].lower(), s['source'].lower()))
        used_ids.add(s['id'])
        
    # 2. Merge SQLite spells
    if os.path.exists(DB_FILE):
        try:
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM spells")
            db_spells = cursor.fetchall()
            for row in db_spells:
                s_dict = dict(row)
                if s_dict.get('class_spell_lists'):
                    try:
                        s_dict['class_spell_lists'] = json.loads(s_dict['class_spell_lists'])
                    except Exception:
                        pass
                # Normalize slug
                s_dict['slug'] = slugify(s_dict['name'])
                if s_dict.get('source'):
                    s_dict['source'] = clean_source_name(s_dict['source'])
                
                key = (s_dict['name'].lower(), s_dict['source'].lower())
                if key not in seen:
                    # Resolve ID conflicts
                    s_id = s_dict['id']
                    if s_id in used_ids:
                        s_id = max(used_ids) + 1 if used_ids else 10000
                        s_dict['id'] = s_id
                    
                    combined.append(s_dict)
                    seen.add(key)
                    used_ids.add(s_id)
            conn.close()
        except Exception as e:
            print(f"Warning: Failed to load from SQLite database during save: {e}")
            
    combined = deduplicate_spells(combined)

    # 3. Write combined list to spells.json
    result = {"spells": combined}
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Reparse all spells starting from page 1, preserving persistent state lists')
    parser.add_argument('--reset-state', action='store_true', help='Ignore persistent state entirely, starting with a clean/blank state')
    parser.add_argument('--offline', action='store_true', help='Do not make web requests. Only process cached files.')
    parser.add_argument('--limit', type=int, default=5, help='Limit the number of HTTP requests to make during this run (default: 5)')
    args = parser.parse_args()

    manager = ScraperManager(
        cache_dir="dnd_beyond/spells",
        state_file=STATE_FILE,
        validate_asset_fn=validate_spell,
        offline=args.offline,
        force=args.force,
        reset_state=args.reset_state,
        max_requests=args.limit
    )

    try:
        # Load initially merged dictionary of D&D Beyond spells
        dnd_beyond_spells = load_initial_spells()
        # Save initially combined database
        save_merged_spells(dnd_beyond_spells)

        success_count = 0
        current_page = manager.state["last_page"]
        previous_page_spells = set()

        print(f"Starting spell scraper. Limit: {args.limit} requests.")

        try:
            while True:
                url = f"{BASE_URL}/spells?filter-partnered-content=t&page={current_page}"
                page_html = manager.get_list_page(url, current_page)
                if not page_html:
                    break

                soup = BeautifulSoup(page_html, 'html.parser')
                spell_rows = soup.select('.listing-rpgspell .info')
                
                if not spell_rows:
                    print(f"No more spells found on page {current_page}.")
                    break

                current_page_spells = set()
                for row in spell_rows:
                    name_link = row.select_one('.spell-name a')
                    if name_link:
                        current_page_spells.add(name_link.get_text(strip=True))

                if current_page_spells == previous_page_spells and len(current_page_spells) > 0:
                    print(f"Page {current_page} has the exact same spells as the previous page. End of list reached.")
                    break
                    
                previous_page_spells = current_page_spells

                for row in spell_rows:
                    name_link = row.select_one('.spell-name a')
                    if not name_link:
                        continue

                    spell_name = clean_text(name_link.get_text())
                    href = name_link.get('href', '')
                    spell_url = urljoin(BASE_URL, href)

                    if spell_url in manager.state.get("unowned_urls", []):
                        print(f"Skipping '{spell_name}' (marked as unowned in state)")
                        continue

                    # ID and Slug from URL
                    id_match = re.search(r'/spells/(\d+)-([^/]+)', href)
                    if id_match:
                        spell_id = int(id_match.group(1))
                        spell_slug = id_match.group(2)
                    else:
                        spell_id = slugify(spell_name)
                        spell_slug = slugify(spell_name)

                    try:
                        html_content = manager.get_asset_html(spell_slug, spell_url)
                        if html_content is None:
                            continue
                    except PageNotFoundError as e:
                        print(f"Skipping '{spell_name}' (404 Page Not Found): {e}")
                        continue

                    try:
                        # Parse the detailed HTML
                        spell_data = parse_spell_html(html_content, spell_url)
                        
                        # Use the parsed/url ID
                        spell_data['id'] = spell_id

                        # Merge/overwrite in dictionary by unique ID
                        dnd_beyond_spells[spell_id] = spell_data
                        print(f"Successfully scraped '{spell_name}' ({spell_data['source']}).")
                        success_count += 1

                        # Save to file after each item to prevent loss
                        save_merged_spells(dnd_beyond_spells)
                    except Exception as e:
                        print(f"Failed to parse '{spell_name}': {e}")

                current_page += 1
                manager.state["last_page"] = current_page
                manager.save_state()

        except RequestLimitExceeded as e:
            print(f"Stopping scraper: {e}")

        manager.state["last_page"] = current_page
        manager.save_state()
        print(f"Scrape run complete. Scraped {success_count} new spells. Total spells in dataset: {len(dnd_beyond_spells)}")

    finally:
        manager.close_playwright()

if __name__ == "__main__":
    main()
