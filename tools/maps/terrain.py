"""Automatic terrain classification (plan Phase 4b, 4c).

The cluster backend groups image samples by colour and texture, then asks a small
vision model to name each cluster from a handful of crops. No human looks at anything.
"""
import math
from collections import Counter

import cv2
import numpy as np

import regions as rg

TERRAIN_CLASSES = ['void', 'building', 'cliff', 'water_deep', 'water_shallow', 'sand', 'grass', 'dirt',
                   'stone_floor', 'wood_floor', 'rubble', 'dense_vegetation', 'mud', 'ice', 'unknown']
CODES = {'void': '#', 'building': 'B', 'cliff': '^', 'water_deep': 'W', 'water_shallow': 'w', 'sand': 's',
         'grass': 'g', 'dirt': 'd', 'stone_floor': 'f', 'wood_floor': 'p', 'rubble': 'r',
         'dense_vegetation': 'v', 'mud': 'm', 'ice': 'i', 'unknown': '?'}
LEGEND = {code: cls for cls, code in CODES.items()}
CLASSIFY_CHOICES = [c for c in TERRAIN_CLASSES if c != 'unknown']
SUB = 4  # sub-samples per cell side


def sample_features(img_bgr, grid, columns, rows):
    """(rows*SUB, columns*SUB, 7) standardized features: mean/std of Lab plus Sobel magnitude."""
    x0, y0, cell = grid['originX'], grid['originY'], grid['cellPx']
    w, h = int(round(columns * cell)), int(round(rows * cell))
    xi, yi = int(round(x0)), int(round(y0))
    crop = img_bgr[yi:yi + h, xi:xi + w]
    if crop.shape[0] < h or crop.shape[1] < w:  # grid runs past the image edge
        pad = np.zeros((h, w, 3), np.uint8)
        pad[:crop.shape[0], :crop.shape[1]] = crop
        crop = pad
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2Lab).astype(np.float32)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY).astype(np.float32)
    sob = np.hypot(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    size = (columns * SUB, rows * SUB)
    mean = cv2.resize(lab, size, interpolation=cv2.INTER_AREA)
    mean2 = cv2.resize(lab * lab, size, interpolation=cv2.INTER_AREA)
    std = np.sqrt(np.maximum(mean2 - mean * mean, 0))
    sobm = cv2.resize(sob, size, interpolation=cv2.INTER_AREA)[..., None]
    feats = np.concatenate([mean, std, sobm], axis=2)
    flat = feats.reshape(-1, 7)
    mu, sd = flat.mean(axis=0), flat.std(axis=0)
    sd[sd < 1e-6] = 1.0
    return feats, (feats - mu) / sd


def kmeans_labels(std_feats, valid_mask, k):
    """Cluster valid sub-cells; returns int labels with -1 for excluded ones."""
    h, w, _ = std_feats.shape
    data = std_feats.reshape(-1, 7)[valid_mask.ravel()].astype(np.float32)
    k = max(1, min(k, len(data)))
    cv2.setRNGSeed(0)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.5)
    _c, lab, centers = cv2.kmeans(data, k, None, crit, 10, cv2.KMEANS_PP_CENTERS)
    out = np.full(h * w, -1, np.int32)
    out[valid_mask.ravel()] = lab.ravel()
    return out.reshape(h, w), centers, data


def build_prompt(legend_names, title=None):
    p = ('This is a top-down fantasy battle map' + (f' ({title})' if title else '') +
         '. A red circle marks one spot. What is the ground under the red circle? '
         'Answer with exactly one word from: ' + ', '.join(CLASSIFY_CHOICES) + '.')
    # Legend names are deliberately not added: 'Sandy Beach' in the prompt pulled every answer to sand.
    return p


INK_SOBEL = 120.0
INK_STD_L = 20.0
MARK_WIDTH = 1275


