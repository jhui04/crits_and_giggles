import os
import json
import uuid
import re
from bs4 import BeautifulSoup
from urllib.parse import urljoin

DATA_FILE = "public/data/scraped_campaign.json"

def clean_text(text):
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def main():
    print("Reparsing cached adventures offline...")
    
    index_filepath = os.path.join("dnd_beyond", "adventures", "index.html")
    if not os.path.exists(index_filepath):
        print("Missing index.html")
        return
        
    with open(index_filepath, 'r', encoding='utf-8') as f:
        index_html = f.read()
        
    soup = BeautifulSoup(index_html, 'html.parser')
    
    adventure_links = []
    for a in soup.find_all('a'):
        if not a.has_attr('href'): continue
        href = a['href']
        if 'adventures-in-wildemount-' in href and href not in adventure_links:
            if '#' not in href:
                adventure_links.append(href)

    print(f"Found {len(adventure_links)} adventures.")

    scraped_campaigns = []

    for adv_link in adventure_links:
        adv_slug = adv_link.split('/')[-1]
        adv_filepath = os.path.join("dnd_beyond", "adventures", f"{adv_slug}.html")

        if not os.path.exists(adv_filepath):
            print(f"Missing cached file for {adv_slug}")
            continue
            
        with open(adv_filepath, 'r', encoding='utf-8') as f:
            adv_html = f.read()

        adv_soup = BeautifulSoup(adv_html, 'html.parser')
        content_area = adv_soup.select_one('.p-article-content') or adv_soup.select_one('article') or adv_soup.select_one('.primary-content')

        if content_area:
            print(f"Parsing adventure {adv_slug}...")
            
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
                    if '/monsters/' not in href and '/spells/' not in href:
                        continue
                        
                    item_type = 'NPC' if '/monsters/' in href else 'Item'
                        
                    item_name = clean_text(a.get_text(strip=True))
                    if item_name not in known_assets:
                        asset_id = str(uuid.uuid4())
                        id_match = re.search(r'/(?:monsters|spells)/(\d+)', href)
                        if id_match:
                            asset_id = id_match.group(1)
                            
                        known_assets[item_name] = asset_id
                        campaign['assets'].append({
                            "id": asset_id,
                            "name": item_name,
                            "type": item_type,
                            "description": f"Scraped link to: {item_name} ({href})"
                        })
                    
                    text = text.replace(item_name, f"@Asset[{known_assets[item_name]}]{{{item_name}}}")

                if elem.name in ['h1', 'h2']:
                    if current_chapter:
                        campaign['chapters'].append(current_chapter)
                        
                    current_chapter = {
                        "id": str(uuid.uuid4()),
                        "title": text,
                        "content": f"# {text}\n\n",
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

    print(f"Finished parsing. Generated {len(scraped_campaigns)} standalone adventure campaigns.")

if __name__ == "__main__":
    main()
