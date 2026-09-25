"""Blind map extraction: give a vision model only the raw map art plus a plain coordinate grid (no parsed data) and
ask it to describe terrain, walls and objects as geometry in cell coordinates. Meant for maps that have no
third-party data. On maps that do (for example 5.1), compare.py scores the result against the known features.

Each layer is one model call, so the layers can be run together in one call ('all') or split up.
Nothing here edits the map. Output goes to tools/state/judge/<mapId>/extract/<tag>/.

Usage (from the repo root):
    python tools/maps/extract.py 5.1 --layers all --tag A                        # one call, everything
    python tools/maps/extract.py 5.1 --layers terrain,walls,objects --tag B      # three calls
    python tools/maps/extract.py 5.1 --layers terrain,walls,objects --tiles 2 --tag C
    python tools/maps/extract.py 5.1 --refine-from T --tiles 2 --tag R           # second look: add what a first pass missed
    python tools/maps/extract.py 5.1 --layers all --tag A --render-only          # write images and prompts, call nothing

A call ledger (tools/state/judge/_calls.json) counts every model call and refuses to go past its limit.
"""
import argparse
import hashlib
import json
import os
import sys
import time

import cv2
import numpy as np

from common import MapBuildError, read_image, url_to_path
from judge import JUDGE_DIR, TERRAIN, extract_json, load_doc, make_tiles, put_label, run_backend, write_img

LEDGER = os.path.join(JUDGE_DIR, '_calls.json')
DEFAULT_LIMIT = 10
SUPER = 8  # sub-cells per cell when rasterising polygons

TERRAIN_CHARS = {'void': '#', 'building': 'B', 'cliff': '^', 'water_deep': 'W', 'water_shallow': 'w', 'sand': 's', 'grass': 'g',
                 'dirt': 'd', 'stone_floor': 'f', 'wood_floor': 'p', 'rubble': 'r', 'dense_vegetation': 'v', 'mud': 'm', 'ice': 'i',
                 'unknown': '?'}
WALL_KINDS = {'wall', 'terrain_outline', 'low_wall', 'window', 'door', 'secret_door', 'invisible'}
COVERS = {'none', 'half', 'three_quarters', 'total'}


# ---------------------------------------------------------------- call ledger

def ledger_state():
    if os.path.exists(LEDGER):
        with open(LEDGER, encoding='utf-8') as f:
            return json.load(f)
    return {'limit': DEFAULT_LIMIT, 'calls': []}


def ledger_charge(map_id, label):
    """Count a model call BEFORE making it, so a crash or timeout still counts against the limit."""
    st = ledger_state()
    if len(st['calls']) >= st['limit']:
        raise MapBuildError(f"The call ledger is full ({len(st['calls'])} of {st['limit']} calls used). Raise 'limit' in {LEDGER} to allow more.")
    st['calls'].append({'at': time.strftime('%Y-%m-%d %H:%M:%S'), 'map': map_id, 'label': label})
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    with open(LEDGER, 'w', encoding='utf-8') as f:
        json.dump(st, f, indent=2)
    return len(st['calls']), st['limit']


# ---------------------------------------------------------------- images

def render_grid(img, im, cols, rows):
    """A plain coordinate grid on the raw art: thin line per cell, heavier line every 5 cells, and an 'x,y' label at every
    5-cell crossing. Labels are absolute map cell coordinates, so crops of this image keep meaningful numbers."""
    cp = im['cellPx']
    ox, oy = im['originX'], im['originY']
    out = img.copy()
    layer = out.copy()

    def p(x, y):
        return int(round(ox + x * cp)), int(round(oy + y * cp))
    for x in range(cols + 1):
        cv2.line(layer, p(x, 0), p(x, rows), (60, 60, 60) if x % 5 else (0, 0, 200), 1 if x % 5 else 2)
    for y in range(rows + 1):
        cv2.line(layer, p(0, y), p(cols, y), (60, 60, 60) if y % 5 else (0, 0, 200), 1 if y % 5 else 2)
    out = cv2.addWeighted(layer, 0.6, out, 0.4, 0)
    for y in range(0, rows + 1, 5):
        for x in range(0, cols + 1, 5):
            px_, py_ = p(x, y)
            put_label(out, f'x{x} y{y}', (px_ + 3, py_ + 14), (0, 0, 160), 0.5)
    return out


