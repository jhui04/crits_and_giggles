"""Phase 4 tests: k-means terrain labelling, template matching, cleanup, printed labels."""
import cv2
import numpy as np

import objects as ob
import terrain as tr
import vlm as vlmmod

GRID = {'cellPx': 20.0, 'originX': 0.0, 'originY': 0.0}


class FakeVLM:
    """Answers by the red-circle position: left half is water, right half is grass."""
    enabled = True
    failed = False
    model = 'fake'

    def classify(self, img, prompt, choices):
        red = np.argwhere((img[..., 2] > 200) & (img[..., 1] < 60) & (img[..., 0] < 60))
        if len(red) == 0:
            return None
        return 'water_shallow' if red[:, 1].mean() < img.shape[1] / 2 else 'grass'


def _two_colour_image(cols=20, rows=10):
    img = np.zeros((rows * 20, cols * 20, 3), np.uint8)
    img[:, : cols * 10] = (200, 160, 60)   # bluish
    img[:, cols * 10:] = (60, 170, 70)     # greenish
    return img


def test_kmeans_labelling_on_two_colour_image():
    img = _two_colour_image()
    layer, info = tr.build_terrain(img, GRID, 20, 10, 2, FakeVLM())
    rows = layer['rows']
    assert len(rows) == 10 and all(len(r) == 20 for r in rows)
    assert all(r[:10] == 'w' * 10 for r in rows)
    assert all(r[10:] == 'g' * 10 for r in rows)
    assert info['known'] == 200


def test_no_vlm_leaves_everything_unknown():
    layer, info = tr.build_terrain(_two_colour_image(), GRID, 20, 10, 2, vlmmod.VLM(enabled=False))
    assert set(''.join(layer['rows'])) == {'?'}
    assert info['known'] == 0


def test_small_component_cleanup():
    dom = [['grass'] * 6 for _ in range(6)]
    dom[2][2] = 'sand'
    dom = tr.cleanup_small_components(dom)
    assert dom[2][2] == 'grass'
    big = [['grass'] * 6 for _ in range(6)]
    for y in range(2, 5):
        for x in range(2, 5):
            big[y][x] = 'sand'
    assert tr.cleanup_small_components(big)[3][3] == 'sand'


def test_fill_ink_uses_neighbours():
    dom = [['water_deep', None, 'water_deep'], ['water_deep', None, 'water_deep']]
    out = tr.fill_ink(dom)
    assert out[0][1] == 'water_deep' and out[1][1] == 'water_deep'


def test_answer_matching_and_synonyms():
    ch = tr.CLASSIFY_CHOICES
    assert vlmmod.match_choice('Water_deep.', ch) == 'water_deep'
    assert vlmmod.match_choice('stone floor', ch) == 'stone_floor'
    assert vlmmod.match_choice('a palm tree', ch) == 'dense_vegetation'
    assert vlmmod.match_choice('banana', ch) is None


def _stamp_image():
    img = np.full((300, 400), 200, np.uint8)
    tmpl = np.full((21, 21), 200, np.uint8)
    cv2.circle(tmpl, (10, 10), 7, 40, -1)
    cv2.line(tmpl, (2, 2), (18, 5), 90, 2)
    for (x, y) in ((50, 60), (200, 100), (300, 220)):
        img[y:y + 21, x:x + 21] = tmpl
    return img, tmpl


def test_template_matching_finds_stamps():
    img, tmpl = _stamp_image()
    hits = ob.match_template_hits(img, tmpl, min_score=0.8, scales=(1.0,), rotations=(0,))
    centres = sorted((round(h[0]), round(h[1])) for h in hits)
    assert centres == [(60, 70), (210, 110), (310, 230)]


def test_tight_crop_and_exemplar_extraction():
    row = np.full((64, 130), 220, np.uint8)
    cv2.rectangle(row, (20, 20), (44, 50), 40, -1)
    x0, y0, x1, y1 = ob.tight_crop(row)
    assert 16 <= x0 <= 22 and 44 <= x1 <= 50 and 16 <= y0 <= 22 and 46 <= y1 <= 54


def test_bbox_cells_never_empty():
    cells = ob.bbox_cells(100, 100, 4, 4, GRID, 50, 50)
    assert cells == {'4,4'} or len(cells) == 1
    big = ob.bbox_cells(100, 100, 40, 40, GRID, 50, 50)
    assert len(big) >= 4


def test_printed_labels_place_objects():
    doc = {'grid': {'columns': 5, 'rows': 6}, 'objects': [], 'regions': [], 'audit': []}
    ctx = {'variants': {'dm': {'grid': {'cellPx': 206.0, 'originX': 91.0, 'originY': 134.0}}}}
    spec = {'printedLabels': {'items': [['Bed', 297, 1213], ['Window', 120, 435], ['Broken Table', 805, 808]]}}
    ob.label_objects(spec, doc, ctx, {})
    kinds = sorted(o['kind'] for o in doc['objects'])
    assert kinds == ['bed', 'rubble']
    assert any(a['code'] == 'PRINTED_LABELS_INFO' for a in doc['audit'])
