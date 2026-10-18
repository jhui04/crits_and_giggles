import os
import json
import re
import time
import random
import argparse
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from scraper_base import ScraperManager, RequestLimitExceeded, extract_art_url, attach_image

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(ROOT_DIR, "tools/state/monster_scraper_state.json")
DATA_FILE = os.path.join(ROOT_DIR, "public/data/monsters.json")
BASE_URL = "https://www.dndbeyond.com"

def slugify(text):
    return re.sub(r'[\s_]+', '-', text.lower()).strip('-')

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

SOURCE_EXCEPTIONS = {
    "Monstrous Compendium Vol. 1: Spelljammer Creatures": "Spelljammer: Adventures in Space",
    "Spelljammer: Adventures in Space Boo’s Astral Menagerie": "Spelljammer: Adventures in Space",
    "Monster Manual": "Monster Manual (2014)"
}

def clean_source_name(raw_source, is_2024=False):
    s = re.sub(r'(?i),*\s*p(?:age|g)?\.?\s*\d+', '', raw_source).strip(', ')
    s = s.split('•')[0].strip()
    if s == "Monster Manual":
        return "Monster Manual (2024)" if is_2024 else "Monster Manual (2014)"
    if s in SOURCE_EXCEPTIONS:
        s = SOURCE_EXCEPTIONS[s]
    return s

def parse_hp(hp_str):
    match = re.search(r'(\d+)\s*(?:\(([^)]+)\))?', hp_str)
    if match:
        avg = int(match.group(1))
        dice = match.group(2) if match.group(2) else f"{avg}"
        return avg, dice
    return 0, ""

def parse_speed(speed_str):
    speeds = {"walk": 0, "hover": False}
    parts = speed_str.split(',')
    for part in parts:
        part = part.strip().lower()
        if 'hover' in part:
            speeds['hover'] = True
        match = re.search(r'(?:(\w+)\s+)?(\d+)\s*ft', part)
        if match:
            name = match.group(1) if match.group(1) else "walk"
            val = int(match.group(2))
            speeds[name] = val
    return speeds

