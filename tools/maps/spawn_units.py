"""Populate encounter units from authoritative compiled-map spawns.

The compiled maps (public/data/maps/<mapId>.json) carry the token start
positions from the D&D Beyond scene, each tagged with a `ddbMonsterId` that is
the same ID space as public/data/monsters.json. For any encounter whose map has
spawns, those replace whatever units were guessed from the adventure text.

Usable as a library (adventure_scraper.py) or as a CLI to re-apply to an
existing scraped_campaign.json:  python tools/maps/spawn_units.py
"""
import json
import os
import sys
import uuid
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MAPS_DIR = os.path.join(ROOT, 'public', 'data', 'maps')
MONSTERS_FILE = os.path.join(ROOT, 'public', 'data', 'monsters.json')
CAMPAIGN_FILE = os.path.join(ROOT, 'public', 'data', 'scraped_campaign.json')

FACTIONS = {'hostile': 'enemy', 'friendly': 'ally', 'neutral': 'neutral'}


def load_monsters_by_id():
    with open(MONSTERS_FILE, encoding='utf-8') as f:
        return {str(m['id']): m for m in json.load(f) if 'id' in m}


def load_spawns(map_id):
    path = os.path.join(MAPS_DIR, f'{map_id}.json')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f).get('spawns') or []
    except OSError:
        return []


def units_from_spawns(spawns, monsters_by_id):
    """Build encounter units from spawns; spawns with no known monster are skipped."""
    usable = [s for s in spawns if str(s.get('ddbMonsterId')) in monsters_by_id]
    name_counts = Counter(s['name'] for s in usable)
    seen = Counter()
    units = []
    for s in usable:
        monster = monsters_by_id[str(s['ddbMonsterId'])]
        seen[s['name']] += 1
        name = f"{s['name']} {seen[s['name']]}" if name_counts[s['name']] > 1 else s['name']
        attrs = monster.get('attributes', {})
        units.append({
            'instanceId': str(uuid.uuid4()),
            'monsterId': str(monster['id']),
            'name': name,
            'hpDice': attrs.get('hp', {}).get('dice', '1d1'),
            'maxHp': attrs.get('hp', {}).get('value', 10),
            'dexMod': monster.get('stats', {}).get('DEX', {}).get('modifier', 0),
            'isPlayer': False,
            'faction': FACTIONS.get(s.get('disposition'), 'enemy'),
            'position': {'x': s['cell']['x'], 'y': s['cell']['y']},
        })
    return units


def apply_spawn_units(encounters, monsters_by_id):
    """Replace units on every encounter whose compiled map has spawns. Returns count replaced."""
    replaced = 0
    for enc in encounters:
        map_id = (enc.get('gridConfig') or {}).get('mapId')
        if not map_id:
            continue
        units = units_from_spawns(load_spawns(map_id), monsters_by_id)
        if units:
            enc['units'] = units
            replaced += 1
    return replaced


def main():
    monsters = load_monsters_by_id()
    with open(CAMPAIGN_FILE, encoding='utf-8') as f:
        campaigns = json.load(f)
    total = sum(apply_spawn_units(c['encounters'], monsters) for c in campaigns)
    with open(CAMPAIGN_FILE, 'w', encoding='utf-8') as f:
        json.dump(campaigns, f, indent=2)
    print(f'Replaced units from map spawns on {total} encounters.')


if __name__ == '__main__':
    sys.exit(main())