def marked_overview(img_bgr, px, py, cell):
    """Whole map downscaled, with a red circle at (px, py). Whole-map context is what lets a
    small model tell water from paper; tight crops of a few cells fail badly."""
    s = MARK_WIDTH / img_bgr.shape[1]
    small = cv2.resize(img_bgr, (MARK_WIDTH, int(round(img_bgr.shape[0] * s))), interpolation=cv2.INTER_AREA)
    r = int(max(14, round(cell * s * 0.8)))
    cv2.circle(small, (int(round(px * s)), int(round(py * s))), r, (0, 0, 255), 4)
    return small


def cluster_is_ink(feats_raw, mask):
    """Dark, edge-heavy clusters are drawn lines and icons, not ground."""
    f = feats_raw[mask]
    return bool(f[:, 6].mean() > INK_SOBEL or f[:, 3].mean() / 255 * 100 > INK_STD_L)


def ink_clusters(feats_raw, labels, k):
    return {c for c in range(k) if (labels == c).any() and cluster_is_ink(feats_raw, labels == c)}


def cell_cluster_map(labels, ink, columns, rows):
    """Plurality non-ink cluster per cell. Returns (ids, share); ids is -1 for all-ink or excluded cells."""
    ids = np.full((rows, columns), -1, np.int32)
    share = np.zeros((rows, columns), np.float32)
    excluded = np.zeros((rows, columns), bool)
    for y in range(rows):
        for x in range(columns):
            block = labels[y * SUB:(y + 1) * SUB, x * SUB:(x + 1) * SUB].ravel()
            valid = block[block >= 0]
            if len(valid) == 0:
                excluded[y, x] = True
                continue
            keep = valid[[int(v) not in ink for v in valid]]
            if len(keep) == 0:
                continue
            cnt = np.bincount(keep)
            ids[y, x] = int(cnt.argmax())
            share[y, x] = cnt.max() / len(valid)
    return ids, share, excluded


def cluster_components(ids):
    """[(cluster, [(x, y), ...])] of 8-connected same-cluster cells."""
    rows, cols = ids.shape
    seen = np.zeros(ids.shape, bool)
    comps = []
    for y in range(rows):
        for x in range(cols):
            if seen[y, x] or ids[y, x] < 0:
                continue
            c = ids[y, x]
            stack, cells = [(x, y)], []
            seen[y, x] = True
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < cols and 0 <= ny < rows and not seen[ny, nx] and ids[ny, nx] == c:
                            seen[ny, nx] = True
                            stack.append((nx, ny))
            comps.append((int(c), cells))
    return comps


def interior_points(cells, count, min_gap=3):
    """Cells deepest inside the component (far from its edge), at least min_gap apart."""
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    x0, y0 = min(xs), min(ys)
    w, h = max(xs) - x0 + 3, max(ys) - y0 + 3
    mask = np.zeros((h, w), np.uint8)
    for (x, y) in cells:
        mask[y - y0 + 1, x - x0 + 1] = 1
    dist = cv2.distanceTransform(mask, cv2.DIST_L2, 3)
    order = sorted(cells, key=lambda c: -dist[c[1] - y0 + 1, c[0] - x0 + 1])
    chosen = []
    for c in order:
        if all(math.hypot(c[0] - a, c[1] - b) >= min_gap for a, b in chosen):
            chosen.append(c)
            if len(chosen) >= count:
                break
    return chosen


MIN_LABEL_CELLS = 6


