import os
import json
import re
import time
import random
import argparse
import uuid
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright

STATE_FILE = "tools/adventure_scraper_state.json"
DATA_FILE = "public/data/scraped_campaign.json"

def slugify(text):
    return re.sub(r'[\s_]+', '-', text.lower()).strip('-')

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Ignore persistent state')
    parser.add_argument('--offline', action='store_true', help='Do not make web requests. Only process cached files.')
    args = parser.parse_args()

    # Read base URL
    base_url = ""
    if os.path.exists('url.txt'):
        with open('url.txt', 'r', encoding='utf-8') as f:
            base_url = f.read().strip()
    elif not args.offline:
        print("url.txt not found!")
        return

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
                    "encounters": []
                }
                known_assets = {}
                current_chapter = None

                for elem in content_area.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'ul', 'div']):
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

                        if asset_id not in known_assets:
                            if '/monsters/' in href:
                                item_type = 'NPC'
                            elif '/spells/' in href:
                                item_type = 'Spell'
                            else:
                                item_type = 'Item'
                            known_assets[asset_id] = item_name
                            new_asset = {
                                "id": asset_id,
                                "name": item_name,
                                "type": item_type,
                                "description": f"Scraped link to: {item_name} ({href})"
                            }
                            if current_chapter:
                                new_asset["chapterIds"] = [current_chapter["id"]]
                            campaign['assets'].append(new_asset)
                        elif current_chapter:
                            # Add chapterId to existing asset
                            asset = next((a for a in campaign['assets'] if a['id'] == asset_id), None)
                            if asset:
                                if "chapterIds" not in asset:
                                    asset["chapterIds"] = []
                                if current_chapter["id"] not in asset["chapterIds"]:
                                    asset["chapterIds"].append(current_chapter["id"])

                        text = text.replace(item_name, f"@Asset[{asset_id}]{{{item_name}}}")
                    if elem.name in ['h1', 'h2']:
                        if current_chapter:
                            campaign['chapters'].append(current_chapter)

                        current_chapter = {
                            "id": str(uuid.uuid4()),
                            "title": text,
                            "content": "",
                            "order": len(campaign['chapters'])
                        }
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