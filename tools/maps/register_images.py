"""DM <-> player image registration (plan Phase 1, steps 4 and 5)."""
import math

import cv2
import numpy as np

from common import read_image


def _orb_matches(src_gray, dst_gray, nfeatures=8000, ratio=0.75):
    orb = cv2.ORB_create(nfeatures=nfeatures)
    k1, d1 = orb.detectAndCompute(src_gray, None)
    k2, d2 = orb.detectAndCompute(dst_gray, None)
    if d1 is None or d2 is None or len(k1) < 8 or len(k2) < 8:
        return [], k1, k2
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    pairs = bf.knnMatch(d1, d2, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < ratio * p[1].distance]
    return good, k1, k2


def estimate_transform(player_gray, dm_gray):
    """Estimate a 2x3 similarity from player pixels to DM pixels.

    Returns (matrix or None, inlier_ratio, n_matches).
    """
    ph, pw = player_gray.shape[:2]
    dh, dw = dm_gray.shape[:2]
    # Bring the larger image down to the smaller width so ORB sees similar scales,
    # then fold the factor back into the transform.
    pre = 1.0
    dst_pre = 1.0
    src, dst = player_gray, dm_gray
    if pw > dw * 1.2:
        pre = dw / pw
        src = cv2.resize(player_gray, (dw, int(round(ph * pre))), interpolation=cv2.INTER_AREA)
    elif dw > pw * 1.2:
        dst_pre = pw / dw
        dst = cv2.resize(dm_gray, (pw, int(round(dh * dst_pre))), interpolation=cv2.INTER_AREA)
    good, k1, k2 = _orb_matches(src, dst)
    if len(good) < 4:
        return None, 0.0, len(good)
    pts_src = np.float32([k1[m.queryIdx].pt for m in good])
    pts_dst = np.float32([k2[m.trainIdx].pt for m in good])
    m, inliers = cv2.estimateAffinePartial2D(
        pts_src, pts_dst, method=cv2.RANSAC, ransacReprojThreshold=3.0)
    if m is None:
        return None, 0.0, len(good)
    ratio = float(inliers.sum()) / len(good)
    # m maps src' (= pre * player) to dst' (= dst_pre * dm).
    m3 = np.vstack([m, [0, 0, 1]])
    s_pre = np.diag([pre, pre, 1.0])
    s_post = np.diag([1 / dst_pre, 1 / dst_pre, 1.0])
    total = s_post @ m3 @ s_pre
    return total[:2], ratio, len(good)


def apply_affine(m, x, y):
    return (m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2])


def invert_affine(m):
    m3 = np.vstack([np.asarray(m, dtype=float), [0, 0, 1]])
    return np.linalg.inv(m3)[:2]


def affine_scale(m):
    return math.sqrt(abs(m[0][0] * m[1][1] - m[0][1] * m[1][0]))


def transform_plausible(m, expected_scale, tol=0.05, max_deg=1.0):
    """Reject registrations with a visible rotation or a scale far from the width ratio."""
    angle = math.degrees(math.atan2(m[1][0], m[0][0]))
    scale = affine_scale(m)
    return abs(angle) <= max_deg and abs(scale / expected_scale - 1) <= tol


def register_files(player_path, dm_path):
    p = read_image(player_path, gray=True)
    d = read_image(dm_path, gray=True)
    return estimate_transform(p, d)


def snap_to_lines(value, origin5, cell):
    """Nearest 5etools grid line to value; returns (snapped, residual_in_cells)."""
    k = round((value - origin5) / cell)
    snapped = origin5 + k * cell
    return snapped, (value - snapped) / cell


def canonical_player_grid(player_to_dm, dm_grid, player_5et):
    """Derive the player variant grid so canonical cell (x, y) matches the DM image.

    The 5etools player grid is authoritative for cell size and line positions; the
    registration decides which integer line is canonical cell 0.
    Returns (grid dict, snapped_warning, max_residual_cells, estimated_cell_px).
    """
    dm_to_player = invert_affine(player_to_dm)
    ox, oy = apply_affine(dm_to_player, dm_grid['originX'], dm_grid['originY'])
    cell_p = player_5et['cellPx']
    sx, rx = snap_to_lines(ox, player_5et['originX'], cell_p)
    sy, ry = snap_to_lines(oy, player_5et['originY'], cell_p)
    residual = max(abs(rx), abs(ry))
    est_cell = dm_grid['cellPx'] * affine_scale(dm_to_player)
    grid = {'cellPx': cell_p, 'originX': sx, 'originY': sy}
    return grid, residual > 0.15, residual, est_cell