def label_components(img_bgr, grid, comps, vlm, legend_names, title=None):
    """{index into comps: (class, confidence)} for components big enough to be worth asking about."""
    out = {}
    cell = grid['cellPx']
    prompt = build_prompt(legend_names, title)
    for i, (_c, cells) in enumerate(comps):
        n = len(cells)
        if n < MIN_LABEL_CELLS:
            continue
        want = 3 if n >= 60 else 2 if n >= 25 else 1
        votes = []
        for (cx, cy) in interior_points(cells, want):
            px = grid['originX'] + (cx + 0.5) * cell
            py = grid['originY'] + (cy + 0.5) * cell
            ans = vlm.classify(marked_overview(img_bgr, px, py, cell), prompt, CLASSIFY_CHOICES)
            if ans:
                votes.append(ans)
        if not votes:
            out[i] = ('unknown', 0.0)
            continue
        cls, k = Counter(votes).most_common(1)[0]
        out[i] = (cls, k / len(votes))
    return out


def classes_from_components(comps, labelled, ids_shape, share):
    """Per-cell class grid (None where unlabelled) and confidence dict."""
    rows, cols = ids_shape
    dom = [[None] * cols for _ in range(rows)]
    conf = {}
    for i, (_c, cells) in enumerate(comps):
        if i not in labelled:
            continue
        cls, cf = labelled[i]
        if cls == 'unknown':
            continue  # left for neighbours to fill
        for (x, y) in cells:
            dom[y][x] = cls
            cc = cf * float(share[y, x])
            if cc < 0.8:
                conf[f'{x},{y}'] = round(cc, 2)
    return dom, conf


def fill_ink(dom):
    """Unlabelled cells (ink lines, tiny pieces) take the majority class of labelled neighbours."""
    rows, cols = len(dom), len(dom[0])
    for _ in range(6):
        todo = [(x, y) for y in range(rows) for x in range(cols) if dom[y][x] is None]
        if not todo:
            break
        new = {}
        for (x, y) in todo:
            around = Counter(dom[y + dy][x + dx] for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                             if (dx or dy) and 0 <= x + dx < cols and 0 <= y + dy < rows
                             and dom[y + dy][x + dx] is not None)
            if around:
                new[(x, y)] = around.most_common(1)[0][0]
        for (x, y), c in new.items():
            dom[y][x] = c
    for y in range(rows):
        for x in range(cols):
            if dom[y][x] is None:
                dom[y][x] = 'unknown'
    return dom


def cleanup_small_components(dom, max_size=2):
    """Reassign components of <= max_size cells to the majority class of their neighbours."""
    rows, cols = len(dom), len(dom[0])
    seen = set()
    for y in range(rows):
        for x in range(cols):
            if (x, y) in seen:
                continue
            cls = dom[y][x]
            comp, stack = {(x, y)}, [(x, y)]
            while stack:
                cx, cy = stack.pop()
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if (nx, ny) not in comp and 0 <= nx < cols and 0 <= ny < rows and dom[ny][nx] == cls:
                            comp.add((nx, ny))
                            stack.append((nx, ny))
            seen |= comp
            if len(comp) > max_size:
                continue
            around = Counter()
            for (cx, cy) in comp:
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if (nx, ny) not in comp and 0 <= nx < cols and 0 <= ny < rows:
                            around[dom[ny][nx]] += 1
            if around:
                new = around.most_common(1)[0][0]
                for (cx, cy) in comp:
                    dom[cy][cx] = new
    return dom


def reachable_cells(start_cells, walls, columns, rows, min_conf=0.5):
    """Cells reachable from start_cells by 4-way steps that do not cross a blocking wall."""
    # Doors can be opened, so they do not make a room unreachable.
    blockers = [((w['a']['x'], w['a']['y']), (w['b']['x'], w['b']['y']))
                for w in walls if w['blocksMovement'] and w['provenance']['confidence'] >= min_conf
                and w['kind'] not in ('door', 'secret_door')]
    seen = set(start_cells)
    stack = list(start_cells)
    while stack:
        x, y = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n in seen or not (0 <= n[0] < columns and 0 <= n[1] < rows):
                continue
            a, b = (x + 0.5, y + 0.5), (n[0] + 0.5, n[1] + 0.5)
            if any(rg._segments_cross(a, b, p, q) for p, q in blockers):
                continue
            seen.add(n)
            stack.append(n)
    return seen


