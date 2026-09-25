"""Non-visual verification and the plain-text audit report (plan Phase 5).

Every check works on the MapDocument itself, on the adventure text, or on independent
methods. Nothing here needs anyone to look at an image.
"""
import math
import re

import regions as rg
from objects import OBJECT_RULES

WALKABLE_BLOCKED = {'#', 'B', '^'}

# keyword -> ('object', kinds) or ('terrain', classes)
FEATURE_WORDS = [
    (r'\btables?\b', 'object', ('table', 'chairs_and_tables'), 'tables'),
    (r'\bstatues?\b', 'object', ('statue',), 'a statue'),
    (r'\bpillars?\b', 'object', ('pillar',), 'pillars'),
    (r'\bpalm\b', 'object', ('palm_tree',), 'palm trees'),
    (r'\bstalls?\b', 'object', ('market_stall',), 'market stalls'),
    (r'\b(crates?|barrels?)\b', 'object', ('crate',), 'crates or barrels'),
    (r'\bbeds?\b', 'object', ('bed',), 'beds'),
    (r'\bfountain\b', 'object', ('fountain',), 'a fountain'),
    (r'\b(the|a|an|old|stone|dry) well\b', 'object', ('fountain',), 'a well'),
    (r'\b(pool|water|waves|sea|ocean)\b', 'terrain', ('water_deep', 'water_shallow'), 'water'),
    (r'\b(beach|sand|sandy)\b', 'terrain', ('sand',), 'sand'),
    (r'\bbridge\b', 'terrain', ('wood_floor',), 'a bridge'),
]

KIND_PLURAL = {'palm_tree': 'Palm trees', 'market_stall': 'Market stalls', 'chairs_and_tables': 'Chairs and tables',
               'table': 'Tables', 'pillar': 'Pillars', 'statue': 'Statues', 'building': 'Buildings',
               'cottage': 'Cottages', 'crate': 'Crates', 'bed': 'Beds', 'fireplace': 'Fireplaces',
               'fountain': 'Fountains', 'boulder': 'Boulders', 'tree': 'Trees', 'door': 'Doors',
               'rubble': 'Rubble'}
COVER_WORDS = {'none': 'no cover', 'half': 'half cover', 'three_quarters': 'three-quarters cover',
               'total': 'total cover'}


def add(doc, level, code, message):
    doc['audit'].append({'level': level, 'code': code, 'message': message})


def strip_tags(text):
    """Replace 5etools {@tag text|rest} markup with its visible text."""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r'\{@\w+ ([^{}|]*)(?:\|[^{}]*)?\}', r'\1', text)
    return text


def flatten_text(node):
    parts = []

    def walk(o):
        if isinstance(o, str):
            parts.append(strip_tags(o))
        elif isinstance(o, dict):
            for k in ('entries', 'items', 'entry'):
                if k in o:
                    walk(o[k])
            if 'name' in o and o.get('type') in ('item', 'entries'):
                parts.append(strip_tags(str(o['name'])))
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(node.get('entries', []))
    return ' '.join(parts)


def _cells(r):
    return {tuple(int(v) for v in c.split(',')) for c in r['cells']}


def check_doors(doc):
    segs = [w for w in doc['walls'] if w['kind'] not in ('door', 'secret_door', 'invisible')]
    doors = [w for w in doc['walls'] if w['kind'] in ('door', 'secret_door')]
    if not doors:
        return
    bad = 0
    for d in doors:
        # A door sits in a gap between wall segments, so one of its ends meets the neighbouring wall.
        ok = False
        for w in segs:
            ax, ay, bx, by = w['a']['x'], w['a']['y'], w['b']['x'], w['b']['y']
            dx, dy = bx - ax, by - ay
            ln = dx * dx + dy * dy
            for end in (d['a'], d['b']):
                t = 0.0 if ln == 0 else max(0.0, min(1.0, ((end['x'] - ax) * dx + (end['y'] - ay) * dy) / ln))
                if math.hypot(end['x'] - (ax + t * dx), end['y'] - (ay + t * dy)) <= 0.3:
                    ok = True
                    break
            if ok:
                break
        bad += not ok
    if bad:
        add(doc, 'warn', 'DOOR_FLOATING', f'{bad} of {len(doors)} doors do not touch any wall.')
    else:
        add(doc, 'ok', 'DOORS_ATTACHED', f'All {len(doors)} doors touch a wall.')