# ---------------------------------------------------------------- prompts

PREAMBLE = """You are the eyes for a blind person who runs a tabletop D&D 5e game. Look at the battle map artwork and describe it as
geometry in the game's grid coordinates. Nothing else describes this map, so be careful and honest. Do not invent things you
cannot see. Skip anything you are unsure about rather than guessing.

Files to read (use the Read tool on the image files):
{files}

Coordinates:
- The GRID image is the same artwork with a grid drawn on it. One grid square is one game cell (5 feet). The printed squares in
  the artwork can be a different size, so trust the drawn grid, not the printed squares.
- Cell (x,y) is the square whose top-left corner is grid corner (x,y). x grows to the right, y grows downward, both start at 0.
- Red lines are every 5th grid line. Each red crossing is labelled with its corner coordinates, for example "x10 y5" means the corner at x=10, y=5. Use those labels to place
  everything. The map is {cols} cells wide (x 0-{colsm}) and {rows} cells tall (y 0-{rowsm}).
- Give every point as [x,y] in grid CORNER coordinates, numbers with at most one decimal (for example [12.5, 30]).
- Ignore: the compass rose, the printed legend box, printed scale text, numbered or lettered circles that label areas, and the
  paper margin around the map. Do not report monsters or tokens.
"""

TERRAIN_SPEC = """TERRAIN
Paint the ground the way a creature walking on it would experience it. Areas are painted in order, so a later area covers an
earlier one. Start with big areas, then paint smaller ones on top. Cells you never paint get "default".
Classes: void (not part of the playable map: paper margin, solid rock outside a cave, legend box), building (roofed
structure), cliff, water_deep, water_shallow, sand, grass, dirt, stone_floor (stone, paved, cave or dungeon floor), wood_floor
(planks, docks, bridges, decks), rubble, dense_vegetation, mud, ice, unknown.
"terrain" object shape:
  {{"default":"void","areas":[{{"terrain":"<class>","polygon":[[x,y],[x,y],...]}}, ...]}}
Each polygon needs at least 3 points and follows the visible edge of the area closely. Use as many polygons as the map needs
(coastlines, roads, roof footprints, pools). Do not skip small distinct areas such as docks, piers and bridges.
"""

WALLS_SPEC = """WALLS
Trace the lines a creature cannot walk or see through. Follow the drawn edge. Include: room and building walls, the outline
of every roofed building, cave walls, cliff edges, and other solid outlines such as a ship's hull or a statue base. Also include
doors and windows where they are drawn. Do not trace open coastlines or paths. Every wall is a polyline:
"walls" array shape:
  [{{"kind":"wall|terrain_outline|low_wall|door|window|secret_door","points":[[x,y],[x,y],...],"closed":false}}]
Use "closed":true for a loop such as a building outline (do not repeat the first point). "terrain_outline" is for outlines of
solid terrain features (roofs, cliffs, hulls, statues); "wall" is for constructed walls, cave walls and fences that block movement.
"""

OBJECTS_SPEC = """OBJECTS
List every distinct object a creature could hide behind, stand on, or be blocked by: buildings and cottages, doors, furniture,
tables and chairs, market stalls, crates, barrels, pillars, statues, trees, boats, fences and similar. If the map prints a
legend, use its names for the kinds. List each instance separately, do not lump a group into one entry. Objects that are part of the
ground (a road, a beach, a pond) are terrain, not objects.
"objects" array shape:
  [{{"kind":"snake_case_kind","label":"short text","box":[x0,y0,x1,y1],"cover":"none|half|three_quarters|total"}}]
"box" is the smallest rectangle of whole cells that covers the object: x0,y0 is the top-left cell, x1,y1 the bottom-right cell,
both inclusive. A single-cell object has x0==x1 and y0==y1.
"""

OUTPUT_ONE = """Reply with ONLY one JSON object, no prose and no code fence, in exactly this shape:
{shape}
"""

SHAPES = {
    'terrain': '{"terrain": <the terrain object above>}',
    'walls': '{"walls": <the walls array above>}',
    'objects': '{"objects": <the objects array above>}',
}
SPECS = {'terrain': TERRAIN_SPEC, 'walls': WALLS_SPEC, 'objects': OBJECTS_SPEC}


