"""Object detection from printed legends and labels (plan Phase 4d).

Legend maps (5.1, 5.3): cut an exemplar per legend row, template-match it over the map at
four rotations and five scales, and turn hits into objects. Label maps (5.6): use the
printed word positions from the manifest. No furniture detection elsewhere.
"""
import math

import cv2
import numpy as np

import register_images as reg
from common import read_image, url_to_path

# kind -> (cover, blocksMovement, difficultTerrain, blocksSight)  (plan section 4.5)
OBJECT_RULES = {
    'palm_tree': ('half', False, False, False),
    'tree': ('three_quarters', True, False, True),
    'market_stall': ('half', True, False, False),
    'table': ('half', False, True, False),
    'chairs_and_tables': ('half', False, True, False),
    'pillar': ('three_quarters', True, False, True),
    'statue': ('three_quarters', True, False, True),
    'building': ('total', True, False, True),
    'cottage': ('total', True, False, True),
    'crate': ('half', True, False, False),
    'bed': ('half', False, True, False),
    'boulder': ('three_quarters', True, False, True),
    'fireplace': ('half', True, False, False),
    'fountain': ('half', True, False, False),
    'door': ('none', False, False, False),
    'rubble': ('none', False, True, False),
}

LEGEND_KINDS = {'Market Stall': ('market_stall', 'Market stall'), 'Palm Tree': ('palm_tree', 'Palm tree'),
                'Statue of Kord': ('statue', 'Statue of Kord'), 'Statue': ('statue', 'Statue'),
                'Pillars': ('pillar', 'Pillar'), 'Chairs and Tables': ('chairs_and_tables', 'Chairs and tables'),
                'Cottage': ('cottage', 'Cottage'), 'Door': ('door', 'Door')}

LABEL_KINDS = {'Table': ('table', 'Table'), 'Chair': ('table', 'Chair'), 'Bed': ('bed', 'Bed'),
               'Chest': ('crate', 'Chest'), 'Fireplace': ('fireplace', 'Fireplace'),
               'Broken Table': ('rubble', 'Broken table')}
INFO_LABELS = ('Doorway', 'Window', 'Storage Room')

MAX_HITS_PER_KIND = 60
ROTATIONS = (0, 90, 180, 270)
SCALES = (0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3)


def tight_crop(gray_row):
    """Bounding box of the non-background pixels (Otsu on darkness) in a legend row crop."""
    blur = cv2.GaussianBlur(gray_row, (3, 3), 0)
    _t, mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, _lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    boxes = [tuple(stats[i, :4]) for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 12]
    if not boxes:
        return None
    x0 = min(b[0] for b in boxes)
    y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    return x0, y0, x1, y1


def extract_exemplars(player_gray, legend, half_height=32, pad=2):
    """{legend name: gray template} from the legend rows given in the manifest."""
    x1, x2 = legend['iconX']
    out = {}
    for name, cy in legend['rows']:
        if name not in LEGEND_KINDS:
            continue
        row = player_gray[max(cy - half_height, 0):cy + half_height, x1:x2]
        box = tight_crop(row)
        if box is None:
            continue
        bx0, by0, bx1, by1 = box
        tmpl = row[max(by0 - pad, 0):by1 + pad, max(bx0 - pad, 0):bx1 + pad]
        if tmpl.shape[0] >= 6 and tmpl.shape[1] >= 6:
            out[name] = tmpl.copy()
    return out


def rotate(t, deg):
    return {0: t, 90: cv2.rotate(t, cv2.ROTATE_90_CLOCKWISE), 180: cv2.rotate(t, cv2.ROTATE_180),
            270: cv2.rotate(t, cv2.ROTATE_90_COUNTERCLOCKWISE)}[deg]


def match_template_hits(gray, tmpl, min_score=0.5, scales=SCALES, rotations=ROTATIONS):
    """[(cx, cy, score, w, h)] peaks over rotations and scales, non-maximum suppressed."""
    cands = []
    h0, w0 = gray.shape
    for rot in rotations:
        base = rotate(tmpl, rot)
        for sc in scales:
            t = cv2.resize(base, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA if sc < 1 else cv2.INTER_LINEAR)
            th, tw = t.shape
            if th < 6 or tw < 6 or th >= h0 or tw >= w0:
                continue
            if float(t.std()) < 1.0:
                continue  # flat template cannot be correlated
            res = cv2.matchTemplate(gray, t, cv2.TM_CCOEFF_NORMED)
            thr = max(min_score, float(res.mean() + 3 * res.std()))
            ys, xs = np.nonzero(res >= thr)
            for y, x in zip(ys.tolist(), xs.tolist()):
                cands.append((float(res[y, x]), x + tw / 2.0, y + th / 2.0, tw, th))
    cands.sort(reverse=True)
    cands = cands[:3000]  # bounds the quadratic suppression below
    kept = []
    diag = math.hypot(tmpl.shape[1], tmpl.shape[0])
    for s, cx, cy, tw, th in cands:
        if all(math.hypot(cx - k[1], cy - k[2]) >= 0.6 * diag for k in kept):
            kept.append((s, cx, cy, tw, th))
    return [(cx, cy, s, tw, th) for s, cx, cy, tw, th in kept]


