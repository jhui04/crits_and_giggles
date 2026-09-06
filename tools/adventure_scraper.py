import os
import json
import re
import time
import random
import argparse
import uuid
import urllib.request
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright

STATE_FILE = "tools/adventure_scraper_state.json"
DATA_FILE = "public/data/scraped_campaign.json"

def download_map_image(url, output_dir="public/maps"):
    if not url:
        return None
    os.makedirs(output_dir, exist_ok=True)
    fname = os.path.basename(url.split('?')[0])
    dest = os.path.join(output_dir, fname)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return f"/maps/{fname}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=15) as resp, open(dest, 'wb') as out:
            out.write(resp.read())
        print(f"Downloaded map {fname} ({os.path.getsize(dest)} bytes)")
        return f"/maps/{fname}"
    except Exception as e:
        print(f"Warning: Could not download map from {url}: {e}")
        return f"/maps/{fname}"

def slugify(text):
    return re.sub(r'[\s_]+', '-', text.lower()).strip('-')

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def replace_world_references(text, wildemount_asset_ids, world_assets_by_id, campaign, current_chapter):
    # Split text by existing @Spell/Monster/Item/World/Campaign/Asset tags to avoid nested links
    pattern = r'(@(?:Spell|Monster|Item|World|Campaign|Asset|Encounter)\[[^\]]+\]\{[^}]+\})'
    parts = re.split(pattern, text)
    
    for i in range(len(parts)):
        if i % 2 == 0: # Non-tag segment
            for name_lower, world_id in wildemount_asset_ids.items():
                if len(name_lower) < 3:
                    continue
                
                word_pattern = r'\b(' + re.escape(name_lower) + r')\b'
                
                def replacer(match):
                    matched_name = match.group(1)
                    return f"@World[{world_id}]{{{matched_name}}}"
                
                # Check case-insensitively but preserve matched name
                parts[i] = re.sub(word_pattern, replacer, parts[i], flags=re.IGNORECASE)
                
    return "".join(parts)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Ignore persistent state')
    parser.add_argument('--offline', action='store_true', help='Do not make web requests. Only process cached files.')
    args = parser.parse_args()

    # Read base URL
    base_url = "https://www.dndbeyond.com/sources/dnd/egtw"
    if os.path.exists('url.txt'):
        with open('url.txt', 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if content:
                base_url = content

    page = None
    playwright_mgr = None
    browser = None

    if not args.offline:
        playwright_mgr = sync_playwright().start()
        try:
            print("Connecting to Chrome via remote debugging port 9222...")
            browser = playwright_mgr.chromium.connect_over_cdp("http://127.0.0.1:9222")
            context = browser.contexts[0]
            
            for existing_page in context.pages:
                if existing_page.url == "about:blank" or "dndbeyond.com" in existing_page.url:
                    page = existing_page
                    break
            
            if not page:
                page = context.pages[-1] if context.pages else context.new_page()

        except Exception as e:
            print(f"Failed to connect to Chrome. Did you launch it with --remote-debugging-port=9222? Error: {e}")
            playwright_mgr.stop()
            return

    requests_made = 0
    max_requests = 10

    def fetch_html(url):
        nonlocal requests_made
        if args.offline:
            print(f"Offline mode: Skipping fetch for {url}")
            return None
            
        print(f"Fetching {url}...")
        page.goto(url)
        page.wait_for_timeout(1000) 
        html = page.content()
        requests_made += 1
        
        if requests_made < max_requests:
            delay = 5 + random.uniform(0, 30)
            print(f"Sleeping for {delay:.2f} seconds... (Requests made: {requests_made})")
            time.sleep(delay)
            
        return html

    try:
        # Load wildemount asset mapping if available
        wildemount_asset_ids = {}
        world_assets_by_id = {}
        mapping_path = "tools/state/wildemount_asset_ids.json"
        world_path = "public/data/scraped_world.json"
        if os.path.exists(mapping_path):
            with open(mapping_path, 'r', encoding='utf-8') as f:
                wildemount_asset_ids = json.load(f)
        if os.path.exists(world_path):
            with open(world_path, 'r', encoding='utf-8') as f:
                try:
                    world_data = json.load(f)
                    for asset in world_data.get("assets", []):
                        world_assets_by_id[asset["id"]] = asset
                except Exception as e:
                    print(f"Error loading scraped_world.json: {e}")

        monsters_by_id = {}
        monsters_path = "public/data/monsters.json"
        if os.path.exists(monsters_path):
            with open(monsters_path, 'r', encoding='utf-8') as f:
                try:
                    for m in json.load(f):
                        if 'id' in m:
                            monsters_by_id[str(m['id'])] = m
                except Exception as e:
                    print(f"Error loading monsters.json: {e}")

        # 1. Fetch main index
        index_filepath = os.path.join("dnd_beyond", "adventures", "index.html")
        os.makedirs(os.path.dirname(index_filepath), exist_ok=True)
        index_html = ""
        if os.path.exists(index_filepath) and not args.force:
            print("Found cached index...")
            with open(index_filepath, 'r', encoding='utf-8') as f:
                index_html = f.read()
        else:
            if args.offline:
                print("Offline mode: index.html not found.")
                return

            if requests_made >= max_requests:
                print("Max requests reached before index.")
                return
            index_html = fetch_html(base_url)
            if index_html:
                with open(index_filepath, 'w', encoding='utf-8') as f:
                    f.write(index_html)

        if not index_html:
            print("Could not obtain index HTML.")
            return

        soup = BeautifulSoup(index_html, 'html.parser')

        # 2. Find the actual adventure links directly from the index page
        adventure_links = []
        for a in soup.find_all('a'):
            if not a.has_attr('href'): continue
            href = a['href']
            if 'adventures-in-wildemount-' in href and href not in adventure_links:
                if '#' not in href:
                    adventure_links.append(href)

        print(f"Found {len(adventure_links)} adventures.")

        scraped_campaigns = []

        # 3. Fetch and parse each adventure
        for adv_link in adventure_links:
            adv_url = urljoin(base_url, adv_link)
            adv_slug = adv_link.split('/')[-1]
            adv_filepath = os.path.join("dnd_beyond", "adventures", f"{adv_slug}.html")

            adv_html = ""
            if os.path.exists(adv_filepath) and not args.force:
                print(f"Found cached adventure {adv_slug}...")
                with open(adv_filepath, 'r', encoding='utf-8') as f:
                    adv_html = f.read()
            else:
                if args.offline:
                    print(f"Offline mode: Skipping {adv_slug} (not cached)")
                    continue

                if requests_made >= max_requests:
                    print("Max requests reached. Stopping early.")
                    break
                adv_html = fetch_html(adv_url)
                if adv_html:
                    with open(adv_filepath, 'w', encoding='utf-8') as f:
                        f.write(adv_html)

            if not adv_html:
                continue

            adv_soup = BeautifulSoup(adv_html, 'html.parser')
            content_area = adv_soup.select_one('.p-article-content') or adv_soup.select_one('article') or adv_soup.select_one('.primary-content')

            if content_area:
                print(f"Parsing adventure {adv_slug}...")

                # Try to find a good name for the campaign
                title_elem = adv_soup.select_one('h1.page-title') or adv_soup.select_one('h1')
                camp_name = clean_text(title_elem.get_text(strip=True)) if title_elem else adv_slug.replace('-', ' ').title()

                campaign = {
                    "id": str(uuid.uuid4()),
                    "name": camp_name,
                    "description": f"Adventure scraped from D&D Beyond: {camp_name}",
                    "chapters": [],
                    "assets": [],
                    "encounters": [],
                    "worldId": "4a2b9c3d-1e5f-4a7b-8c9d-1e5f4a7b8c9d"
                }
                current_chapter = None
                seen_map_ids = set()
                current_encounter = None

                for elem in content_area.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'ul', 'figure', 'div']):
                    if elem.name == 'figure':
                        caption = elem.find('figcaption')
                        cap_text = caption.get_text(' ', strip=True) if caption else ''
                        fid = elem.get('id', '')
                        map_key = fid or cap_text
                        if ('map' in cap_text.lower() or 'map' in fid.lower()) and map_key and map_key not in seen_map_ids:
                            seen_map_ids.add(map_key)
                            clean_name = re.sub(r'View Player Version.*', '', cap_text, flags=re.IGNORECASE).strip()
                            if not clean_name:
                                clean_name = fid or "Encounter Map"

                            dm_img = elem.find('img')
                            dm_src = dm_img.get('src', '') if dm_img else ''

                            player_a = elem.find('a', string=lambda s: s and 'player' in s.lower()) or elem.find('a', attrs={'data-title': lambda t: t and 'player' in t.lower()})
                            player_href = player_a.get('href', '') if player_a else ''

                            dm_local = download_map_image(dm_src)
                            player_local = download_map_image(player_href)

                            enc_id = str(uuid.uuid4())

                            # Where the map appears in the HTML, insert encounter element in chapter text
                            if current_chapter:
                                current_chapter['content'] += f"@Encounter[{enc_id}]{{{clean_name}}}\n\n"

                            encounter = {
                                "id": enc_id,
                                "name": clean_name,
                                "chapterIds": [current_chapter["id"]] if current_chapter else [],
                                "units": [],
                                "mapSize": {"width": 20, "height": 20},
                                "dmMapUrl": dm_local,
                                "playerMapUrl": player_local
                            }
                            campaign['encounters'].append(encounter)
                            current_encounter = encounter
                        continue

                    text = clean_text(elem.get_text(strip=True))
                    if not text: continue

                    for a in elem.find_all('a', class_='tooltip-hover'):
                        href = a.get('data-tooltip-href', '')
                        if '/monsters/' not in href and '/spells/' not in href and '/magic-items/' not in href:
                            continue

                        item_name = clean_text(a.get_text(strip=True))
                        asset_id = str(uuid.uuid4())
                        id_match = re.search(r'/(?:monsters|spells|magic-items)/(\d+)', href)
                        if id_match:
                            asset_id = id_match.group(1)

                        if '/monsters/' in href:
                            tag_type = 'Monster'
                            if current_encounter is not None:
                                existing_units = [u for u in current_encounter["units"] if u.get("monsterId") == asset_id]
                                if len(existing_units) < 3:
                                    monster_data = monsters_by_id.get(asset_id)
                                    dex_mod = monster_data.get('stats', {}).get('DEX', {}).get('modifier', 0) if monster_data else 0
                                    hp_dice = monster_data.get('attributes', {}).get('hp', {}).get('dice', '1d1') if monster_data else '1d1'
                                    max_hp = monster_data.get('attributes', {}).get('hp', {}).get('value', 10) if monster_data else 10
                                    unit_idx = len(current_encounter["units"])
                                    unit_name = f"{item_name} {len(existing_units) + 1}" if existing_units else item_name
                                    current_encounter["units"].append({
                                        "instanceId": str(uuid.uuid4()),
                                        "monsterId": asset_id,
                                        "name": unit_name,
                                        "hpDice": hp_dice,
                                        "maxHp": max_hp,
                                        "dexMod": dex_mod,
                                        "isPlayer": False,
                                        "position": {
                                            "x": min(18, 2 + (unit_idx % 6) * 2),
                                            "y": min(18, 2 + (unit_idx // 6) * 2)
                                        }
                                    })
                        elif '/spells/' in href:
                            tag_type = 'Spell'
                        else:
                            tag_type = 'Item'

                        text = text.replace(item_name, f"@{tag_type}[{asset_id}]{{{item_name}}}")
                    
                    # Replace references to Wildemount World Assets
                    if wildemount_asset_ids and world_assets_by_id:
                        text = replace_world_references(text, wildemount_asset_ids, world_assets_by_id, campaign, current_chapter)

                    if elem.name in ['h1', 'h2']:
                        if current_chapter:
                            campaign['chapters'].append(current_chapter)

                        current_chapter = {
                            "id": str(uuid.uuid4()),
                            "title": text,
                            "content": "",
                            "order": len(campaign['chapters'])
                        }
                        current_encounter = None
                    elif current_chapter and elem.name == 'h3':
                        current_chapter['content'] += f"## {text}\n\n"
                    elif current_chapter and elem.name in ['h4', 'h5']:
                        current_chapter['content'] += f"### {text}\n\n"
                    elif current_chapter and elem.name == 'p':
                        current_chapter['content'] += f"{text}\n\n"
                    elif current_chapter and elem.name == 'ul':
                        for li in elem.find_all('li'):
                            li_text = clean_text(li.get_text(strip=True))
                            current_chapter['content'] += f"- {li_text}\n"
                        current_chapter['content'] += "\n"

                if current_chapter:
                    campaign['chapters'].append(current_chapter)

                # Ensure any encounters with 0 units get populated from monsters in their chapter
                for enc in campaign['encounters']:
                    if len(enc['units']) == 0 and enc.get('chapterIds'):
                        chap = next((c for c in campaign['chapters'] if c['id'] in enc['chapterIds']), None)
                        if chap:
                            found_monsters = re.findall(r'@Monster\[([^\]]+)\]\{([^}]+)\}', chap['content'])
                            seen_m_ids = set()
                            for m_id, m_name in found_monsters:
                                if m_id not in seen_m_ids and len(enc['units']) < 6:
                                    seen_m_ids.add(m_id)
                                    monster_data = monsters_by_id.get(m_id)
                                    dex_mod = monster_data.get('stats', {}).get('DEX', {}).get('modifier', 0) if monster_data else 0
                                    hp_dice = monster_data.get('attributes', {}).get('hp', {}).get('dice', '1d1') if monster_data else '1d1'
                                    max_hp = monster_data.get('attributes', {}).get('hp', {}).get('value', 10) if monster_data else 10
                                    unit_idx = len(enc["units"])
                                    enc["units"].append({
                                        "instanceId": str(uuid.uuid4()),
                                        "monsterId": m_id,
                                        "name": m_name,
                                        "hpDice": hp_dice,
                                        "maxHp": max_hp,
                                        "dexMod": dex_mod,
                                        "isPlayer": False,
                                        "position": {
                                            "x": min(18, 2 + (unit_idx % 6) * 2),
                                            "y": min(18, 2 + (unit_idx // 6) * 2)
                                        }
                                    })

                scraped_campaigns.append(campaign)
            else:
                print(f"Could not find the main content area in {adv_slug}.")

        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(scraped_campaigns, f, indent=2)

        print(f"Finished scraping. Generated {len(scraped_campaigns)} standalone adventure campaigns.")

    finally:
        if page and page.url == "about:blank":
            page.close()
        if playwright_mgr:
            playwright_mgr.stop()
if __name__ == "__main__":
    main()