def build_prompt(layers, files, cols, rows):
    head = PREAMBLE.format(files='\n'.join(f'- {n}: {d}' for n, d in files), cols=cols, rows=rows, colsm=cols - 1, rowsm=rows - 1)
    body = '\n'.join(SPECS[l] for l in layers)
    shape = '{' + ', '.join(f'"{l}": <the {l} {"object" if l == "terrain" else "array"} above>' for l in layers) + '}'
    return head + '\n' + body + '\n' + OUTPUT_ONE.format(shape=shape)


# ---------------------------------------------------------------- validation

def clean_point(p, cols, rows):
    if not (isinstance(p, (list, tuple)) and len(p) == 2 and all(isinstance(v, (int, float)) for v in p)):
        return None
    return [min(max(float(p[0]), 0.0), float(cols)), min(max(float(p[1]), 0.0), float(rows))]


def clean_layers(reply, layers, cols, rows):
    notes = []
    out = {}
    if 'terrain' in layers:
        t = reply.get('terrain') or {}
        default = t.get('default') if t.get('default') in TERRAIN else 'void'
        areas = []
        for a in t.get('areas') or []:
            pts = [clean_point(p, cols, rows) for p in a.get('polygon') or []]
            if a.get('terrain') not in TERRAIN or len(pts) < 3 or any(p is None for p in pts):
                notes.append(f"Dropped a terrain area ({a.get('terrain')}, {len(pts)} points).")
                continue
            areas.append({'terrain': a['terrain'], 'polygon': pts})
        out['terrain'] = {'default': default, 'areas': areas}
    if 'walls' in layers:
        walls = []
        for w in reply.get('walls') or []:
            pts = [clean_point(p, cols, rows) for p in w.get('points') or []]
            if len(pts) < 2 or any(p is None for p in pts):
                notes.append('Dropped a wall with bad points.')
                continue
            kind = w.get('kind') if w.get('kind') in WALL_KINDS else 'wall'
            walls.append({'kind': kind, 'points': pts, 'closed': bool(w.get('closed'))})
        out['walls'] = walls
    if 'objects' in layers:
        objs = []
        for o in reply.get('objects') or []:
            b = o.get('box')
            if not (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)):
                notes.append(f"Dropped object '{o.get('kind')}' with a bad box.")
                continue
            x0, y0, x1, y1 = (int(round(v)) for v in b)
            x0, x1 = sorted((x0, x1))
            y0, y1 = sorted((y0, y1))
            if x1 < 0 or y1 < 0 or x0 >= cols or y0 >= rows:
                notes.append(f"Dropped object '{o.get('kind')}' outside the map.")
                continue
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, cols - 1), min(y1, rows - 1)
            objs.append({'kind': str(o.get('kind') or 'object'), 'label': str(o.get('label') or ''), 'box': [x0, y0, x1, y1],
                         'cover': o.get('cover') if o.get('cover') in COVERS else 'none'})
        out['objects'] = objs
    return out, notes


# ---------------------------------------------------------------- rasterising

def rasterize_terrain(t, cols, rows):
    """Paint polygons in order. A cell takes an area's class when at least half of it lies inside the polygon."""
    cls = np.full((rows, cols), t['default'], dtype=object)
    for a in t['areas']:
        mask = np.zeros((rows * SUPER, cols * SUPER), np.uint8)
        pts = np.array([[p[0] * SUPER, p[1] * SUPER] for p in a['polygon']], np.int32)
        cv2.fillPoly(mask, [pts], 1)
        cover = mask.reshape(rows, SUPER, cols, SUPER).mean(axis=(1, 3))
        cls[cover >= 0.5] = a['terrain']
    return [''.join(TERRAIN_CHARS[cls[y, x]] for x in range(cols)) for y in range(rows)]


def wall_segments(walls):
    segs = []
    for w in walls:
        pts = w['points']
        for a, b in zip(pts, pts[1:]):
            segs.append((w['kind'], a, b))
        if w['closed'] and len(pts) > 2:
            segs.append((w['kind'], pts[-1], pts[0]))
    return segs


# ---------------------------------------------------------------- second look

