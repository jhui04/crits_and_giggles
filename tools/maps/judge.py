"""AI judge for compiled map data. Renders the parsed MapDocument on top of the map image, hands the
picture and a text summary to a vision model through its command line client, and writes a plain-text
report of problems plus suggested fixes in the same shape as the app's MapOverride operations.

The model only reviews and recommends. Nothing here edits the map, and nothing needs a person to look at
an image: the output is text (report .md and machine-readable .json under tools/state/judge/).

It uses the subscription-backed CLIs, not the paid APIs:
    claude -p    (Claude Code, headless)
    agy -p       (Antigravity CLI, headless; serves the Gemini models. The old gemini CLI is deprecated.)

Usage (from the repo root):
    python tools/maps/judge.py 5.9 --backend claude
    python tools/maps/judge.py 5.9 --render-only     # build the overlay and prompt, call no model
    python tools/maps/judge.py 5.9 --backend agy --tiles 2
    python tools/maps/judge.py 5.9 --backend agy --model gemini-3.1-pro-low   # see: agy models
Add --force to ignore a saved answer for the same map, backend and inputs.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

import cv2

from common import OUT_DIR, STATE_DIR, MapBuildError, read_image, url_to_path

JUDGE_DIR = os.path.join(STATE_DIR, 'judge')

TERRAIN_COLORS = {  # BGR
    'void': (60, 60, 60), 'building': (40, 40, 200), 'cliff': (20, 90, 150),
    'water_deep': (200, 90, 20), 'water_shallow': (230, 190, 60), 'sand': (110, 200, 230),
    'grass': (60, 190, 60), 'dirt': (60, 120, 170), 'stone_floor': (170, 170, 170),
    'wood_floor': (40, 110, 200), 'rubble': (130, 110, 150), 'dense_vegetation': (30, 110, 30),
    'mud': (40, 70, 110), 'ice': (255, 240, 200), 'unknown': (255, 0, 255),
}
WALL_COLORS = {'wall': (0, 0, 255), 'terrain_outline': (0, 140, 255), 'low_wall': (0, 200, 255),
               'window': (255, 200, 0), 'door': (0, 255, 0), 'secret_door': (255, 0, 255), 'invisible': (200, 200, 200)}

CLAUDE_TOOLS = 'Read'
AGY_MODE = 'plan'  # read-only: the judge never needs to write files
AGY_DEFAULT_MODEL = 'gemini-3.1-pro-high'  # strongest Gemini vision model listed by `agy models`


def ascii_text(s):
    return re.sub(r'[^\x20-\x7e]', '?', str(s))


def load_doc(number):
    path = os.path.join(OUT_DIR, f'egtw-{number}-*.json')
    import glob
    hits = [p for p in glob.glob(path) if not p.endswith('.audit.json')]
    if len(hits) != 1:
        raise MapBuildError(f'Expected exactly one compiled map for {number}, found {len(hits)}. Run the map build first.')
    with open(hits[0], encoding='utf-8') as f:
        return json.load(f), hits[0]


def px(doc_img, x, y):
    return int(round(doc_img['originX'] + x * doc_img['cellPx'])), int(round(doc_img['originY'] + y * doc_img['cellPx']))


def parse_cell(s):
    x, y = s.split(',')
    return int(x), int(y)


def put_label(img, text, org, color, scale=0.55):
    text = ascii_text(text)
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 4, cv2.LINE_AA)
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)


def render_overlay(doc, img):
    """Draw the parsed data over a copy of the map. Returns (overlay, legend_lines)."""
    im = next(i for i in doc['images'] if i['variant'] == 'dm')
    cp = im['cellPx']
    cols, rows = doc['grid']['columns'], doc['grid']['rows']
    hexmap = doc['grid']['type'] == 'hex'
    out = img.copy()
    tint = out.copy()
    legend = []

    terr = doc.get('terrain')
    if terr and not hexmap:
        for y, row in enumerate(terr['rows']):
            for x, ch in enumerate(row):
                cls = terr['legend'].get(ch, 'unknown')
                if cls in ('void',):
                    continue
                x0, y0 = px(im, x, y)
                cv2.rectangle(tint, (x0, y0), (int(x0 + cp), int(y0 + cp)), TERRAIN_COLORS.get(cls, (255, 0, 255)), -1)
        legend.append('Cell tint = terrain class: ' + ', '.join(f'{c}' for c in TERRAIN_COLORS if c != 'void')
                      + '. Colors: ' + '; '.join(f'{c}=BGR{TERRAIN_COLORS[c]}' for c in TERRAIN_COLORS))
    out = cv2.addWeighted(tint, 0.30, out, 0.70, 0)

    if not hexmap:  # thin grid with a ruler every 5 cells so cells can be cited
        for x in range(cols + 1):
            x0, y0 = px(im, x, 0)
            _, y1 = px(im, x, rows)
            cv2.line(out, (x0, y0), (x0, y1), (0, 0, 0), 1)
        for y in range(rows + 1):
            x0, y0 = px(im, 0, y)
            x1, _ = px(im, cols, y)
            cv2.line(out, (x0, y0), (x1, y0), (0, 0, 0), 1)
        for x in range(0, cols, 5):
            x0, y0 = px(im, x, 0)
            put_label(out, str(x), (x0 + 2, max(14, y0 + 14)), (0, 0, 0), 0.5)
        for y in range(0, rows, 5):
            x0, y0 = px(im, 0, y)
            put_label(out, str(y), (max(2, x0 + 2), y0 + 14), (0, 0, 0), 0.5)
        legend.append('Black grid lines are cell boundaries. Numbers along the top and left edge are the x and y cell index of every fifth cell.')

    for w in doc['walls']:
        color = WALL_COLORS.get(w['kind'], (0, 0, 255))
        cv2.line(out, px(im, w['a']['x'], w['a']['y']), px(im, w['b']['x'], w['b']['y']), color, 3)
    if doc['walls']:
        legend.append('Thick lines = wall segments, colored by kind: ' + ', '.join(f'{k}=BGR{v}' for k, v in WALL_COLORS.items()) + '.')

    for o in doc['objects']:
        for c in o['cells']:
            x, y = parse_cell(c)
            x0, y0 = px(im, x, y)
            cv2.rectangle(out, (x0 + 3, y0 + 3), (int(x0 + cp - 3), int(y0 + cp - 3)), (255, 0, 255), 2)
        x, y = parse_cell(o['cells'][0]) if o['cells'] else (0, 0)
        x0, y0 = px(im, x, y)
        put_label(out, o['id'], (x0 + 4, y0 + int(cp) // 2), (255, 0, 255), 0.45)
    if doc['objects']:
        legend.append('Magenta boxes with ids = objects (kind and cover are in the JSON summary).')

    for r in doc['regions']:
        for c in r['cells']:
            x, y = parse_cell(c)
            x0, y0 = px(im, x, y)
            cv2.rectangle(out, (x0 + 1, y0 + 1), (int(x0 + cp - 1), int(y0 + cp - 1)), (0, 200, 0), 1)
        for lc in r['labelCells']:
            cx, cy = px(im, lc['x'] + 0.5, lc['y'] + 0.5)
            cv2.circle(out, (cx, cy), 7, (0, 200, 0), -1)
            put_label(out, r['id'], (cx + 9, cy + 5), (0, 120, 0), 0.6)
    if doc['regions']:
        legend.append('Green outlined cells and green dots with ids = regions (dot = label position).')

    return out, legend


def summarize(doc):
    """A compact, model-facing text view of the parsed data (not the whole JSON: those files are huge)."""
    im = next(i for i in doc['images'] if i['variant'] == 'dm')
    lines = [f"Map {doc['number']}: {doc['title']} (kind {doc['kind']}, {doc['grid']['type']} grid "
             f"{doc['grid']['columns']}x{doc['grid']['rows']}, {doc['grid']['feetPerCell']} {doc['grid']['units']} per cell, "
             f"cellPx {im['cellPx']}, origin ({im['originX']}, {im['originY']}) px)."]
    terr = doc.get('terrain')
    if terr:
        counts = {}
        for row in terr['rows']:
            for ch in row:
                cls = terr['legend'].get(ch, 'unknown')
                counts[cls] = counts.get(cls, 0) + 1
        lines.append('Terrain cell counts: ' + ', '.join(f'{k}={v}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
        lines.append('Terrain rows (one char per cell, legend ' + json.dumps(terr['legend']) + '):')
        lines.extend(f'  y={y:02d} {row}' for y, row in enumerate(terr['rows']))
    lines.append(f"Regions ({len(doc['regions'])}):")
    for r in doc['regions']:
        lines.append(f"  {r['id']} '{r['name']}' extent={r['extentMethod']} conf={r['provenance']['confidence']} "
                     f"cells={len(r['cells'])} labelCells={[(c['x'], c['y']) for c in r['labelCells']]}")
    kinds = {}
    for w in doc['walls']:
        kinds[w['kind']] = kinds.get(w['kind'], 0) + 1
    lines.append(f"Walls: {len(doc['walls'])} segments by kind {kinds}.")
    lines.append(f"Objects ({len(doc['objects'])}):")
    for o in doc['objects'][:200]:
        lines.append(f"  {o['id']} kind={o['kind']} label='{o['label']}' cover={o['cover']} cells={o['cells'][:6]}")
    lines.append('Existing audit notes:')
    lines.extend(f"  [{a['level']}] {a['code']}: {a['message']}" for a in doc['audit'])
    return '\n'.join(lines)


PROMPT = """You are reviewing machine-parsed data for a tabletop D&D 5e battle map. The person who runs this game is blind and
cannot check the map by eye, so you are the visual reviewer. Be specific and honest. Do not invent problems. If you cannot
tell, say so with a low confidence.

