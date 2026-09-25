"""Grid calibration from 5etools map entries (plan section 3.1, Phase 1)."""
import math
import os
import re

import cv2
import numpy as np

from common import MapBuildError, posmod, read_image


def find_map_entries(adventure_json):
    """Return {basename: entry} for every map / mapPlayer image node.

    basename is like '5.1-palma-flora' (DM) or '5.1-palma-flora-player'.
    """
    found = {}

    def walk(o):
        if isinstance(o, dict):
            if o.get('type') == 'image' and o.get('imageType') in ('map', 'mapPlayer'):
                path = (o.get('href') or {}).get('path', '')
                base = os.path.splitext(os.path.basename(path))[0]
                base = re.sub(r'^\d+-', '', base)
                if base:
                    found[base] = o
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(adventure_json)
    return found


def entry_grid(entry, local_width):
    """Apply the verified 5etools grid formula.

    Returns dict(type, cellPx, originX, originY, feetPerCell, units) in local pixels.
    """
    g = entry.get('grid') or {}
    gtype = g.get('type', 'none')
    f = local_width / entry['width']
    sc = g.get('scale') or 1
    size = g.get('size')
    if not size:
        raise MapBuildError('A 5etools map entry has no grid size.')
    cell = size / sc * f
    return {
        'type': gtype,
        'cellPx': cell,
        'originX': posmod((g.get('offsetX') or 0) / sc * f, cell),
        'originY': posmod((g.get('offsetY') or 0) / sc * f, cell),
        'feetPerCell': g.get('distance') or 5,
        'units': g.get('units') or 'feet',
    }


def check_expected(grid, expected, label, tol=0.5):
    """Fail loudly when the computed grid differs from the manifest."""
    for key in ('cellPx', 'originX', 'originY'):
        if abs(grid[key] - expected[key]) > tol:
            raise MapBuildError(
                f'The computed grid for {label} does not match the manifest. '
                f'{key} is {grid[key]:.2f} but {expected[key]:.2f} was expected.')


def grid_score(gray, cell, origin_x, origin_y):
    """Grid-line sanity score per axis: line response over mid-cell response.

    About 1.0 means the grid is not aligned to any image structure.
    """
    g = gray.astype(np.float32)
    sx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
    sy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    px = sx.mean(axis=0)
    py = sy.mean(axis=1)

    def score(profile, origin):
        n = len(profile)
        lines, mids = [], []
        k = 0
        while True:
            x = origin + k * cell
            i = int(round(x))
            m = int(round(x + cell / 2))
            if i + 2 > n - 1 or m > n - 1:
                break
            if i >= 1:
                lines.append(profile[i - 1:i + 2].max())
                mids.append(profile[m])
            k += 1
        if not lines:
            return 1.0
        denom = float(np.mean(mids))
        return float(np.mean(lines)) / denom if denom > 0 else 1.0

    return score(px, origin_x), score(py, origin_y)


def canonical_size(width, height, cell, origin_x, origin_y):
    return (int(math.floor((width - origin_x) / cell)),
            int(math.floor((height - origin_y) / cell)))


def score_image(path, grid):
    gray = read_image(path, gray=True)
    return grid_score(gray, grid['cellPx'], grid['originX'], grid['originY'])
