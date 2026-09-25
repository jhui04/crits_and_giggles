"""5etools mapRegions helpers: classification and pixel conversion (plan 3.1, Phase 3 step 1)."""
import re


def polygon_area(points):
    a = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def classify_polygon(points, local_width, cell_px):
    """'hotspot' for a small square drawn around a label badge, else 'outline'.

    A hotspot has 4 points, both bounding-box sides between 80 and 130 px (scaled by
    localWidth / 2550), and an area below 12 cells.
    """
    if len(points) != 4:
        return 'outline'
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    k = local_width / 2550.0
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    lo, hi = 80 * k, 130 * k
    if lo <= w <= hi and lo <= h <= hi and polygon_area(points) < 12 * cell_px * cell_px:
        return 'hotspot'
    return 'outline'


def split_area_name(name):
    """'P9. Tavern' -> ('P9', 'Tavern'); returns (None, name) when there is no key."""
    m = re.match(r'^\s*([A-Z]+)0*(\d+)\.?\s*(.*?)\.?\s*$', name or '')
    if not m:
        return None, (name or '').strip()
    return f'{m.group(1)}{m.group(2)}', m.group(3)


def map_regions_px(entry, scale=1.0):
    """[(area_id, [(x, y), ...])] in local pixels of the entry's own image."""
    out = []
    for r in entry.get('mapRegions') or []:
        pts = [(p[0] * scale, p[1] * scale) for p in r.get('points', [])]
        if len(pts) >= 3:
            out.append((r.get('area'), pts))
    return out