Files to read (use the Read tool on the image files):
{files}

What the images show:
- RAW is the original map artwork.
- OVERLAY is the same artwork with the parsed data drawn on top.
{legend}

Text summary of the parsed data:
{summary}

Judge the parsed data against the artwork and check, in this order:
1. Terrain: cells whose terrain class is wrong for what the art shows (for example water tinted as floor, walls or roofs
   classed as open ground, open floor classed as building or void).
2. Walls and doors: wall segments floating in open space, real walls with no segment, door or window segments that are in
   the wrong place, gaps that let creatures walk through a solid wall.
3. Objects and cover: visible furniture, pillars, statues, crates, trees or similar that are missing, objects on the wrong
   cells, or wrong cover values.
4. Regions: labeled areas whose cells do not match the room or area the label sits in.
5. Grid alignment: whether the grid lines line up with the map's own printed grid; report a systematic offset if there is one.

Every problem you report MUST include cell coordinates (x,y as on the overlay rulers) so that it can be acted on.
Where a fix can be expressed as one of these operations, include it in "override". Cells are "x,y" strings.
  {{"op":"set_terrain","cells":["3,4"],"terrain":"<TerrainClass>"}}
  {{"op":"add_object","cells":["3,4"],"kind":"<kind>","label":"<text>"}}
  {{"op":"remove_object","objectId":"<id>"}}
  {{"op":"set_object_cover","objectId":"<id>","cover":"none|half|three_quarters|total"}}
  {{"op":"rename_region","region":"<id>","name":"<text>"}}
