import os
import json
import re
import time
import random
import argparse
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

STATE_FILE = "tools/scraper_state.json"
DATA_FILE = "public/data/monsters.json"
BASE_URL = "https://www.dndbeyond.com"

def slugify(text):
    return re.sub(r'[\s_]+', '-', text.lower()).strip('-')

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

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

def parse_monster_html(html_content):
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
                        if target == monster["actions"]:
                            current_item["is_attack"] = "Attack" in text
                            b_match = re.search(r'([+-]\d+) to hit', text)
                            if b_match: current_item["attack_bonus"] = int(b_match.group(1))
                            d_matches = re.findall(r'(?:(\d+d\d+(?:\s*[-+−–]\s*\d+)?)\)?|(\d+))\s+(\w+)\s+damage', text)
                            if d_matches: current_item["damage"] = [{"dice": d[0] if d[0] else d[1], "type": d[2]} for d in d_matches]
                        target.append(current_item)
                    elif current_item:
                        current_item["content"] += " " + clean_text(child.get_text())

    source_elem = soup.select_one('.monster-source')
    if source_elem:
        monster["source"] = clean_text(source_elem.get_text().replace('Source:', '').strip())

    return monster

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Ignore persistent state and start from page 1')
    args = parser.parse_args()

    state = {"last_page": 1, "blocked_sources": []}
    if not args.force and os.path.exists(STATE_FILE):
        with open(STATE_FILE, 'r', encoding='utf-8') as f:
            state = json.load(f)

    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            all_monsters = json.load(f)
    else:
        all_monsters = []

    requests_made = 0
    max_requests = 200
    success_count = 0

    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    })

    def make_request(url):
        nonlocal requests_made
        print(f"Fetching {url}...")
        response = session.get(url)
        requests_made += 1
        
        if requests_made < max_requests:
            delay = 5 + random.uniform(0, 30)
            print(f"Sleeping for {delay:.2f} seconds... (Requests made: {requests_made})")
            time.sleep(delay)
            
        return response

    current_page = state["last_page"]
    previous_page_monsters = set()

    while requests_made < max_requests:
        url = f"{BASE_URL}/monsters?page={current_page}"
        response = make_request(url)
        if response.status_code != 200:
            print(f"Failed to fetch page {current_page}. Status: {response.status_code}")
            break

        soup = BeautifulSoup(response.text, 'html.parser')
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
            if requests_made >= max_requests:
                break
                
            name_elem = row.select_one('.name a.link')
            source_elem = row.select_one('.source')
            
            if not name_elem:
                continue
                
            monster_url = urljoin(BASE_URL, name_elem['href'])
            # D&D Beyond often surrounds name in quotes like "The Demogorgon"
            monster_name = name_elem.get_text(strip=True).strip('"')
            source = source_elem.get_text(strip=True) if source_elem else "Unknown"

            if source in state["blocked_sources"]:
                print(f"Skipping '{monster_name}' (Source blocked: {source})")
                continue

            if any(m.get('name') == monster_name for m in all_monsters):
                print(f"Already have '{monster_name}', skipping...")
                continue

            safe_filename = slugify(monster_name) + ".html"
            local_filepath = os.path.join("dnd_beyond", safe_filename)
            html_content = ""

            if os.path.exists(local_filepath):
                print(f"Found local file for '{monster_name}', skipping web request...")
                with open(local_filepath, 'r', encoding='utf-8') as f:
                    html_content = f.read()
            else:
                m_response = make_request(monster_url)
                if m_response.status_code != 200:
                    print(f"Failed to fetch '{monster_name}'. Status: {m_response.status_code}")
                    continue
                html_content = m_response.text

            m_soup = BeautifulSoup(html_content, 'html.parser')
            if m_soup.select_one('.mon-stat-block-2024') is None and m_soup.select_one('.mon-stat-block') is None:
                print(f"No stat block found for '{monster_name}'. Blocking source '{source}'.")
                if source not in state["blocked_sources"]:
                    state["blocked_sources"].append(source)
                    with open(STATE_FILE, 'w', encoding='utf-8') as f:
                        json.dump(state, f, indent=2)
                continue

            try:
                monster_data = parse_monster_html(html_content)
                if not monster_data.get('source') and source != "Unknown":
                    monster_data['source'] = source
                all_monsters.append(monster_data)
                success_count += 1
                print(f"Successfully scraped '{monster_name}'.")
                
                if not os.path.exists(local_filepath):
                    os.makedirs("dnd_beyond", exist_ok=True)
                    with open(local_filepath, 'w', encoding='utf-8') as f:
                        f.write(html_content)
                
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(all_monsters, f, indent=2)
                    
            except Exception as e:
                print(f"Failed to parse '{monster_name}': {e}")
                
        if requests_made >= max_requests:
            break
            
        current_page += 1
        state["last_page"] = current_page
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, indent=2)

    state["last_page"] = current_page
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=2)
        
    print(f"Finished. Saved {success_count} new monsters. Total requests: {requests_made}.")

if __name__ == "__main__":
    main()