def parse_monster_html(html_content, url=""):
    soup = BeautifulSoup(html_content, 'html.parser')

    is_2024 = soup.select_one('.mon-stat-block-2024') is not None
    prefix = '.mon-stat-block-2024' if is_2024 else '.mon-stat-block'

    monster = {
        "meta": {},
        "attributes": {"ac": {}, "hp": {}, "speeds": {}},
        "stats": {},
        "skills": [],
        "vulnerabilities": [],
        "resistances": [],
        "immunities": {"damage": [], "condition": []},
        "senses": [],
        "languages": [],
        "traits": [],
        "actions": [],
        "legendary_actions": [],
        "reactions": []
    }

    name_elem = soup.select_one(f'{prefix}__name-link') or soup.select_one(f'{prefix}__name')
    monster["name"] = clean_text(name_elem.get_text())
    
    # Try to extract the numeric ID from the D&D Beyond URL
    id_match = re.search(r'/monsters/(\d+)-', url)
    if id_match:
        monster["id"] = id_match.group(1)
    else:
        monster["id"] = slugify(monster["name"])

    meta_elem = soup.select_one(f'{prefix}__meta')
    if meta_elem:
        meta_str = clean_text(meta_elem.get_text())
        meta_parts = meta_str.split(',')
        if len(meta_parts) >= 2:
            monster["meta"]["alignment"] = meta_parts[-1].strip()
            type_size = meta_parts[0].strip().split(' ')
            monster["meta"]["size"] = type_size[0]
            monster["meta"]["type"] = ' '.join(type_size[1:])

    for attr in soup.select(f'{prefix}__attribute'):
        label_elem = attr.select_one(f'{prefix}__attribute-label')
        if not label_elem: continue
        label = label_elem.get_text(strip=True).lower()
        val_elem = attr.select_one(f'{prefix}__attribute-data-value') or attr.select_one(f'{prefix}__attribute-value')
        val_str = clean_text(val_elem.get_text())

        if 'ac' in label or 'armor class' in label:
            monster["attributes"]["ac"]["value"] = int(re.search(r'\d+', val_str).group())
            extra = attr.select_one(f'{prefix}__attribute-data-extra')
            if extra:
                monster["attributes"]["ac"]["notes"] = clean_text(extra.get_text()).strip('()')
        elif 'hp' in label or 'hit points' in label:
            extra_elem = attr.select_one(f'{prefix}__attribute-data-extra')
            extra_str = clean_text(extra_elem.get_text()) if extra_elem else ""
            avg, dice = parse_hp(f"{val_str} {extra_str}")
            monster["attributes"]["hp"]["value"] = avg
            monster["attributes"]["hp"]["dice"] = dice
        elif 'speed' in label:
            monster["attributes"]["speeds"] = parse_speed(val_str)
        elif 'initiative' in label:
            monster["attributes"]["initiative_modifier"] = int(val_str.replace('+', ''))

    if is_2024:
        for row in soup.select('.stat-table tbody tr'):
            cols = row.find_all(['th', 'td'])
            if len(cols) >= 3:
                name = cols[0].get_text(strip=True).upper()
                score = int(cols[1].get_text(strip=True))
                mod = int(cols[2].get_text(strip=True).replace('+', ''))
                save = mod
                if len(cols) >= 4:
                    save = int(cols[3].get_text(strip=True).replace('+', ''))
                monster["stats"][name] = {"score": score, "modifier": mod, "save": save}
    else:
        for ab in soup.select('.ability-block__stat'):
            name = ab.select_one('.ability-block__heading').get_text(strip=True).upper()
            score = int(ab.select_one('.ability-block__score').get_text(strip=True))
            mod_str = ab.select_one('.ability-block__modifier').get_text(strip=True)
            mod = int(re.search(r'[+-]\d+', mod_str).group())
            monster["stats"][name] = {"score": score, "modifier": mod, "save": mod}

    for tidbit in soup.select(f'{prefix}__tidbit'):
        label_elem = tidbit.select_one(f'{prefix}__tidbit-label')
        if not label_elem: continue
        label = label_elem.get_text(strip=True).lower()
        data_elem = tidbit.select_one(f'{prefix}__tidbit-data')
        if not data_elem: continue
        data = clean_text(data_elem.get_text())

        if 'saving throws' in label:
            for s in data.split(','):
                s_match = re.search(r'([a-zA-Z]+)\s+([+-]\d+)', s.strip())
                if s_match:
                    stat_name = s_match.group(1).strip().upper()
                    if stat_name in monster["stats"]:
                        monster["stats"][stat_name]["save"] = int(s_match.group(2))
        elif 'skills' in label:
            for s in data.split(','):
                s_match = re.search(r'(.+?)\s+([+-]\d+)', s)
                if s_match:
                    monster["skills"].append({"name": s_match.group(1).strip(), "modifier": int(s_match.group(2))})
        elif 'senses' in label:
            for s in data.split(','):
                s_match = re.search(r'(.+?)\s+(\d+)\s*ft', s)
                if s_match:
                    monster["senses"].append({"name": s_match.group(1).strip(), "value": int(s_match.group(2))})
                elif 'passive perception' in s.lower():
                    pp_match = re.search(r'\d+', s)
                    if pp_match:
                        monster["senses"].append({"name": "Passive Perception", "value": int(pp_match.group())})
        elif 'languages' in label:
            monster["languages"] = [l.strip() for l in data.split(',')]
        elif 'cr' in label or 'challenge' in label:
            monster["cr"] = data.split(' ')[0]
        elif 'proficiency' in label:
            monster["proficiency_bonus"] = int(data.replace('+', ''))
        elif 'vulnerabilities' in label:
            monster["vulnerabilities"] = [v.strip() for v in re.split(r',|;', data) if v.strip()]
        elif 'resistances' in label:
            monster["resistances"] = [r.strip() for r in re.split(r',|;', data) if r.strip()]
        elif 'damage immunities' in label or label == 'immunities':
            monster["immunities"]["damage"] = [i.strip() for i in re.split(r',|;', data) if i.strip()]
        elif 'condition immunities' in label:
            monster["immunities"]["condition"] = [i.strip() for i in re.split(r',|;', data) if i.strip()]

    for block in soup.select(f'{prefix}__description-block'):
        heading_elem = block.select_one(f'{prefix}__description-block-heading')
        if not heading_elem: continue
        heading = heading_elem.get_text(strip=True).lower()
        content_div = block.select_one(f'{prefix}__description-block-content')
        
        target = None
        if 'traits' in heading: target = monster["traits"]
        elif 'actions' in heading and 'legendary' not in heading: target = monster["actions"]
        elif 'legendary' in heading: target = monster["legendary_actions"]
        elif 'reactions' in heading: target = monster["reactions"]

        if target is not None:
            current_item = None
            for child in content_div.children:
                if child.name == 'p':
                    strong = child.find('strong')
                    if strong:
                        name = clean_text(strong.get_text()).rstrip('.')
                        full_p_text = clean_text(child.get_text())
                        text = full_p_text.replace(strong.get_text(strip=True), '', 1).strip()
                        if text.startswith('.'): text = text[1:].strip()
                        
                        current_item = {"name": name, "content": text}
                        if target in (monster["actions"], monster["legendary_actions"]):
                            current_item["is_attack"] = "Attack" in text
                            # Handle both 2014 ("+X to hit") and 2024 ("Attack Roll: +X") styles
                            b_match = re.search(r'([+-]\d+)\s+to\s+hit|Attack\s+Roll:\s*([+-]\d+)', text)
                            if b_match:
                                bonus = b_match.group(1) if b_match.group(1) else b_match.group(2)
                                current_item["attack_bonus"] = int(bonus)
                            
                            # Handle complex damage types like "bludgeoning or slashing damage"
                            # and multiple damage instances
                            d_matches = re.findall(r'(?:(\d+d\d+(?:\s*[-+−–]\s*\d+)?)\)?|(\d+))\s+([\w\s,/-]+?)\s+damage', text)
                            if d_matches:
                                current_item["damage"] = [{"dice": d[0] if d[0] else d[1], "type": d[2].strip()} for d in d_matches]
                        target.append(current_item)
                    elif current_item:
                        current_item["content"] += " " + clean_text(child.get_text())

    source_elem = soup.select_one('.monster-source')
    if source_elem:
        raw_source = clean_text(source_elem.get_text().replace('Source:', '').strip())
        monster["source"] = clean_source_name(raw_source, is_2024)

    description_blocks = soup.select('.mon-details__description-block .mon-details__description-block-content')
    if description_blocks:
        content_div = description_blocks[0]
        current_title = ""
        current_content = []
        lore_sections = []
        
        def save_current_section():
            nonlocal current_title, current_content, lore_sections
            if current_content:
                if current_title:
                    lore_sections.append({"title": current_title, "content": current_content})
                else:
                    monster["description"] = current_content
            current_content = []

        for child in content_div.children:
            if child.name in ['h2', 'h3', 'h4', 'h5']:
                save_current_section()
                current_title = clean_text(child.get_text())
            elif child.name in ['p', 'blockquote', 'aside']:
                text = clean_text(child.get_text())
                if text:
                    current_content.append(text)
            elif child.name in ['ul', 'ol']:
                list_items = []
                for li in child.find_all('li', recursive=False):
                    li_text = clean_text(li.get_text())
                    if li_text:
                        list_items.append(li_text)
                if list_items:
                    current_content.append({"type": "list", "items": list_items})
            elif child.name == 'table':
                rows = []
                for tr in child.find_all('tr'):
                    cells = [clean_text(td.get_text()) for td in tr.find_all(['td', 'th'])]
                    if any(cells):
                        rows.append(cells)
                if rows:
                    current_content.append({"type": "table", "rows": rows})
        
        save_current_section()
        if lore_sections:
            monster["lore_sections"] = lore_sections

    image_url = extract_art_url(soup, html_content, 'monster-image')
    if image_url:
        monster["image_url"] = image_url

    return monster