Valid TerrainClass values: void, building, cliff, water_deep, water_shallow, sand, grass, dirt, stone_floor, wood_floor,
rubble, dense_vegetation, mud, ice, unknown. For walls, doors and alignment there is no override operation: describe the fix
in words in "suggestion" and leave "override" null.

Reply with ONLY one JSON object, no prose before or after and no code fence, in exactly this shape:
{{
  "overall": "one or two sentences on how trustworthy this parse is",
  "quality": <integer 1-10>,
  "findings": [
    {{"severity":"high|medium|low","category":"terrain|wall|door|object|cover|region|grid","cells":["x,y"],
      "problem":"what is wrong","suggestion":"what to change","confidence":<0..1>,"override":null}}
  ]
}}
Report at most 25 findings, most severe first. An empty findings list is fine if the parse is good.
"""


def build_prompt(doc, files, legend):
    return PROMPT.format(files='\n'.join(f'- {os.path.basename(p)}: {d}' for p, d in files),
                         legend='\n'.join('- ' + l for l in legend), summary=summarize(doc))


def make_tiles(overlay, n):
    h, w = overlay.shape[:2]
    tiles = []
    for ty in range(n):
        for tx in range(n):
            x0, x1 = tx * w // n, (tx + 1) * w // n
            y0, y1 = ty * h // n, (ty + 1) * h // n
            pad = 40  # overlap so features on tile edges are seen whole
            tiles.append((f'tile{ty}{tx}', overlay[max(0, y0 - pad):min(h, y1 + pad), max(0, x0 - pad):min(w, x1 + pad)]))
    return tiles


def write_img(path, img):
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise MapBuildError(f'Could not encode {path}.')
    buf.tofile(path)


def run_backend(backend, workdir, prompt_file, image_names, timeout, model=None):
    prompt_name = os.path.basename(prompt_file)
    if backend == 'claude':
        exe = shutil.which('claude')
        instruction = (f'Read {prompt_name} and every image it lists (all in the current directory), then follow the '
                       f'instructions in {prompt_name}. Reply with only the JSON object it asks for.')
        cmd = [exe, '-p', instruction, '--allowedTools', CLAUDE_TOOLS, '--output-format', 'text']
    elif backend == 'agy':
        exe = shutil.which('agy')
        instruction = (f'Read {prompt_name} and every image it lists (all in the current directory), then follow the '
                       f'instructions in {prompt_name}. Reply with only the JSON object it asks for.')
        cmd = [exe, '-p', instruction, '--mode', AGY_MODE, '--model', model or AGY_DEFAULT_MODEL, '--output-format', 'text']
    else:
        raise MapBuildError(f'Unknown backend {backend}.')
    if not exe:
        raise MapBuildError(f'The {backend} command line client is not on PATH.')
    proc = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
    if proc.returncode != 0:
        raise MapBuildError(f'{backend} exited with code {proc.returncode}: {proc.stderr.strip()[:500] or proc.stdout.strip()[:500]}')
    return proc.stdout


def extract_json(text):
    """Pull the first balanced {...} object out of a model reply (tolerates code fences and chatter)."""
    start = text.find('{')
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == '\\':
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find('{', start + 1)
    raise MapBuildError('The model reply did not contain a JSON object. The raw reply was saved next to the report.')


OVERRIDE_OPS = {'set_terrain', 'add_object', 'remove_object', 'set_object_cover', 'rename_region', 'set_kind_cover'}
TERRAIN = set(TERRAIN_COLORS)


def validate(report, doc):
    """Drop findings or overrides that could not be applied, so the report never suggests garbage."""
    cols, rows = doc['grid']['columns'], doc['grid']['rows']
    obj_ids = {o['id'] for o in doc['objects']}
    region_ids = {r['id'] for r in doc['regions']}
    notes = []

    def cells_ok(cells):
        for c in cells:
            try:
                x, y = parse_cell(c)
            except Exception:
                return False
            if not (0 <= x < cols and 0 <= y < rows):
                return False
        return True

    good = []
    for f in report.get('findings', []):
        ov = f.get('override')
        if ov:
            ok = ov.get('op') in OVERRIDE_OPS
            if ok and 'cells' in ov:
                ok = isinstance(ov['cells'], list) and cells_ok(ov['cells'])
            if ok and ov['op'] == 'set_terrain':
                ok = ov.get('terrain') in TERRAIN
            if ok and ov['op'] in ('remove_object', 'set_object_cover'):
                ok = ov.get('objectId') in obj_ids
            if ok and ov['op'] == 'rename_region':
                ok = ov.get('region') in region_ids
            if not ok:
                notes.append(f"Dropped an invalid override on the finding '{f.get('problem', '')[:60]}'.")
                f['override'] = None
        if f.get('cells') and not cells_ok(f['cells']):
            notes.append(f"Finding '{f.get('problem', '')[:60]}' cites cells outside the map.")
            f['cells'] = [c for c in f['cells'] if cells_ok([c])]
        good.append(f)
    report['findings'] = good
    report['validationNotes'] = notes
    return report


def to_markdown(doc, backend, report):
    lines = [f"# Judge report for {doc['title']} ({backend})", '',
             f"Quality score: {report.get('quality', '?')} out of 10.", '', report.get('overall', ''), '']
    findings = report.get('findings', [])
    lines.append(f'## Findings ({len(findings)})')
    if not findings:
        lines.append('No problems reported.')
    for i, f in enumerate(findings, 1):
        lines += ['', f"### {i}. [{f.get('severity', '?')}] {f.get('category', '?')} at {', '.join(f.get('cells') or []) or 'unspecified cells'}",
                  f"Problem: {f.get('problem', '')}", f"Suggested fix: {f.get('suggestion', '')}",
                  f"Confidence: {f.get('confidence', '?')}"]
        if f.get('override'):
            lines.append('Override: `' + json.dumps(f['override']) + '`')
    if report.get('validationNotes'):
        lines += ['', '## Validation notes'] + [f'- {n}' for n in report['validationNotes']]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('number', help='map number, for example 5.9')
    ap.add_argument('--backend', choices=['claude', 'agy'], default='claude')
    ap.add_argument('--model', help='model id for the agy backend (default %s); list them with: agy models' % AGY_DEFAULT_MODEL)
    ap.add_argument('--tiles', type=int, default=0, help='also send an NxN grid of full-resolution overlay crops (costs more tokens)')
    ap.add_argument('--render-only', action='store_true', help='write the overlay and prompt, call no model')
    ap.add_argument('--force', action='store_true', help='ignore a saved answer and ask again')
    ap.add_argument('--timeout', type=int, default=600)
    args = ap.parse_args(argv)

    try:
        doc, doc_path = load_doc(args.number)
        dm = next(i for i in doc['images'] if i['variant'] == 'dm')
        img = read_image(url_to_path(dm['url']))
        overlay, legend = render_overlay(doc, img)

        wd = os.path.join(JUDGE_DIR, doc['mapId'])
        os.makedirs(wd, exist_ok=True)
        files = [(os.path.join(wd, 'raw.jpg'), 'RAW artwork'), (os.path.join(wd, 'overlay.jpg'), 'OVERLAY with the parsed data drawn on')]
        write_img(files[0][0], img)
        write_img(files[1][0], overlay)
        if args.tiles > 0:
            for name, tile in make_tiles(overlay, args.tiles):
                p = os.path.join(wd, name + '.jpg')
                write_img(p, tile)
                files.append((p, f'{name}: full-resolution crop of the OVERLAY (the crops overlap slightly; ruler numbers still refer to the whole map)'))

        prompt = build_prompt(doc, files, legend)
        prompt_file = os.path.join(wd, 'prompt.md')
        with open(prompt_file, 'w', encoding='utf-8') as f:
            f.write(prompt)

        if args.render_only:
            print(f'Wrote the overlay and prompt to {wd}. No model was called.')
            return 0

        key = hashlib.sha1(prompt.encode('utf-8') + b''.join(open(p, 'rb').read() for p, _ in files)).hexdigest()[:12]
        tag = args.backend + ('-' + args.model if args.model and args.backend == 'agy' else '')
        base = os.path.join(wd, f'{tag}.{key}')
        if os.path.exists(base + '.json') and not args.force:
            print(f'Reusing the saved {args.backend} answer for these exact inputs (use --force to ask again).')
            with open(base + '.json', encoding='utf-8') as f:
                report = json.load(f)
        else:
            raw = run_backend(args.backend, wd, prompt_file, [os.path.basename(p) for p, _ in files], args.timeout, args.model)
            with open(base + '.raw.txt', 'w', encoding='utf-8') as f:
                f.write(raw)
            report = validate(extract_json(raw), doc)
            with open(base + '.json', 'w', encoding='utf-8') as f:
                json.dump(report, f, indent=2)
        md = to_markdown(doc, args.backend, report)
        with open(base + '.md', 'w', encoding='utf-8') as f:
            f.write(md)
        print(md)
        print(f'Saved: {base}.md and {base}.json')
        return 0
    except MapBuildError as e:
        print(f'Error: {e}', file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        print('Error: the model client timed out.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
