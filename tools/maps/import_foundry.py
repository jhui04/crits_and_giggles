"""Import walls, doors, labels, and spawns from ddb-meta Foundry scenes (plan Phase 2)."""
import math
import re

import cv2
import numpy as np

import register_images as reg
from common import MapBuildError

SAMPLES_PER_WALL = 12
SCALE_RANGE = (0.88, 1.12)
NOTE_RE = re.compile(r'^([A-Z]+)0*(\d+)\.\s*(.*?)\.?\s*$')


# ---------------------------------------------------------------- transforms

def scene_pads(scene):
    g = scene['grid']['size']
    pad = scene.get('padding', 0.25)
    return (math.ceil(scene['width'] * pad / g) * g, math.ceil(scene['height'] * pad / g) * g)


def scene_to_player(scene, player_width):
    """Return f(sceneX, sceneY) -> player image pixels (plan section 3.2)."""
    bg = scene.get('background') or {}
    if (bg.get('scaleX', 1) != 1) or (bg.get('scaleY', 1) != 1):
        raise MapBuildError('The scene background is scaled, which this importer does not support.')
    pad_x, pad_y = scene_pads(scene)
    s = player_width / scene['width']
    ox, oy = bg.get('offsetX', 0), bg.get('offsetY', 0)

    def f(x, y):
        return ((x - pad_x + ox) * s, (y - pad_y + oy) * s)

    return f


def wall_points_player(scene, to_player):
    """Array (N, 4) of wall endpoints in player pixels: x1, y1, x2, y2."""
    out = []
    for w in scene.get('walls', []):
        x1, y1, x2, y2 = w['c']
        a = to_player(x1, y1)
        b = to_player(x2, y2)
        out.append((a[0], a[1], b[0], b[1]))
    return np.array(out, dtype=np.float64).reshape(-1, 4)


# --------------------------------------------------------- wall registration

def edge_map(gray):
    g = gray.astype(np.float32)
    sx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    sy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    return cv2.GaussianBlur(np.hypot(sx, sy), (0, 0), 1.5)


def sample_points(walls_px):
    t = np.linspace(0.05, 0.95, SAMPLES_PER_WALL)
    x = walls_px[:, 0:1] + (walls_px[:, 2:3] - walls_px[:, 0:1]) * t[None, :]
    y = walls_px[:, 1:2] + (walls_px[:, 3:4] - walls_px[:, 1:2]) * t[None, :]
    return np.stack([x.ravel(), y.ravel()], axis=1)


