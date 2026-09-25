"""Regions from 5etools outlines, hotspots, ddb notes, and legacy hand-coded data (plan Phase 3)."""
import math
import os
from collections import deque

import cv2
import numpy as np

import polygons as poly

ADVENTURE_FILES = {'ToR': 'adventure-tor.json', 'DD': 'adventure-dd.json',
                   'FS': 'adventure-fs.json', 'US': 'adventure-us.json'}


def area_index(adventure_json):
    """{areaId: entries node} for every named 'entries' node with an id."""
    idx = {}

    def walk(o):
        if isinstance(o, dict):
            if o.get('type') == 'entries' and 'id' in o and 'name' in o:
                idx[o['id']] = o
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(adventure_json)
    return idx


def cell_key(x, y):
    return f'{x},{y}'


def sort_cells(cells):
    """Row-major order of 'x,y' strings."""
    def k(c):
        x, y = c.split(',')
        return (int(y), int(x))
    return sorted(cells, key=k)


def px_to_cell(px, py, grid):
    return (int(math.floor((px - grid['originX']) / grid['cellPx'])),
            int(math.floor((py - grid['originY']) / grid['cellPx'])))


def polygon_coverage(points, dm_size, grid, columns, rows):
    """{(x, y): coverage 0..1} of cells overlapped by the polygon (DM pixels)."""
    w, h = dm_size
    mask = np.zeros((h, w), np.uint8)
    arr = np.rint(np.array(points)).astype(np.int32).reshape(-1, 1, 2)
    cv2.fillPoly(mask, [arr], 255)
    x0, y0, cell = grid['originX'], grid['originY'], grid['cellPx']
    crop = mask[int(round(y0)):int(round(y0 + rows * cell)),
                int(round(x0)):int(round(x0 + columns * cell))].astype(np.float32) / 255.0
    if crop.size == 0:
        return {}
    cov = cv2.resize(crop, (columns, rows), interpolation=cv2.INTER_AREA)
    ys, xs = np.nonzero(cov > 0)
    return {(int(x), int(y)): float(cov[y, x]) for y, x in zip(ys, xs)}


def resolve_overlaps(coverages):
    """coverages: {regionId: {cell: cov}} -> {regionId: set(cells)} with cov >= 0.5.

    Higher coverage wins a shared cell; on a tie the smaller region wins.
    """
    sizes = {rid: sum(1 for v in cov.values() if v >= 0.5) for rid, cov in coverages.items()}
    owner = {}
    for rid, cov in coverages.items():
        for c, v in cov.items():
            if v < 0.5:
                continue
            cur = owner.get(c)
            if cur is None or (v, -sizes[rid]) > (cur[1], -sizes[cur[0]]):
                owner[c] = (rid, v)
    out = {rid: set() for rid in coverages}
    for c, (rid, _v) in owner.items():
        out[rid].add(c)
    return out


def legacy_to_new_cells(legacy_cells, legacy_grid, grid, columns, rows):
    """New-grid cells whose centre lies inside any legacy cell of the region."""
    lset = set(legacy_cells)
    out = set()
    lp = legacy_grid['cellPitch']
    for y in range(rows):
        for x in range(columns):
            px = grid['originX'] + (x + 0.5) * grid['cellPx']
            py = grid['originY'] + (y + 0.5) * grid['cellPx']
            lc = int(math.floor((px - legacy_grid['offsetX']) / lp))
            lr = int(math.floor((py - legacy_grid['offsetY']) / lp))
            if cell_key(lc, lr) in lset:
                out.add((x, y))
    return out


def geodesic_nearest_label(labels, walkable, columns, rows, max_dist=12):
    """Multi-source BFS (8-way) from label cells over walkable cells.

    labels: {regionId: [(x, y), ...]}. walkable(x, y) -> bool. Returns {regionId: set(cells)}.
    """
    owner = {}
    dq = deque()
    for rid, cells in labels.items():
        for (x, y) in cells:
            if (x, y) not in owner and 0 <= x < columns and 0 <= y < rows:
                owner[(x, y)] = (rid, 0)
                dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        rid, d = owner[(x, y)]
        if d >= max_dist:
            continue
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if not dx and not dy:
                    continue
                nx, ny = x + dx, y + dy
                if 0 <= nx < columns and 0 <= ny < rows and (nx, ny) not in owner and walkable(nx, ny):
                    owner[(nx, ny)] = (rid, d + 1)
                    dq.append((nx, ny))
    out = {rid: set() for rid in labels}
    for c, (rid, _d) in owner.items():
        out[rid].add(c)
    return out


def _segments_cross(p1, p2, q1, q2):
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = ccw(p1, p2, q1), ccw(p1, p2, q2)
    d3, d4 = ccw(q1, q2, p1), ccw(q1, q2, p2)
    return (d1 * d2 < 0) and (d3 * d4 < 0)


def flood_fill_region(start, walls, columns, rows, cap=400, min_conf=0.5):
    """BFS from start across steps not blocked by walls. Returns (cells, leaked)."""
    blockers = [((w['a']['x'], w['a']['y']), (w['b']['x'], w['b']['y']))
                for w in walls if w['blocksMovement'] and w['provenance']['confidence'] >= min_conf]
    seen = {start}
    dq = deque([start])
    while dq:
        x, y = dq.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n in seen or not (0 <= n[0] < columns and 0 <= n[1] < rows):
                continue
            a, b = (x + 0.5, y + 0.5), (n[0] + 0.5, n[1] + 0.5)
            if any(_segments_cross(a, b, p, q) for p, q in blockers):
                continue
            seen.add(n)
            dq.append(n)
            if len(seen) > cap:
                return set(), True
    return seen, False


def connected_components(cells):
    """8-way connected components of a set of (x, y) cells."""
    left = set(cells)
    comps = []
    while left:
        s = left.pop()
        comp = {s}
        dq = deque([s])
        while dq:
            x, y = dq.popleft()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n in left:
                        left.discard(n)
                        comp.add(n)
                        dq.append(n)
        comps.append(comp)
    return comps


def centre_cell(cells):
    """The member cell closest to the mean position."""
    mx = sum(c[0] for c in cells) / len(cells)
    my = sum(c[1] for c in cells) / len(cells)
    return min(cells, key=lambda c: (c[0] - mx) ** 2 + (c[1] - my) ** 2)


def make_region(rid, name, cells, label_cells, method, conf, note, text_ref=None):
    r = {
        'id': rid,
        'name': name,
        'cells': sort_cells(cell_key(x, y) for x, y in cells),
        'labelCells': [{'x': x, 'y': y} for x, y in label_cells],
        'extentMethod': method,
        'provenance': {'source': {'polygon': '5etools', 'legacy': 'legacy-handcoded',
                                  'nearest-label': 'derived', 'flood-fill': 'derived',
                                  'label-only': '5etools'}.get(method, 'derived'),
                       'confidence': conf, 'note': note},
    }
    if text_ref:
        r['textRef'] = text_ref
    return r


def area_text_ref(adv_file, area_id, node):
    ref = {'source': '5etools', 'file': adv_file, 'areaId': area_id}
    if node.get('page') is not None:
        ref['page'] = node['page']
    return ref


def slugify(name):
    s = ''.join(ch.lower() if ch.isalnum() else '-' for ch in name).strip('-')
    while '--' in s:
        s = s.replace('--', '-')
    return s
