"""Phase 1 tests: grid formula, posmod, and registration on a synthetic pair.

Written as plain functions so both pytest and `build_maps.py --selftest` can run them.
"""
import cv2
import numpy as np

import grid as gridmod
import register_images as reg
from common import MapBuildError, posmod


def test_posmod_is_positive():
    assert posmod(-20 / 2, 37.5) == 27.5
    assert posmod(-9, 72) == 63
    assert abs(posmod(75.0, 37.5)) < 1e-9


def _entry(size, ox, oy, scale=None, width=2550):
    g = {'type': 'square', 'size': size, 'offsetX': ox, 'offsetY': oy}
    if scale:
        g['scale'] = scale
    return {'width': width, 'height': 1650, 'grid': g}


def test_grid_formula_ten_foot_map():
    # Map 5.1: size 75, scale 2, offset (-20, -82) -> 37.5 px cells, origin (27.5, 34.0).
    g = gridmod.entry_grid(_entry(75, -20, -82, scale=2), 2550)
    assert g['cellPx'] == 37.5
    assert abs(g['originX'] - 27.5) < 1e-9
    assert abs(g['originY'] - 34.0) < 1e-9
    assert g['feetPerCell'] == 5


def test_grid_formula_rescales_for_local_width():
    g = gridmod.entry_grid(_entry(206, -115, -72, width=1200), 2400)
    assert g['cellPx'] == 412.0


def test_check_expected_fails_loudly():
    g = {'cellPx': 50.0, 'originX': 1.0, 'originY': 1.0}
    try:
        gridmod.check_expected(g, {'cellPx': 37.5, 'originX': 1.0, 'originY': 1.0}, 'Test map')
    except MapBuildError as exc:
        assert 'Test map' in str(exc)
    else:
        raise AssertionError('expected MapBuildError')


def test_canonical_size():
    assert gridmod.canonical_size(2550, 1650, 37.5, 27.5, 34.0) == (67, 43)


def _synthetic_pair():
    rng = np.random.default_rng(7)
    base = np.full((600, 800), 200, np.uint8)
    for _ in range(140):
        x, y = int(rng.integers(20, 760)), int(rng.integers(20, 560))
        w, h = int(rng.integers(6, 40)), int(rng.integers(6, 40))
        cv2.rectangle(base, (x, y), (x + w, y + h), int(rng.integers(0, 120)), -1)
        cv2.circle(base, (x + 5, y + 9), int(rng.integers(3, 12)), int(rng.integers(30, 250)), 2)
    base = cv2.GaussianBlur(base, (3, 3), 0)
    # The "player" image is the DM image scaled by 2 and shifted by (13, -7) DM pixels.
    m = np.float32([[2, 0, 13 * 2], [0, 2, -7 * 2]])
    player = cv2.warpAffine(base, m, (1600, 1200), borderValue=200)
    return base, player


def test_registration_recovers_scale_and_shift():
    dm, player = _synthetic_pair()
    est, ratio, n = reg.estimate_transform(player, dm)
    assert est is not None and ratio > 0.5
    # The player point (2*100+26, 2*50-14) came from DM point (100, 50).
    assert abs(reg.affine_scale(est) - 0.5) < 0.01
    x, y = reg.apply_affine(est, 2 * 100 + 26, 2 * 50 - 14)
    assert abs(x - 100) < 1.5 and abs(y - 50) < 1.5


def test_snap_to_lines():
    snapped, resid = reg.snap_to_lines(29.4, 27.5, 37.5)
    assert abs(snapped - 27.5) < 1e-9
    assert abs(resid) < 0.06
    snapped, resid = reg.snap_to_lines(27.5 + 37.5 * 3 + 1, 27.5, 37.5)
    assert abs(snapped - (27.5 + 37.5 * 3)) < 1e-9


def test_canonical_player_grid_identity():
    ident = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
    dm = {'cellPx': 37.5, 'originX': 27.5, 'originY': 34.0}
    grid, snapped, resid, est = reg.canonical_player_grid(ident, dm, dm)
    assert not snapped and resid < 1e-6
    assert grid['originX'] == 27.5 and grid['originY'] == 34.0
    assert abs(est - 37.5) < 1e-6


def test_transform_plausibility_guard():
    ok = np.array([[0.5, 0.0, 3.0], [0.0, 0.5, -2.0]])
    assert reg.transform_plausible(ok, 0.5)
    rot = cv2.getRotationMatrix2D((0, 0), 5, 0.5)
    assert not reg.transform_plausible(rot, 0.5)
    assert not reg.transform_plausible(np.array([[0.8, 0, 0], [0, 0.8, 0]]), 0.5)