def validate_monster(html_content, url):
    soup = BeautifulSoup(html_content, 'html.parser')
    is_valid = (soup.select_one('.mon-stat-block-2024') is not None or 
                soup.select_one('.mon-stat-block') is not None)
    source = "Unknown"
    source_elem = soup.select_one('.monster-source')
    if source_elem:
        source = clean_source_name(clean_text(source_elem.get_text().replace('Source:', '').strip()))
    return is_valid, source
def merge_values(val1, val2, path, monster_name):
    if val1 is None and val2 is None:
        return None
    if val1 is None:
        return val2
    if val2 is None:
        return val1

    if type(val1) != type(val2):
        raise ValueError(f"Merge conflict in monster '{monster_name}' at field '{path}': Type mismatch '{type(val1)}' vs '{type(val2)}'")

    if isinstance(val1, (int, bool, float)):
        if val1 != val2:
            raise ValueError(f"Merge conflict in monster '{monster_name}' at field '{path}': '{val1}' vs '{val2}'")
        return val1

    if isinstance(val1, str):
        if val1 in val2:
            return val2
        elif val2 in val1:
            return val1
        else:
            raise ValueError(f"Merge conflict in monster '{monster_name}' at field '{path}': '{val1}' vs '{val2}'")

    if isinstance(val1, dict):
        merged = {}
        all_keys = set(val1.keys()) | set(val2.keys())
        for k in all_keys:
            new_path = f"{path}.{k}" if path else k
            if k in val1 and k in val2:
                merged[k] = merge_values(val1[k], val2[k], new_path, monster_name)
            elif k in val1:
                merged[k] = val1[k]
            else:
                merged[k] = val2[k]
        return merged

    if isinstance(val1, list):
        is_list_of_dicts = (len(val1) > 0 and isinstance(val1[0], dict)) or (len(val2) > 0 and isinstance(val2[0], dict))
        if is_list_of_dicts:
            has_name = any(isinstance(item, dict) and 'name' in item for item in val1 + val2)
            if has_name:
                merged_list = []
                dict_map1 = {item.get('name'): item for item in val1 if isinstance(item, dict) and 'name' in item}
                dict_map2 = {item.get('name'): item for item in val2 if isinstance(item, dict) and 'name' in item}
                
                # Combine names preserving order: canonical names first, then incoming names
                names1 = [item.get('name') for item in val1 if isinstance(item, dict) and 'name' in item]
                names2 = [item.get('name') for item in val2 if isinstance(item, dict) and 'name' in item]
                
                combined_names = []
                for name in names1:
                    if name not in combined_names:
                        combined_names.append(name)
                for name in names2:
                    if name not in combined_names:
                        combined_names.append(name)
                        
                for name in combined_names:
                    new_path = f"{path}[name={name}]" if path else f"name={name}"
                    if name in dict_map1 and name in dict_map2:
                        merged_list.append(merge_values(dict_map1[name], dict_map2[name], new_path, monster_name))
                    elif name in dict_map1:
                        merged_list.append(dict_map1[name])
                    else:
                        merged_list.append(dict_map2[name])
                        
                non_named1 = [item for item in val1 if not (isinstance(item, dict) and 'name' in item)]
                non_named2 = [item for item in val2 if not (isinstance(item, dict) and 'name' in item)]
                for item in non_named1:
                    if item not in merged_list:
                        merged_list.append(item)
                for item in non_named2:
                    if item not in merged_list:
                        merged_list.append(item)
                return merged_list
            else:
                # Fallback for list of dicts without 'name' field (e.g. damage field)
                def is_dict_contained(d, lst):
                    return any(d == item for item in lst)
                
                all_in_2 = all(is_dict_contained(item, val2) for item in val1)
                all_in_1 = all(is_dict_contained(item, val1) for item in val2)
                
                if all_in_2:
                    return val2
                elif all_in_1:
                    return val1
                else:
                    raise ValueError(f"Merge conflict in monster '{monster_name}' at field '{path}': Disjoint or conflicting lists of unnamed dicts '{val1}' vs '{val2}'")
        else:
            set1 = set(val1)
            set2 = set(val2)
            if set1.issubset(set2):
                return val2
            elif set2.issubset(set1):
                return val1
            else:
                raise ValueError(f"Merge conflict in monster '{monster_name}' at field '{path}': Disjoint or overlapping lists '{val1}' vs '{val2}'")

    raise ValueError(f"Merge conflict in monster '{monster_name}' at field '{path}': Unsupported type '{type(val1)}'")