REFINE_PROMPT = """You are the eyes for a blind person who runs a tabletop D&D 5e game. A first pass already described this battle map
as walls and objects in the game's grid coordinates. Your job is a careful second look: find what it MISSED and what it got WRONG.

Files to read (use the Read tool on the image files):
{files}

Coordinates (same as the first pass):
- One grid square is one game cell (5 feet); trust the drawn grid, not any squares printed in the artwork.
- Cell (x,y) is the square whose top-left corner is grid corner (x,y). x grows right, y grows down, both start at 0.
- Red lines are every 5th grid line, labelled at each crossing like "x10 y5" (corner x=10, y=5). The map is {cols} cells wide
  (x 0-{colsm}) and {rows} cells tall (y 0-{rowsm}).
- Ignore the compass rose, the printed legend box, printed scale text, numbered or lettered area circles, and the paper margin.
  Do not report monsters or tokens.

The REVIEW image and crops show the first pass on top of the artwork:
- Magenta boxes with ids like o12 are objects (kind shown next to the id).
- Cyan lines with ids like w3 are walls.
The first pass found {n_obj} objects and {n_wall} walls.

Check, in this order:
1. Objects still missing. Go through the artwork region by region and list every object with no magenta box on it: trees, doors,
   pillars, furniture, stalls, crates, statues, boats and anything else a creature could hide behind or be blocked by. Dense groups
   (a palm grove) are the most likely place for misses; count them carefully. Use the printed legend's names for kinds when there is one.
2. Objects that are wrong: not really an object, a duplicate of another box, or the wrong kind. Give the id.
3. Objects whose box is clearly off the thing it should cover (by more than about one cell). Give the id and the corrected box.
4. Walls still missing: outlines of buildings, fences, hulls, cliff edges and doors that have no cyan line. Trace them as new walls.
5. Walls that are wrong or float in open space. Give the id.
Only report what you can see. Do not repeat things the first pass already got right.

Reply with ONLY one JSON object, no prose and no code fence, in exactly this shape:
{{
  "add_objects": [{{"kind":"snake_case_kind","label":"short text","box":[x0,y0,x1,y1],"cover":"none|half|three_quarters|total"}}],
  "fix_objects": [{{"id":"o12","box":[x0,y0,x1,y1]}}],
  "remove_objects": ["o3"],
  "add_walls": [{{"kind":"wall|terrain_outline|low_wall|door|window|secret_door","points":[[x,y],[x,y]],"closed":false}}],
  "remove_walls": ["w4"]
}}
"box" is the smallest rectangle of whole cells covering the object (top-left cell to bottom-right cell, both inclusive). Wall points
are grid CORNER coordinates with at most one decimal. Use empty arrays where you have nothing to report.
"""


def render_review(grid, im, cand):
    cp, ox, oy = im['cellPx'], im['originX'], im['originY']
    out = grid.copy()
    for i, o in enumerate(cand.get('objects', [])):
        x0, y0, x1, y1 = o['box']
        cv2.rectangle(out, (int(ox + x0 * cp), int(oy + y0 * cp)), (int(ox + (x1 + 1) * cp), int(oy + (y1 + 1) * cp)), (255, 0, 255), 2)
        put_label(out, f"o{i} {o['kind'][:9]}", (int(ox + x0 * cp) + 2, int(oy + y0 * cp) + 12), (200, 0, 200), 0.42)
    for i, w in enumerate(cand.get('walls', [])):
        pts = [(int(ox + p[0] * cp), int(oy + p[1] * cp)) for p in w['points']]
        for a, b in zip(pts, pts[1:] + ([pts[0]] if w['closed'] else [])):
            cv2.line(out, a, b, (255, 255, 0), 3)
        put_label(out, f'w{i}', (pts[0][0] + 3, pts[0][1] - 4), (160, 120, 0), 0.5)
    return out


def index_of(ident):
    s = str(ident)
    return int(s[1:]) if s[1:].isdigit() else -1