def make_object(kind, label, cells, conf, note, region_id=None, source='printed-map'):
    cover, blocks, diff, sight = OBJECT_RULES[kind]
    o = {'kind': kind, 'label': label, 'cells': sorted(cells, key=lambda c: (int(c.split(',')[1]), int(c.split(',')[0]))),
         'cover': cover, 'blocksMovement': blocks, 'difficultTerrain': diff, 'blocksSight': sight,
         'provenance': {'source': source, 'confidence': round(conf, 2), 'note': note}}
    if region_id:
        o['regionId'] = region_id
    return o


def bbox_cells(cx, cy, w, h, grid, columns, rows):
    """Cells overlapped at least half by the w x h box centred at DM pixel (cx, cy); never empty."""
    cell = grid['cellPx']
    x0, y0 = cx - w / 2, cy - h / 2
    cells = set()
    for gx in range(int((x0 - grid['originX']) // cell), int((x0 + w - grid['originX']) // cell) + 1):
        for gy in range(int((y0 - grid['originY']) // cell), int((y0 + h - grid['originY']) // cell) + 1):
            cxl, cxr = grid['originX'] + gx * cell, grid['originX'] + (gx + 1) * cell
            cyt, cyb = grid['originY'] + gy * cell, grid['originY'] + (gy + 1) * cell
            ox = max(0.0, min(x0 + w, cxr) - max(x0, cxl))
            oy = max(0.0, min(y0 + h, cyb) - max(y0, cyt))
            if ox * oy >= 0.5 * cell * cell and 0 <= gx < columns and 0 <= gy < rows:
                cells.add(f'{gx},{gy}')
    if not cells:
        gx = int((cx - grid['originX']) // cell)
        gy = int((cy - grid['originY']) // cell)
        if 0 <= gx < columns and 0 <= gy < rows:
            cells.add(f'{gx},{gy}')
    return cells


def region_of(doc, cells):
    for r in doc['regions']:
        rc = set(r['cells'])
        if rc and any(c in rc for c in cells):
            return r['id']
    return None


def _marked_check(player_bgr, cx, cy, cell):
    """Whole map with a red circle at the hit. A tight crop of a few cells is too little context
    for a small vision model; the marked overview answers reliably."""
    import terrain
    return terrain.marked_overview(player_bgr, cx, cy, cell)


def legend_objects(mspec, doc, ctx, opts):
    variants = ctx['variants']
    player = variants.get('player')
    legend = mspec.get('legend')
    if not legend or player is None or ctx.get('playerToDm') is None:
        return
    p2d = ctx['playerToDm']
    dg = variants['dm']['grid']
    columns, rows = doc['grid']['columns'], doc['grid']['rows']
    pbgr = read_image(url_to_path(player['url']))
    pgray = cv2.cvtColor(pbgr, cv2.COLOR_BGR2GRAY)
    exemplars = extract_exemplars(pgray, legend)
    if not exemplars:
        doc['audit'].append({'level': 'warn', 'code': 'LEGEND_NOT_READ',
                             'message': 'The legend icons could not be cut out, so no objects were detected.'})
        return
    # Hide the legend so its icons are not matched as map objects.
    lx1, ly1, lx2, ly2 = legend['approxBox']
    masked = pgray.copy()
    masked[ly1:ly2, lx1:lx2] = int(pgray.mean())
    vlm = opts['vlm']
    counts = {}
    buildings = [o for o in doc['objects'] if o['kind'] == 'building']
    building_cells = [set(o['cells']) for o in buildings]
    for name, tmpl in exemplars.items():
        kind, label = LEGEND_KINDS[name]
        hits = match_template_hits(masked, tmpl)
        # Best hits first; only a bounded number get a (slow) vision-model check.
        hits.sort(key=lambda h: -h[2])
        hits = hits[:MAX_HITS_PER_KIND]
        added = 0
        for cx, cy, score, tw, th in hits:
            dx, dy = reg.apply_affine(p2d, cx, cy)
            scale = reg.affine_scale(p2d)
            cells = bbox_cells(dx, dy, tw * scale, th * scale, dg, columns, rows)
            if not cells:
                continue
            conf = score
            if score < 0.75:
                marked = _marked_check(pbgr, cx, cy, player['grid']['cellPx'])
                verdict = vlm.yes_no(marked, f'Is there a {label.lower()} at the red circle? Answer yes or no.')
                if verdict is True:
                    conf = 0.7
                elif verdict is False or score < 0.7:
                    continue
            if kind == 'cottage':
                # A cottage roof is already a building footprint from the wall outlines.
                match = next((o for o, bc in zip(buildings, building_cells) if cells & bc), None)
                if match is not None:
                    match['kind'], match['label'] = 'cottage', 'Cottage'
                    match['provenance']['note'] += '; matched the printed cottage icon'
                    added += 1
                    continue
            if kind == 'door':
                # Doors from the scene file are real wall segments; this icon match is informational.
                near = False
                for w in doc['walls']:
                    if w['kind'] == 'door':
                        mx, my = (w['a']['x'] + w['b']['x']) / 2, (w['a']['y'] + w['b']['y']) / 2
                        gx, gy = (dx - dg['originX']) / dg['cellPx'], (dy - dg['originY']) / dg['cellPx']
                        if math.hypot(mx - gx, my - gy) <= 1.0:
                            near = True
                            break
                if near:
                    continue
            obj = make_object(kind, label, cells, conf, f'template match {score:.2f} to the printed legend icon')
            obj['regionId'] = region_of(doc, cells) or None
            if obj['regionId'] is None:
                del obj['regionId']
            doc['objects'].append(obj)
            added += 1
        counts[label] = added
    for i, o in enumerate(doc['objects'], 1):
        o['id'] = f'obj-{o["kind"]}-{i}'
    summary = ', '.join(f'{v} {k.lower()}{"" if v == 1 or k.lower().endswith("s") else "s"}'
                        for k, v in counts.items() if v)
    if any(n == 'Fence' for n, _y in legend['rows']):
        doc['audit'].append({'level': 'question', 'code': 'FENCE_NOT_DETECTED',
                             'message': 'The legend shows fences, but fence lines are not detected automatically yet. '
                                        'If a fence matters for cover or movement, tell the assistant where it runs, '
                                        'for example "there is a fence along the north side of P7".'})
    doc['audit'].append({'level': 'info', 'code': 'OBJECTS_FROM_LEGEND',
                         'message': f'Objects found by matching the printed legend icons: {summary or "none"}.'})


def label_objects(mspec, doc, ctx, opts):
    spec = mspec.get('printedLabels')
    if not spec:
        return
    dg = ctx['variants']['dm']['grid']
    columns, rows = doc['grid']['columns'], doc['grid']['rows']
    made, info = [], []
    for name, x, y in spec['items']:
        if name in INFO_LABELS:
            info.append(name)
            continue
        if name not in LABEL_KINDS:
            continue
        kind, label = LABEL_KINDS[name]
        cells = set()
        for gx in range(columns):
            for gy in range(rows):
                cx = dg['originX'] + (gx + 0.5) * dg['cellPx']
                cy = dg['originY'] + (gy + 0.5) * dg['cellPx']
                if math.hypot(cx - x, cy - y) < 0.75 * dg['cellPx']:
                    cells.add(f'{gx},{gy}')
        if not cells:
            continue
        obj = make_object(kind, label, cells, 0.5, f'printed label "{name}" on the map')
        rid = region_of(doc, cells)
        if rid:
            obj['regionId'] = rid
        made.append(obj)
    base = len(doc['objects'])
    for i, o in enumerate(made, base + 1):
        o['id'] = f'obj-{o["kind"]}-{i}'
        doc['objects'].append(o)
    if made:
        doc['audit'].append({'level': 'info', 'code': 'OBJECTS_FROM_LABELS',
                             'message': f'{len(made)} objects were placed from the words printed on the map: ' +
                                        ', '.join(o['label'].lower() for o in made) + '.'})
    if info:
        doc['audit'].append({'level': 'info', 'code': 'PRINTED_LABELS_INFO',
                             'message': 'The map also prints these labels, kept as information only: ' +
                                        ', '.join(info) + '.'})


def import_objects(mspec, doc, ctx, opts):
    legend_objects(mspec, doc, ctx, opts)
    label_objects(mspec, doc, ctx, opts)
