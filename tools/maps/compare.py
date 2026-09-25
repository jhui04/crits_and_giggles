"""Score a blind extraction (extract.py) against the features already compiled for the same map.

Walls are compared as geometry, objects by position and kind family, terrain by coarse class. The compiled data is a
reference, not perfect truth: see the notes printed with each score.

Usage (from the repo root):
    python tools/maps/compare.py 5.1 A B C        # one report per experiment tag
"""
import json
import os
import sys

import cv2
import numpy as np

from common import MapBuildError
from extract import wall_segments
from judge import JUDGE_DIR, load_doc

PX = 4  # raster pixels per cell for the wall distance maps
FAMILIES = [('tree', ('tree', 'palm')), ('stall', ('stall', 'market')), ('pillar', ('pillar', 'column')), ('door', ('door',)),
            ('building', ('building', 'cottage', 'house', 'hut', 'shop', 'tavern', 'cabin', 'tower')),
            ('table', ('table', 'chair', 'bench')), ('statue', ('statue',)), ('boat', ('boat', 'ship', 'vessel', 'hull'))]
GROUP = {'water_deep': 'water', 'water_shallow': 'water', 'void': 'void', 'building': 'building', 'unknown': 'unknown'}
CHAR_CLASS = {'#': 'void', 'B': 'building', '^': 'cliff', 'W': 'water_deep', 'w': 'water_shallow', 's': 'sand', 'g': 'grass', 'd': 'dirt',
              'f': 'stone_floor', 'p': 'wood_floor', 'r': 'rubble', 'v': 'dense_vegetation', 'm': 'mud', 'i': 'ice', '?': 'unknown'}


def family(kind):
    k = kind.lower()
    for name, keys in FAMILIES:
        if any(s in k for s in keys):
            return name
    return 'other'


# ---------------------------------------------------------------- walls

def raster(segs, cols, rows):
    canvas = np.full((rows * PX + 1, cols * PX + 1), 255, np.uint8)
    for _, a, b in segs:
        cv2.line(canvas, (int(round(a[0] * PX)), int(round(a[1] * PX))), (int(round(b[0] * PX)), int(round(b[1] * PX))), 0, 1)
    return cv2.distanceTransform(canvas, cv2.DIST_L2, 3) / PX  # distance to the nearest line, in cells


def samples(segs, step=0.25):
    pts = []
    for _, a, b in segs:
        n = max(1, int(np.hypot(b[0] - a[0], b[1] - a[1]) / step))
        for i in range(n + 1):
            t = i / n
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return pts


def frac_within(pts, dist, tol):
    if not pts:
        return None
    hits = 0
    h, w = dist.shape
    for x, y in pts:
        xi, yi = min(max(int(round(x * PX)), 0), w - 1), min(max(int(round(y * PX)), 0), h - 1)
        hits += dist[yi, xi] <= tol
    return hits / len(pts)


def compare_walls(doc, cand, cols, rows):
    truth = [(w['kind'], (w['a']['x'], w['a']['y']), (w['b']['x'], w['b']['y'])) for w in doc['walls']]
    got = wall_segments(cand.get('walls', []))
    lines = ['## Walls']
    if not truth or not got:
        return lines + [f'Reference segments: {len(truth)}, extracted segments: {len(got)}. Nothing to compare.']
    dt, dg = raster(truth, cols, rows), raster(got, cols, rows)
    tp, gp = samples(truth), samples(got)
    lines.append(f'Reference wall length {len(tp) * 0.25:.0f} cells in {len(truth)} segments. Extracted length {len(gp) * 0.25:.0f} cells in {len(got)} segments.')
    for tol in (1.0, 2.0):
        r, p = frac_within(tp, dg, tol), frac_within(gp, dt, tol)
        lines.append(f'Within {tol:g} cell: recall {r:.0%} (reference wall the model also drew), precision {p:.0%} (extracted wall that is on reference wall).')
    lines.append('Note: the reference walls are only what the third-party scene contained, so low precision can mean the model drew real walls the reference lacks.')
    return lines


# ---------------------------------------------------------------- objects