def merge_monsters(canonical, incoming):
    all_keys = set(canonical.keys()) | set(incoming.keys())
    keys_to_merge = all_keys - {'id', 'url', 'source', 'image_url', 'image'}
    monster_name = canonical.get('name') or incoming.get('name') or "Unknown"
    if not canonical.get('image_url') and incoming.get('image_url'):
        canonical['image_url'] = incoming['image_url']
        if incoming.get('image'):
            canonical['image'] = incoming['image']
    for k in keys_to_merge:
        if k in canonical and k in incoming:
            canonical[k] = merge_values(canonical[k], incoming[k], k, monster_name)
        elif k in incoming:
            canonical[k] = incoming[k]
    return canonical


def deduplicate_monsters(monsters_list):
    existing_stubs = [m for m in monsters_list if 'duplicate_of' in m]
    full_monsters = [m for m in monsters_list if 'duplicate_of' not in m]

    groups = {}
    for m in full_monsters:
        name_key = m.get('name', '').lower().strip()
        groups.setdefault(name_key, []).append(m)

    final_output = []
    final_output.extend(existing_stubs)

    def is_duplicate(m1, m2):
        ignored = ('id', 'url', 'source', 'image_url', 'image')
        keys1 = {k for k in m1.keys() if k not in ignored}
        keys2 = {k for k in m2.keys() if k not in ignored}
        if keys1 != keys2:
            return False
        for k in keys1:
            if m1[k] != m2[k]:
                return False
        return True

    for name_key, group in groups.items():
        # Scan for Basic Rules (2014) and Monster Manual (2014) pair
        br_monster = None
        mm_monster = None
        for m in group:
            if m.get('source') == 'Basic Rules (2014)':
                br_monster = m
            elif m.get('source') == 'Monster Manual (2014)':
                mm_monster = m

        if br_monster and mm_monster:
            # Attempt to run merge_monsters, allowing exceptions to bubble up
            merge_monsters(br_monster, mm_monster)
            # Generate stub for Monster Manual entry
            final_output.append({
                "id": mm_monster["id"],
                "duplicate_of": br_monster["id"]
            })
            # Remove mm_monster from group
            group = [m for m in group if m is not mm_monster]

        # sort group by id lexicographically
        sorted_group = sorted(group, key=lambda x: str(x.get('id', '')))
        group_originals = []
        for m in sorted_group:
            matched_original = None
            for orig in group_originals:
                if is_duplicate(m, orig):
                    matched_original = orig
                    break
            if matched_original is not None:
                final_output.append({
                    "id": m["id"],
                    "duplicate_of": matched_original["id"]
                })
            else:
                group_originals.append(m)
                final_output.append(m)

    final_output.sort(key=lambda x: str(x.get('id', '')))
    return final_output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Reparse all monsters starting from page 1, preserving persistent state lists')
    parser.add_argument('--reset-state', action='store_true', help='Ignore persistent state entirely, starting with a clean/blank state')
    parser.add_argument('--offline', action='store_true', help='Do not make web requests. Only process cached files.')
    parser.add_argument('--limit', type=int, default=1000, help='Limit the number of HTTP requests to make during this run')
    args = parser.parse_args()

    manager = ScraperManager(
        cache_dir=os.path.join(ROOT_DIR, "dnd_beyond/monsters"),
        state_file=STATE_FILE,
        validate_asset_fn=validate_monster,
        offline=args.offline,
        force=args.force,
        reset_state=args.reset_state,
        max_requests=args.limit
    )

    try:
        # Load existing monsters
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                all_monsters = json.load(f)
        else:
            all_monsters = []

        # Deduplicate all_monsters by ID
        unique_monsters = {}
        for m in all_monsters:
            if "id" in m:
                unique_monsters[m["id"]] = m
        all_monsters = list(unique_monsters.values())
        if len(all_monsters) > 0:
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(deduplicate_monsters(all_monsters), f, indent=2)

        success_count = 0
        current_page = manager.state["last_page"]
        previous_page_monsters = set()

        print(f"Starting scraper. Limit: {args.limit} requests.")

        try:
            while True:
                url = f"{BASE_URL}/monsters?filter-partnered-content=t&page={current_page}"
                page_html = manager.get_list_page(url, current_page)
                if not page_html:
                    break

                soup = BeautifulSoup(page_html, 'html.parser')
                monster_rows = soup.select('.row.monster-name')
                
                if not monster_rows:
                    print(f"No more monsters found on page {current_page}.")
                    break

                current_page_monsters = set()
                for row in monster_rows:
                    name_elem = row.select_one('.name a.link')
                    if name_elem:
                        current_page_monsters.add(name_elem.get_text(strip=True))

                if current_page_monsters == previous_page_monsters and len(current_page_monsters) > 0:
                    print(f"Page {current_page} has the exact same monsters as the previous page. We have reached the end of the list.")
                    break
                    
                previous_page_monsters = current_page_monsters

                for row in monster_rows:
                    name_elem = row.select_one('.name a.link')
                    source_elem = row.select_one('.source')
                    
                    if not name_elem:
                        continue
                        
                    monster_url = urljoin(BASE_URL, name_elem['href'])
                    monster_name = name_elem.get_text(strip=True).strip('"')

                    if monster_url in manager.state.get("unowned_urls", []):
                        print(f"Skipping '{monster_name}' (marked as unowned in state)")
                        continue
                    raw_source = source_elem.get_text(strip=True) if source_elem else "Unknown"
                    source = clean_source_name(raw_source)

                    # Deduce ID from URL
                    id_match = re.search(r'/monsters/(\d+)-', monster_url)
                    if id_match:
                        monster_id = id_match.group(1)
                    else:
                        monster_id = slugify(monster_name)

                    if source in manager.state["blocked_sources"]:
                        print(f"Skipping '{monster_name}' (Source blocked: {source})")
                        continue

                    already_in_json = False
                    target_idx = -1
                    for idx, m in enumerate(all_monsters):
                        if m.get('id') == monster_id:
                            already_in_json = True
                            target_idx = idx
                            break

                    html_content = manager.get_asset_html(slugify(monster_name), monster_url, known_source=source)
                    if html_content is None:
                        continue

                    try:
                        monster_data = parse_monster_html(html_content, monster_url)
                        if not monster_data.get('source') and source != "Unknown":
                            monster_data['source'] = source
                        attach_image(monster_data, 'monsters', download=not args.offline)
                            
                        if already_in_json:
                            all_monsters[target_idx] = monster_data
                            print(f"Updated '{monster_name}' ({source}) in JSON.")
                        else:
                            all_monsters.append(monster_data)
                            success_count += 1
                            print(f"Successfully scraped '{monster_name}'.")
                            
                    except Exception as e:
                        print(f"Failed to parse '{monster_name}': {e}")

                if len(all_monsters) > 0:
                    with open(DATA_FILE, 'w', encoding='utf-8') as f:
                        json.dump(deduplicate_monsters(all_monsters), f, indent=2)

                current_page += 1
                manager.state["last_page"] = current_page
                manager.save_state()

        except RequestLimitExceeded as e:
            print(f"Stopping scraper: {e}")

        manager.state["last_page"] = current_page
        manager.save_state()
        print(f"Finished. Saved {success_count} new monsters.")
        
    finally:
        manager.close_playwright()

if __name__ == "__main__":
    main()
