import os
import json
import re
from bs4 import BeautifulSoup

def slugify(text):
    return re.sub(r'[\s_]+', '-', text.lower()).strip('-')

def clean_text(text):
    # Remove excessive whitespace and fix mid-sentence breaks
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

def parse_monster_html(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f, 'html.parser')

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

    # Name
    name_elem = soup.select_one(f'{prefix}__name-link') or soup.select_one(f'{prefix}__name')
    monster["name"] = clean_text(name_elem.get_text())
    monster["id"] = slugify(monster["name"])

    # Meta
    meta_elem = soup.select_one(f'{prefix}__meta')
    if meta_elem:
        meta_str = clean_text(meta_elem.get_text())
        meta_parts = meta_str.split(',')
        if len(meta_parts) >= 2:
            monster["meta"]["alignment"] = meta_parts[-1].strip()
            type_size = meta_parts[0].strip().split(' ')
            monster["meta"]["size"] = type_size[0]
            monster["meta"]["type"] = ' '.join(type_size[1:])

    # Attributes
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

    # Stats
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

    # Tidbits
    for tidbit in soup.select(f'{prefix}__tidbit'):
        label_elem = tidbit.select_one(f'{prefix}__tidbit-label')
        if not label_elem: continue
        label = label_elem.get_text(strip=True).lower()
        data_elem = tidbit.select_one(f'{prefix}__tidbit-data')
        if not data_elem: continue
        data = clean_text(data_elem.get_text())

        if 'skills' in label:
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

    # Blocks (Traits, Actions)
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
            # D&D Beyond often separates text into multiple paragraphs or spans.
            # We want to ensure it's captured as continuous text per action.
            current_item = None
            for child in content_div.children:
                if child.name == 'p':
                    strong = child.find('strong')
                    if strong:
                        name = clean_text(strong.get_text()).rstrip('.')
                        # Get text excluding the name
                        full_p_text = clean_text(child.get_text())
                        text = full_p_text.replace(strong.get_text(strip=True), '', 1).strip()
                        if text.startswith('.'): text = text[1:].strip()
                        
                        current_item = {"name": name, "content": text}
                        if target == monster["actions"]:
                            current_item["is_attack"] = "Attack" in text
                            b_match = re.search(r'([+-]\d+) to hit', text)
                            if b_match: current_item["attack_bonus"] = int(b_match.group(1))
                            d_matches = re.findall(r'(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(\w+)\s+damage', text)
                            if d_matches: current_item["damage"] = [{"dice": d, "type": t} for d, t in d_matches]
                        target.append(current_item)
                    elif current_item:
                        # Continue existing item if it's just a following paragraph
                        current_item["content"] += " " + clean_text(child.get_text())

    source_elem = soup.select_one('.monster-source')
    if source_elem:
        monster["source"] = clean_text(source_elem.get_text().replace('Source:', '').strip())

    return monster

def main():
    files = ["Adult Brass Dragon - Monsters - D&D Beyond.html", "dnd_beyond/Aartuk Starhorror - Monsters - D&D Beyond.html"]
    all_monsters = []
    for f in files:
        if os.path.exists(f):
            print(f"Parsing {f}...")
            all_monsters.append(parse_monster_html(f))
    with open("public/data/monsters.json", 'w', encoding='utf-8') as f:
        json.dump(all_monsters, f, indent=2)
    print(f"Saved {len(all_monsters)} monsters.")

if __name__ == "__main__":
    main()