def apply_refinement(cand, reply, cols, rows):
    """Merge a second-look reply into a copy of the first-pass candidate. Returns (new candidate, notes)."""
    notes = []
    new = json.loads(json.dumps(cand))
    objs, walls = new.get('objects', []), new.get('walls', [])
    added, _ = clean_layers({'objects': reply.get('add_objects') or [], 'walls': reply.get('add_walls') or []}, ['objects', 'walls'], cols, rows)
    drop_o = {index_of(i) for i in reply.get('remove_objects') or []}
    drop_w = {index_of(i) for i in reply.get('remove_walls') or []}
    fixes = 0
    for f in reply.get('fix_objects') or []:
        tmp, _ = clean_layers({'objects': [{'kind': 'x', 'box': f.get('box')}]}, ['objects'], cols, rows)
        i = index_of(f.get('id'))
        if tmp['objects'] and 0 <= i < len(objs):
            objs[i]['box'] = tmp['objects'][0]['box']
            fixes += 1
        else:
            notes.append(f"Ignored a box fix for {f.get('id')}.")
    new['objects'] = [o for i, o in enumerate(objs) if i not in drop_o] + added['objects']
    new['walls'] = [w for i, w in enumerate(walls) if i not in drop_w] + added['walls']
    notes.append(f"Second look: +{len(added['objects'])} objects, -{len(drop_o)} objects, {fixes} box fixes, "
                 f"+{len(added['walls'])} walls, -{len(drop_w)} walls.")
    return new, notes


def refine_main(args, doc, im, img, cols, rows):
    src = os.path.join(JUDGE_DIR, doc['mapId'], 'extract', args.refine_from, 'candidate.json')
    with open(src, encoding='utf-8') as f:
        cand = json.load(f)
    wd = os.path.join(JUDGE_DIR, doc['mapId'], 'extract', args.tag)
    os.makedirs(wd, exist_ok=True)
    grid = render_grid(img, im, cols, rows)
    review = render_review(grid, im, cand)
    write_img(os.path.join(wd, 'raw.jpg'), img)
    write_img(os.path.join(wd, 'review.jpg'), review)
    files = [('raw.jpg', 'RAW artwork, no grid and nothing drawn'), ('review.jpg', 'REVIEW: the artwork with the grid and the first pass drawn on it')]
    if args.tiles > 0:
        for name, tile in make_tiles(review, args.tiles):
            write_img(os.path.join(wd, name + '.jpg'), tile)
            files.append((name + '.jpg', f'{name}: full-resolution crop of the REVIEW image (crops overlap slightly; labels are still whole-map coordinates)'))
    prompt = REFINE_PROMPT.format(files='\n'.join(f'- {n}: {d}' for n, d in files), cols=cols, rows=rows, colsm=cols - 1, rowsm=rows - 1,
                                  n_obj=len(cand.get('objects', [])), n_wall=len(cand.get('walls', [])))
    pfile = os.path.join(wd, 'prompt.refine.md')
    with open(pfile, 'w', encoding='utf-8') as f:
        f.write(prompt)
    if args.render_only:
        print(f'Wrote images and prompt to {wd}. No model was called.')
        return 0
    key = hashlib.sha1(prompt.encode() + b''.join(open(os.path.join(wd, n), 'rb').read() for n, _ in files)).hexdigest()[:12]
    base = os.path.join(wd, f'refine.{key}')
    if os.path.exists(base + '.json') and not args.force:
        print('[refine] reusing the saved answer (no call made).')
        with open(base + '.json', encoding='utf-8') as f:
            reply = json.load(f)
    else:
        used, limit = ledger_charge(doc['mapId'], f'{args.tag}:refine')
        print(f'[refine] calling {args.backend} (ledger {used} of {limit})...', flush=True)
        t0 = time.time()
        raw = run_backend(args.backend, wd, pfile, [n for n, _ in files], args.timeout, args.model)
        print(f'[refine] answered in {time.time() - t0:.0f}s.')
        with open(base + '.raw.txt', 'w', encoding='utf-8') as f:
            f.write(raw)
        reply = extract_json(raw)
        with open(base + '.json', 'w', encoding='utf-8') as f:
            json.dump(reply, f, indent=2)
    new, notes = apply_refinement(cand, reply, cols, rows)
    new['notes'] = cand.get('notes', []) + notes
    with open(os.path.join(wd, 'candidate.json'), 'w', encoding='utf-8') as f:
        json.dump(new, f, indent=2)
    print(notes[-1])
    return 0