def _score_shifts(E, P, sx_arr, sy_arr):
    """Mean edge response at points P shifted by each (sx, sy); 0 if under 90% inside."""
    h, w = E.shape
    n = len(P)
    out = np.zeros(len(sx_arr))
    chunk = max(1, 3_000_000 // max(n, 1))
    for i in range(0, len(sx_arr), chunk):
        sx = sx_arr[i:i + chunk, None]
        sy = sy_arr[i:i + chunk, None]
        X = np.rint(P[None, :, 0] + sx).astype(np.int64)
        Y = np.rint(P[None, :, 1] + sy).astype(np.int64)
        inside = (X >= 0) & (X < w) & (Y >= 0) & (Y < h)
        frac = inside.mean(axis=1)
        vals = E[np.clip(Y, 0, h - 1), np.clip(X, 0, w - 1)] * inside
        sc = vals.sum(axis=1) / np.maximum(inside.sum(axis=1), 1)
        sc[frac < 0.9] = 0.0
        out[i:i + chunk] = sc
    return out


def _scaled(P, center, k):
    return center + k * (P - center)


def search_registration(E, P, cell, max_peaks=8):
    """Coarse-to-fine search over scale and shift. Returns a result dict or None.

    Result: median (of coarse scores), peaks (refined, best first, mutually distinct).
    """
    h, w = E.shape
    center = np.array([w / 2.0, h / 2.0])
    step = max(6, int(round(cell / 30)))
    radius = 1.5 * cell
    shifts = np.arange(-radius, radius + 1e-9, step)
    gx, gy = np.meshgrid(shifts, shifts)
    gx, gy = gx.ravel(), gy.ravel()
    scales = np.round(np.arange(SCALE_RANGE[0], SCALE_RANGE[1] + 1e-9, 0.02), 3)
    # The coarse pass runs on a blurrier edge map so thin wall lines still give a broad peak
    # that a 6 px step cannot skip; refinement below uses the sharp map.
    Ec = cv2.GaussianBlur(E, (0, 0), 3.0)
    K, DX, DY, S = [], [], [], []
    for k in scales:
        sc = _score_shifts(Ec, _scaled(P, center, k), gx, gy)
        K.append(np.full(len(gx), k))
        DX.append(gx)
        DY.append(gy)
        S.append(sc)
    K, DX, DY, S = map(np.concatenate, (K, DX, DY, S))
    valid = S > 0
    if not valid.any():
        return None
    # Median of the sharp-map score over a fixed random sample of candidates.
    rng = np.random.default_rng(0)
    pick = rng.choice(len(S), size=min(3000, len(S)), replace=False)
    sharp = np.array([_score_shifts(E, _scaled(P, center, K[i]), DX[i:i + 1], DY[i:i + 1])[0] for i in pick])
    sharp = sharp[sharp > 0]
    median = float(np.median(sharp)) if len(sharp) else 0.0
    peaks = []
    avail = valid.copy()
    for _ in range(max_peaks):
        if not avail.any():
            break
        i = int(np.argmax(np.where(avail, S, -1)))
        peaks.append((K[i], DX[i], DY[i]))
        far = (np.hypot(DX - DX[i], DY - DY[i]) >= 0.5 * cell) | (np.abs(K - K[i]) >= 0.03)
        avail &= far
    refined = []
    for (k0, dx0, dy0) in peaks:
        ks = np.clip(np.round(np.arange(k0 - 0.02, k0 + 0.02 + 1e-9, 0.01), 3), *SCALE_RANGE)
        offs = np.arange(-step, step + 1e-9, 2.0)
        ox, oy = np.meshgrid(dx0 + offs, dy0 + offs)
        ox, oy = ox.ravel(), oy.ravel()
        best = None
        for k in np.unique(ks):
            sc = _score_shifts(E, _scaled(P, center, k), ox, oy)
            j = int(np.argmax(sc))
            if best is None or sc[j] > best['score']:
                best = {'k': float(k), 'dx': float(ox[j]), 'dy': float(oy[j]), 'score': float(sc[j])}
        refined.append(best)
    refined.sort(key=lambda r: -r['score'])
    # Refinement can pull two coarse peaks onto the same hill; keep only mutually distinct ones.
    distinct = []
    for r in refined:
        if all(np.hypot(r['dx'] - d['dx'], r['dy'] - d['dy']) >= 0.5 * cell or abs(r['k'] - d['k']) >= 0.03
               for d in distinct):
            distinct.append(r)
    refined = distinct
    return {'median': median, 'peaks': refined, 'center': center}


def polygon_edge_distance_map(polys_px, shape):
    mask = np.full(shape, 255, np.uint8)
    for pts in polys_px:
        arr = np.rint(np.array(pts)).astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(mask, [arr], True, 0, 1)
    return cv2.distanceTransform(mask, cv2.DIST_L2, 3)


def polygon_median_distance(dist_map, P, center, cand):
    Q = _scaled(P, center, cand['k']) + np.array([cand['dx'], cand['dy']])
    h, w = dist_map.shape
    X = np.clip(np.rint(Q[:, 0]).astype(int), 0, w - 1)
    Y = np.clip(np.rint(Q[:, 1]).astype(int), 0, h - 1)
    return float(np.median(dist_map[Y, X]))


def decide_registration(res, cell, dist_map=None, P=None, wall_name='Walls'):
    """Apply the plan's accept / resolve / unverified rules.

    Returns dict(status, k, dx, dy, confidence, reason, ratio, distinct).
    status is 'accepted', 'resolved', or 'unverified'.
    """
    unverified = {'status': 'unverified', 'k': 1.0, 'dx': 0.0, 'dy': 0.0, 'confidence': 0.3,
                  'ratio': 0.0, 'distinct': 0.0}
    if res is None or not res['peaks']:
        return {**unverified, 'reason': f'{wall_name} could not be aligned: no usable edge matches were found.'}
    best = res['peaks'][0]
    ratio = best['score'] / res['median'] if res['median'] > 0 else 0.0
    rival = res['peaks'][1]['score'] if len(res['peaks']) > 1 else 0.0
    distinct = best['score'] / rival if rival > 0 else 99.0
    info = {'ratio': ratio, 'distinct': distinct}
    in_bounds = (abs(best['k'] - 1) <= 0.03 and abs(best['dx']) <= cell and abs(best['dy']) <= cell)
    if ratio < 1.5:
        return {**unverified, **info, 'reason':
                f'{wall_name} could not be aligned automatically: the best match was weak '
                f'(peak to median {ratio:.2f}). They are stored but ignored for movement and cover.'}
    if not in_bounds:
        return {**unverified, **info, 'reason':
                f'{wall_name} could not be aligned automatically: the best match needed a large '
                f'correction (scale {best["k"]:.2f}, shift {best["dx"]:.0f} and {best["dy"]:.0f} pixels). '
                'They are stored but ignored for movement and cover.'}
    if distinct >= 1.08:
        exact = abs(best['k'] - 1) < 0.005 and abs(best['dx']) <= 4 and abs(best['dy']) <= 4
        note = ('identity' if exact else
                f'small correction, scale {best["k"]:.2f}, shift {best["dx"]:.0f} and {best["dy"]:.0f} pixels')
        return {'status': 'accepted', 'k': best['k'], 'dx': best['dx'], 'dy': best['dy'],
                'confidence': 0.9 if exact else 0.8, **info,
                'reason': f'walls registered: {note}, peak/median {ratio:.2f}'}
    # Ambiguous: try to break the tie with the 5etools room outlines.
    if dist_map is not None and P is not None:
        cands = [c for c in res['peaks'][:4]
                 if abs(c['k'] - 1) <= 0.03 and abs(c['dx']) <= cell and abs(c['dy']) <= cell]
        if len(cands) >= 2:
            dists = sorted((polygon_median_distance(dist_map, P, res['center'], c), i)
                           for i, c in enumerate(cands))
            d0, d1 = dists[0][0], dists[1][0]
            if d1 > 0 and (d1 - d0) / d1 >= 0.25:
                c = cands[dists[0][1]]
                return {'status': 'resolved', 'k': c['k'], 'dx': c['dx'], 'dy': c['dy'],
                        'confidence': 0.7, **info,
                        'reason': 'walls registered using room outlines to break a tie '
                                  f'(peak/median {ratio:.2f})'}
    return {**unverified, **info, 'ambiguous': True, 'reason':
            f'{wall_name} could not be aligned automatically: several equally good shifts were found. '
            'They are stored but ignored for movement and cover.'}


# ------------------------------------------------------------ classification

def classify_wall(w):
    """Map a Foundry wall to (kind, blocksMovement, blocksSight, cover, door, oneWay)."""
    move, sight = w.get('move', 0), w.get('sight', 0)
    door, ds = w.get('door', 0), w.get('ds', 0)
    one_way = {1: 'left', 2: 'right'}.get(w.get('dir', 0))
    if door == 1:
        state = {0: 'closed', 1: 'open', 2: 'locked'}.get(ds, 'closed')
        is_open = state == 'open'
        return ('door', not is_open, 'none' if is_open else 'full', 'total', {'state': state}, one_way)
    if door == 2:
        return ('secret_door', True, 'full', 'total', {'state': 'closed'}, one_way)
    if move == 0 and sight == 0:
        return ('invisible', False, 'none', 'half', None, one_way)
    if sight == 10:
        return ('terrain_outline', move != 0, 'limited', 'total', None, one_way)
    if sight == 0 and move != 0:
        return ('window', True, 'none', 'half', None, one_way)
    return ('wall', move != 0, 'full', 'total', None, one_way)


def to_grid_units(px, py, player_to_dm, dm_grid):
    x, y = reg.apply_affine(player_to_dm, px, py)
    return ((x - dm_grid['originX']) / dm_grid['cellPx'], (y - dm_grid['originY']) / dm_grid['cellPx'])


class Correction:
    """Registration correction in player pixels: scale about the image centre, then shift."""

    def __init__(self, k=1.0, dx=0.0, dy=0.0, center=(0.0, 0.0)):
        self.k, self.dx, self.dy, self.center = k, dx, dy, center

    def __call__(self, x, y):
        cx, cy = self.center
        return (cx + self.k * (x - cx) + self.dx, cy + self.k * (y - cy) + self.dy)


def convert_walls(scene, to_player, corr, player_to_dm, dm_grid, confidence, note):
    walls = []
    for i, w in enumerate(scene.get('walls', [])):
        x1, y1, x2, y2 = w['c']
        a = corr(*to_player(x1, y1))
        b = corr(*to_player(x2, y2))
        ax, ay = to_grid_units(a[0], a[1], player_to_dm, dm_grid)
        bx, by = to_grid_units(b[0], b[1], player_to_dm, dm_grid)
        kind, blocks_move, blocks_sight, cover, door, one_way = classify_wall(w)
        seg = {
            'id': f'w{i}',
            'a': {'x': round(ax, 3), 'y': round(ay, 3)},
            'b': {'x': round(bx, 3), 'y': round(by, 3)},
            'kind': kind,
            'blocksMovement': blocks_move,
            'blocksSight': blocks_sight,
            'cover': cover,
            'name': 'Secret door' if kind == 'secret_door' else ('Door' if kind == 'door' else 'Wall'),
            'provenance': {'source': 'ddb-meta', 'confidence': confidence, 'note': note},
        }
        if door:
            seg['door'] = door
        if one_way:
            seg['oneWay'] = one_way
        walls.append(seg)
    return walls


# --------------------------------------------------------------- labels/spawns

def parse_note_label(label):
    """'P01. South Shore.' -> ('P1', 'South Shore'); None when unparseable."""
    m = NOTE_RE.match((label or '').strip())
    if not m:
        return None
    return f'{m.group(1)}{m.group(2)}', m.group(3)


def convert_notes(scene, to_player, corr, player_to_dm, dm_grid):
    out = []
    for n in (scene.get('flags', {}).get('ddb', {}).get('notes') or []):
        parsed = parse_note_label(n.get('label'))
        pos = (n.get('positions') or [None])[0]
        if not parsed or not pos:
            continue
        px, py = corr(*to_player(pos['x'], pos['y']))
        gx, gy = to_grid_units(px, py, player_to_dm, dm_grid)
        out.append({'id': parsed[0], 'name': parsed[1], 'gx': gx, 'gy': gy,
                    'cell': {'x': int(math.floor(gx)), 'y': int(math.floor(gy))}})
    return out


def convert_tokens(scene, to_player, corr, player_to_dm, dm_grid, confidence):
    g = scene['grid']['size']
    disp = {-1: 'hostile', 0: 'neutral', 1: 'friendly'}
    spawns = []
    for t in (scene.get('flags', {}).get('ddb', {}).get('tokens') or []):
        cx = t['x'] + t.get('width', 1) * g / 2
        cy = t['y'] + t.get('height', 1) * g / 2
        px, py = corr(*to_player(cx, cy))
        gx, gy = to_grid_units(px, py, player_to_dm, dm_grid)
        sp = {'name': t.get('name', 'Token'),
              'cell': {'x': int(math.floor(gx)), 'y': int(math.floor(gy))},
              'sizeCells': max(1, int(round(t.get('width', 1)))),
              'disposition': disp.get(t.get('disposition', -1), 'hostile'),
              'provenance': {'source': 'ddb-meta', 'confidence': confidence,
                             'note': 'token start position from the D&D Beyond scene'}}
        ddb_id = ((t.get('flags') or {}).get('ddbActorFlags') or {}).get('id')
        if ddb_id:
            sp['ddbMonsterId'] = ddb_id
        spawns.append(sp)
    return spawns


# ---------------------------------------------------------- building footprints

MAX_BUILDING_CELLS = 600


def building_objects(walls, dm_grid, dm_size, columns, rows):
    """Enclosed regions of terrain_outline walls become 'building' objects.

    Returns (objects, skipped_count).
    """
    dm_w, dm_h = dm_size
    cell = dm_grid['cellPx']
    mask = np.zeros((dm_h, dm_w), np.uint8)
    n_outline = 0
    for w in walls:
        if w['kind'] != 'terrain_outline':
            continue
        n_outline += 1
        a = (int(round(dm_grid['originX'] + w['a']['x'] * cell)), int(round(dm_grid['originY'] + w['a']['y'] * cell)))
        b = (int(round(dm_grid['originX'] + w['b']['x'] * cell)), int(round(dm_grid['originY'] + w['b']['y'] * cell)))
        cv2.line(mask, a, b, 255, 3)
    if n_outline == 0:
        return [], 0
    free = (mask == 0).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist())
    objects = []
    skipped = 0
    for lab in range(1, n):
        if lab in border or stats[lab, cv2.CC_STAT_AREA] < cell * cell:
            continue
        comp = (labels == lab).astype(np.float32)
        x0, y0 = dm_grid['originX'], dm_grid['originY']
        crop = comp[int(round(y0)):int(round(y0 + rows * cell)), int(round(x0)):int(round(x0 + columns * cell))]
        if crop.size == 0:
            continue
        cov = cv2.resize(crop, (columns, rows), interpolation=cv2.INTER_AREA)
        ys, xs = np.nonzero(cov >= 0.5)
        if len(xs) == 0:
            continue
        if len(xs) > MAX_BUILDING_CELLS:
            skipped += 1
            continue
        cells = sorted(zip(ys.tolist(), xs.tolist()))
        objects.append({
            'id': f'obj-building-{len(objects) + 1}',
            'kind': 'building',
            'label': 'Building',
            'cells': [f'{x},{y}' for y, x in cells],
            'cover': 'total',
            'blocksMovement': True,
            'blocksSight': True,
            'difficultTerrain': False,
            'provenance': {'source': 'ddb-meta', 'confidence': 0.8,
                           'note': 'footprint enclosed by roof outline walls'},
        })
    return objects, skipped


# --------------------------------------------------------------------- naming

def name_walls(doc):
    """Name walls after the region containing their midpoint (call once regions exist)."""
    cell_region = {}
    for r in doc.get('regions', []):
        for c in r['cells']:
            cell_region.setdefault(c, r['name'])
    for w in doc.get('walls', []):
        if w['kind'] in ('invisible',):
            continue
        mx = (w['a']['x'] + w['b']['x']) / 2
        my = (w['a']['y'] + w['b']['y']) / 2
        name = cell_region.get(f'{int(math.floor(mx))},{int(math.floor(my))}')
        base = {'door': 'door', 'secret_door': 'secret door'}.get(w['kind'], 'wall')
        if name:
            w['name'] = f'{name} {base}'
        else:
            w['name'] = base.capitalize()