def obj_box(o):
    if 'box' in o:
        return tuple(o['box'])
    xs, ys = zip(*[map(int, c.split(',')) for c in o['cells']])
    return min(xs), min(ys), max(xs), max(ys)


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]) + 1)
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]) + 1)
    inter = ix * iy
    ua = (a[2] - a[0] + 1) * (a[3] - a[1] + 1) + (b[2] - b[0] + 1) * (b[3] - b[1] + 1) - inter
    return inter / ua


def near(a, b):
    ca, cb = ((a[0] + a[2] + 1) / 2, (a[1] + a[3] + 1) / 2), ((b[0] + b[2] + 1) / 2, (b[1] + b[3] + 1) / 2)
    return iou(a, b) >= 0.25 or np.hypot(ca[0] - cb[0], ca[1] - cb[1]) <= 1.5


def compare_objects(doc, cand):
    truth = [(o['kind'], obj_box(o)) for o in doc['objects'] if o['cells']]
    got = [(o['kind'], obj_box(o)) for o in cand.get('objects', [])]
    lines = ['## Objects', f'Reference objects {len(truth)}, extracted {len(got)}. A match is the same kind family within 1.5 cells or 25% box overlap.']
    fams = sorted({family(k) for k, _ in truth} | {family(k) for k, _ in got})
    lines.append(f"{'family':10} {'ref':>4} {'got':>4} {'match':>5} {'recall':>7} {'precis':>7}")
    tot_m = 0
    for fam in fams:
        tr = [b for k, b in truth if family(k) == fam]
        gt = [b for k, b in got if family(k) == fam]
        used, m = set(), 0
        for tb in tr:
            best = next((i for i, gb in enumerate(gt) if i not in used and near(tb, gb)), None)
            if best is not None:
                used.add(best)
                m += 1
        tot_m += m
        lines.append(f"{fam:10} {len(tr):4} {len(gt):4} {m:5} {m / len(tr):7.0%} {(m / len(gt) if gt else 0):7.0%}"
                     if tr else f"{fam:10} {0:4} {len(gt):4} {0:5} {'n/a':>7} {0:7.0%}")
    lines.append(f'Total matched {tot_m}: recall {tot_m / max(1, len(truth)):.0%}, precision {tot_m / max(1, len(got)):.0%}.')
    lines.append('Note: reference objects that came from printed-legend icon matching are noisy, so treat low precision or recall per family with care.')
    return lines


# ---------------------------------------------------------------- terrain

def compare_terrain(doc, cand):
    ref = doc.get('terrain')
    rows = cand.get('terrainRows')
    lines = ['## Terrain']
    if not ref or not rows:
        return lines + ['Nothing to compare.']
    legend_ref = ref['legend']

    def grp(c):
        return GROUP.get(c, 'land')
    conf, agree, total = {}, 0, 0
    for y, row in enumerate(ref['rows']):
        for x, ch in enumerate(row):
            a, b = grp(legend_ref.get(ch, 'unknown')), grp(CHAR_CLASS[rows[y][x]])
            conf[(a, b)] = conf.get((a, b), 0) + 1
            agree += a == b
            total += 1
    lines.append(f'Coarse agreement (water / land / building / void): {agree / total:.0%} of {total} cells. Reference is the automatic colour-cluster terrain, which is unreliable.')
    lines.append('reference -> extracted: ' + ', '.join(f'{a}->{b} {n}' for (a, b), n in sorted(conf.items(), key=lambda kv: -kv[1])[:8]))
    return lines


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    try:
        doc, _ = load_doc(argv[0])
        cols, rows = doc['grid']['columns'], doc['grid']['rows']
        for tag in argv[1:]:
            path = os.path.join(JUDGE_DIR, doc['mapId'], 'extract', tag, 'candidate.json')
            with open(path, encoding='utf-8') as f:
                cand = json.load(f)
            print(f"\n# Experiment {tag} on map {doc['number']}")
            if cand.get('notes'):
                print(f"({len(cand['notes'])} extracted items dropped as invalid)")
            for section in (compare_walls(doc, cand, cols, rows) if 'walls' in cand else [], compare_objects(doc, cand) if 'objects' in cand else [],
                            compare_terrain(doc, cand) if 'terrain' in cand else []):
                print('\n'.join(section))
        return 0
    except (MapBuildError, FileNotFoundError) as e:
        print(f'Error: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