# ---------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('number', help='map number, for example 5.1')
    ap.add_argument('--refine-from', help='tag of an earlier extraction to give a second look (one call)')
    ap.add_argument('--layers', default='all', help="'all' (one call) or a comma list of terrain,walls,objects (one call each)")
    ap.add_argument('--tag', required=True, help='name for this experiment, used for the output folder')
    ap.add_argument('--tiles', type=int, default=0, help='also send an NxN grid of full-resolution crops of the grid image')
    ap.add_argument('--backend', choices=['claude', 'agy'], default='claude')
    ap.add_argument('--model')
    ap.add_argument('--render-only', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--timeout', type=int, default=900)
    args = ap.parse_args(argv)

    try:
        doc, _ = load_doc(args.number)
        if doc['grid']['type'] != 'square':
            raise MapBuildError('Only square-grid maps are supported.')
        cols, rows = doc['grid']['columns'], doc['grid']['rows']
        im = next(i for i in doc['images'] if i['variant'] == 'dm')
        img = read_image(url_to_path(im['url']))
        if args.refine_from:
            return refine_main(args, doc, im, img, cols, rows)
        wd = os.path.join(JUDGE_DIR, doc['mapId'], 'extract', args.tag)
        os.makedirs(wd, exist_ok=True)

        grid = render_grid(img, im, cols, rows)
        files = [('raw.jpg', 'RAW artwork, no grid'), ('grid.jpg', 'GRID: the same artwork with the coordinate grid drawn on it')]
        write_img(os.path.join(wd, 'raw.jpg'), img)
        write_img(os.path.join(wd, 'grid.jpg'), grid)
        if args.tiles > 0:
            for name, tile in make_tiles(grid, args.tiles):
                write_img(os.path.join(wd, name + '.jpg'), tile)
                files.append((name + '.jpg', f'{name}: full-resolution crop of the GRID image (crops overlap slightly; labels are still whole-map coordinates)'))

        groups = [['terrain', 'walls', 'objects']] if args.layers == 'all' else [[l.strip()] for l in args.layers.split(',')]
        for g in groups:
            if not set(g) <= set(SPECS):
                raise MapBuildError(f'Unknown layer in {g}.')
        merged, notes, keys = {}, [], []
        for g in groups:
            name = '+'.join(g)
            prompt = build_prompt(g, files, cols, rows)
            pfile = os.path.join(wd, f'prompt.{name}.md')
            with open(pfile, 'w', encoding='utf-8') as f:
                f.write(prompt)
            if args.render_only:
                continue
            key = hashlib.sha1(prompt.encode() + b''.join(open(os.path.join(wd, n), 'rb').read() for n, _ in files)).hexdigest()[:12]
            base = os.path.join(wd, f'{name}.{key}')
            if os.path.exists(base + '.json') and not args.force:
                print(f'[{name}] reusing the saved answer (no call made).')
                with open(base + '.json', encoding='utf-8') as f:
                    reply = json.load(f)
            else:
                used, limit = ledger_charge(doc['mapId'], f'{args.tag}:{name}')
                print(f'[{name}] calling {args.backend} (ledger {used} of {limit})...', flush=True)
                t0 = time.time()
                raw = run_backend(args.backend, wd, pfile, [n for n, _ in files], args.timeout, args.model)
                print(f'[{name}] answered in {time.time() - t0:.0f}s.')
                with open(base + '.raw.txt', 'w', encoding='utf-8') as f:
                    f.write(raw)
                reply = extract_json(raw)
                with open(base + '.json', 'w', encoding='utf-8') as f:
                    json.dump(reply, f, indent=2)
            layer_out, layer_notes = clean_layers(reply, g, cols, rows)
            merged.update(layer_out)
            notes += layer_notes
            keys.append(key)
        if args.render_only:
            print(f'Wrote images and prompts to {wd}. No model was called.')
            return 0

        cand = dict(merged)
        if 'terrain' in cand:
            cand['terrainRows'] = rasterize_terrain(cand['terrain'], cols, rows)
        cand['notes'] = notes
        with open(os.path.join(wd, 'candidate.json'), 'w', encoding='utf-8') as f:
            json.dump(cand, f, indent=2)
        print(f'Saved {os.path.join(wd, "candidate.json")}: ' + ', '.join(f'{k} {len(v) if not isinstance(v, dict) else len(v["areas"])}' for k, v in merged.items()) + f'; {len(notes)} notes.')
        return 0
    except MapBuildError as e:
        print(f'Error: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