def transform_box(box, m):
    """Axis-aligned bounding box of a player-image box mapped through affine m (to DM pixels)."""
    import register_images as reg
    x1, y1, x2, y2 = box
    pts = [reg.apply_affine(m, x, y) for x, y in ((x1, y1), (x2, y1), (x2, y2), (x1, y2))]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def exclusion_mask(shape, grid, box_dm):
    """Boolean (rows*SUB, columns*SUB) mask of sub-cells inside the DM-pixel box."""
    rows_sub, cols_sub = shape
    mask = np.zeros(shape, bool)
    if box_dm is None:
        return mask
    x1, y1, x2, y2 = box_dm
    step = grid['cellPx'] / SUB
    xs = grid['originX'] + (np.arange(cols_sub) + 0.5) * step
    ys = grid['originY'] + (np.arange(rows_sub) + 0.5) * step
    mask[np.ix_((ys >= y1) & (ys <= y2), (xs >= x1) & (xs <= x2))] = True
    return mask


def build_terrain(img_bgr, grid, columns, rows, k, vlm, legend_names=None, exclude_box_dm=None,
                  building_cells=None, unreachable=None, backend='cluster', title=None):
    """Return (TerrainLayer dict, info dict). See plan section 4.3 for the layer shape."""
    # Clustering runs on a median-filtered copy so thin grid lines do not dominate the features.
    feats, std = sample_features(cv2.medianBlur(img_bgr, 7), grid, columns, rows)
    excluded_sub = exclusion_mask(std.shape[:2], grid, exclude_box_dm)
    labels, _centers, _data = kmeans_labels(std, ~excluded_sub, k)
    k = int(labels.max()) + 1
    ink = ink_clusters(feats, labels, k)
    ids, share, excluded = cell_cluster_map(labels, ink, columns, rows)
    comps = cluster_components(ids)
    labelled = label_components(img_bgr, grid, comps, vlm, legend_names or [], title)
    dom, conf = classes_from_components(comps, labelled, (rows, columns), share)
    guessed = [(x, y) for y in range(rows) for x in range(columns) if dom[y][x] is None and not excluded[y, x]]
    for y in range(rows):
        for x in range(columns):
            if excluded[y, x]:
                dom[y][x] = 'void'
    before = [row[:] for row in dom]
    dom = fill_ink(dom)
    dom = cleanup_small_components(dom)
    # Cells filled in from their neighbours (lines, tiny pieces) or changed by cleanup are guesses.
    for (x, y) in guessed:
        conf[f'{x},{y}'] = min(conf.get(f'{x},{y}', 1.0), 0.5)
    for y in range(rows):
        for x in range(columns):
            if dom[y][x] != before[y][x]:
                conf[f'{x},{y}'] = min(conf.get(f'{x},{y}', 1.0), 0.5)
    for (x, y) in (building_cells or []):
        if 0 <= x < columns and 0 <= y < rows:
            dom[y][x] = 'building'
            conf.pop(f'{x},{y}', None)
    for (x, y) in (unreachable or []):
        if 0 <= x < columns and 0 <= y < rows:
            dom[y][x] = 'void'
            conf.pop(f'{x},{y}', None)
    mixed = {}
    rows_txt = [''.join(CODES[c] for c in row) for row in dom]
    known = sum(1 for row in dom for c in row if c != 'unknown')
    layer = {'legend': dict(LEGEND), 'rows': rows_txt}
    if mixed:
        layer['mixed'] = mixed
    if conf:
        layer['confidence'] = conf
    mean_conf = float(np.mean([0.0 if dom[y][x] == 'unknown' else conf.get(f'{x},{y}', 1.0)
                               for y in range(rows) for x in range(columns)]))
    return layer, {'known': known, 'total': columns * rows, 'meanConfidence': mean_conf,
                   'clusters': {i: v for i, v in labelled.items()}}