def check_spawns(doc):
    layer = doc.get('terrain')
    if not doc['spawns'] or not layer:
        return
    rows = layer['rows']
    deep = blocked = 0
    for s in doc['spawns']:
        x, y = s['cell']['x'], s['cell']['y']
        if not (0 <= y < len(rows) and 0 <= x < len(rows[0])):
            blocked += 1
            continue
        ch = rows[y][x]
        if ch in WALKABLE_BLOCKED:
            blocked += 1
        elif ch == 'W':
            deep += 1
    if blocked:
        add(doc, 'warn', 'SPAWN_BLOCKED', f'{blocked} of {len(doc["spawns"])} monster start positions fall on '
            'terrain that looks impassable. Either the terrain or the start position is off.')
    else:
        add(doc, 'ok', 'SPAWNS_WALKABLE', f'All {len(doc["spawns"])} monster start positions are on walkable ground.')
    if deep:
        add(doc, 'info', 'SPAWN_DEEP_WATER', f'{deep} monster start positions are in deep water. That is normal for swimmers.')


def check_labels(doc):
    far = []
    for r in doc['regions']:
        cells = _cells(r)
        if not cells:
            continue
        for lc in r['labelCells']:
            near = any((lc['x'] + dx, lc['y'] + dy) in cells for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            if not near:
                far.append(r['id'])
                break
    if far:
        add(doc, 'warn', 'LABEL_OUTSIDE_REGION', 'These regions have a map pin more than one cell outside their area: ' +
            ', '.join(far) + '.')


def check_regions(doc):
    owner, overlap = {}, 0
    for r in doc['regions']:
        for c in r['cells']:
            if c in owner:
                overlap += 1
            owner[c] = r['id']
    if overlap:
        add(doc, 'warn', 'REGIONS_OVERLAP', f'{overlap} cells belong to more than one region.')
    split = []
    for r in doc['regions']:
        cells = _cells(r)
        if len(cells) > 1 and len(rg.connected_components(cells)) > 1:
            split.append(r['id'])
    if split:
        add(doc, 'info', 'REGION_SPLIT', 'These regions are made of separate pieces: ' + ', '.join(split) + '.')
    elif doc['regions'] and not overlap:
        add(doc, 'ok', 'REGIONS_CLEAN', 'No regions overlap, and each region is in one piece.')


def check_objects(doc):
    layer = doc.get('terrain')
    if not layer:
        return
    rows = layer['rows']
    bad = 0
    for o in doc['objects']:
        if o['kind'] in ('building', 'cottage', 'door'):
            continue
        for c in o['cells']:
            x, y = (int(v) for v in c.split(','))
            if 0 <= y < len(rows) and 0 <= x < len(rows[0]) and rows[y][x] in ('W', '#'):
                bad += 1
                break
    if bad:
        add(doc, 'warn', 'OBJECT_ON_WATER', f'{bad} objects sit on deep water or empty space, so they or the terrain are wrong.')


def _region_has(doc, region, kinds, classes):
    cells = {c for c in region['cells']}
    if kinds:
        for o in doc['objects']:
            if o['kind'] in kinds and (o.get('regionId') == region['id'] or cells & set(o['cells'])):
                return True
        return False
    layer = doc.get('terrain')
    rows = layer['rows'] if layer else None
    if rows is None:
        return True
    codes = {tr_code(c) for c in classes}
    for c in cells:
        x, y = (int(v) for v in c.split(','))
        if rows[y][x] in codes:
            return True
    return False


def tr_code(cls):
    from terrain import CODES
    return CODES[cls]


def check_expected_features(doc, area_nodes):
    """Compare the book's area text against what was detected; ask the DM about mismatches."""
    layer = doc.get('terrain')
    terrain_known = bool(layer) and any(ch != '?' for row in layer['rows'] for ch in row)
    objects_attempted = any(a['code'] in ('OBJECTS_FROM_LEGEND', 'OBJECTS_FROM_LABELS') for a in doc['audit'])
    n = 0
    for r in doc['regions']:
        ref = r.get('textRef')
        node = area_nodes.get(ref['areaId']) if ref else None
        if not node or not r['cells']:
            continue
        text = flatten_text(node).lower()
        for pattern, kind, targets, phrase in FEATURE_WORDS:
            if not re.search(pattern, text):
                continue
            if kind == 'object':
                if not objects_attempted:
                    continue
                present = _region_has(doc, r, targets, None)
            else:
                if not terrain_known:
                    continue
                present = _region_has(doc, r, None, targets)
            if present:
                continue
            n += 1
            if kind == 'object':
                msg = (f'The text for {r["id"]} {r["name"]} mentions {phrase}, but none were detected in '
                       f'{r["id"]}. If they are there, tell the assistant "{r["id"]} has {phrase} '
                       'along the south side" to add them.')
            else:
                msg = (f'The text for {r["id"]} {r["name"]} mentions {phrase}, but the terrain data shows none '
                       f'in {r["id"]}. If that is wrong, tell the assistant "{r["id"]} has {phrase} '
                       'in the middle" to correct it.')
            add(doc, 'question', 'EXPECTED_FEATURE_MISSING', msg)
    return n


def judgment_questions(doc):
    seen = set()
    for o in doc['objects']:
        k = o['kind']
        if k in seen or k not in OBJECT_RULES or k in ('building', 'door'):
            continue
        seen.add(k)
        cover = COVER_WORDS[o['cover']]
        other = 'three-quarters cover' if o['cover'] == 'half' else 'half cover'
        add(doc, 'question', 'DEFAULT_COVER',
            f'{KIND_PLURAL.get(k, k.title())} are set to {cover}. Keep it, or change to {other}? '
            f'To change it, tell the assistant "{KIND_PLURAL.get(k, k.title()).lower()} give {other}".')


def wall_summary(doc):
    if not doc['walls']:
        return
    kinds = {}
    for w in doc['walls']:
        kinds[w['kind']] = kinds.get(w['kind'], 0) + 1
    conf = doc['walls'][0]['provenance']['confidence']
    state = 'trusted' if conf >= 0.5 else 'stored but ignored for movement and cover'
    add(doc, 'info', 'WALLS_SUMMARY', f'There are {len(doc["walls"])} wall segments ({state}): ' +
        ', '.join(f'{v} {k.replace("_", " ")}' for k, v in sorted(kinds.items())) + '.')


def verify_document(doc, area_nodes=None):
    check_doors(doc)
    check_spawns(doc)
    check_labels(doc)
    check_regions(doc)
    check_objects(doc)
    wall_summary(doc)
    if area_nodes:
        check_expected_features(doc, area_nodes)
    judgment_questions(doc)


# ------------------------------------------------------------------ report

def audit_markdown(doc):
    """Plain, linear text: one heading per section, short sentences, no tables or images."""
    by = {'warn': [], 'question': [], 'ok': [], 'info': []}
    for a in doc['audit']:
        by.setdefault(a['level'], []).append(a['message'])
    g = doc['grid']
    lines = [f'# Audit for {doc["title"]}', '']
    lines += ['## Summary', '']
    if doc['kind'] == 'overview':
        lines.append('This is an overview map. Tactical rules do not apply.')
    else:
        lines.append(f'The grid is {g["columns"]} columns by {g["rows"]} rows, at {g["feetPerCell"]} feet per cell.')
    lines.append(f'The printed scale reads: {g["printedScale"]}.')
    lines.append(f'The map has {len(doc["regions"])} regions, {len(doc["walls"])} wall segments, '
                 f'{len(doc["objects"])} objects, and {len(doc["spawns"])} monster start positions.')
    nw, nq = len(by['warn']), len(by['question'])
    lines.append(f'There {"is" if nw == 1 else "are"} {nw} {"warning" if nw == 1 else "warnings"} '
                 f'and {nq} {"question" if nq == 1 else "questions"}.')
    lines.append('')
    for title, key, empty in (('Warnings', 'warn', 'No warnings.'),
                              ('Questions for you', 'question', 'No questions.'),
                              ('Checks that passed', 'ok', 'No checks recorded.'),
                              ('Other notes', 'info', 'No other notes.')):
        lines += [f'## {title}', '']
        if by[key]:
            lines += [f'- {m}' for m in by[key]]
        else:
            lines.append(empty)
        lines.append('')
    return '\n'.join(lines)


def console_summary(doc):
    warns = sum(1 for a in doc['audit'] if a['level'] == 'warn')
    qs = sum(1 for a in doc['audit'] if a['level'] == 'question')
    g = doc['grid']
    return (f'{doc["title"]}: {g.get("columns")} by {g.get("rows")} cells, {len(doc["regions"])} regions, '
            f'{len(doc["walls"])} walls, {len(doc["objects"])} objects, '
            f'{warns} {"warning" if warns == 1 else "warnings"}, {qs} {"question" if qs == 1 else "questions"}.')
