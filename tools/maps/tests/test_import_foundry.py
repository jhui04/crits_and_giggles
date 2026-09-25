"""Phase 2 tests: scene transform, wall classification, registration on a synthetic shift."""
import cv2
import numpy as np

import import_foundry as fy
import register_images as reg


def _scene(w=6809, h=4406, pad=0.25, g=100, ox=-20, oy=-8):
    return {'width': w, 'height': h, 'padding': pad,
            'grid': {'size': g}, 'background': {'offsetX': ox, 'offsetY': oy, 'scaleX': 1, 'scaleY': 1}}


def test_scene_transform_origin():
    sc = _scene()
    assert fy.scene_pads(sc) == (1800, 1200)
    f = fy.scene_to_player(sc, 6809)
    assert f(1820, 1208) == (0.0, 0.0)
    f2 = fy.scene_to_player(sc, 6809 / 2)
    x, y = f2(1820 + 200, 1208 + 100)
    assert abs(x - 100) < 1e-9 and abs(y - 50) < 1e-9


def test_scaled_background_is_rejected():
    sc = _scene()
    sc['background']['scaleX'] = 2
    try:
        fy.scene_to_player(sc, 100)
    except Exception as exc:
        assert 'scaled' in str(exc)
    else:
        raise AssertionError('expected an error')


def test_wall_classification():
    assert fy.classify_wall({'move': 20, 'sight': 20})[0:4] == ('wall', True, 'full', 'total')
    assert fy.classify_wall({'move': 20, 'sight': 10})[0:3] == ('terrain_outline', True, 'limited')
    assert fy.classify_wall({'move': 20, 'sight': 0})[0:3] == ('window', True, 'none')
    assert fy.classify_wall({'move': 0, 'sight': 0})[0] == 'invisible'
    door = fy.classify_wall({'move': 20, 'sight': 20, 'door': 1, 'ds': 2})
    assert door[0] == 'door' and door[1] is True and door[4] == {'state': 'locked'}
    opened = fy.classify_wall({'move': 20, 'sight': 20, 'door': 1, 'ds': 1})
    assert opened[1] is False and opened[2] == 'none'
    assert fy.classify_wall({'move': 20, 'sight': 20, 'door': 2})[0] == 'secret_door'
    assert fy.classify_wall({'move': 20, 'sight': 20, 'dir': 2})[5] == 'right'


def test_note_label_parsing():
    assert fy.parse_note_label('P01. South Shore') == ('P1', 'South Shore')
    assert fy.parse_note_label('S06. Vault of Wonders.') == ('S6', 'Vault of Wonders')
    assert fy.parse_note_label('nonsense') is None


def _synthetic_walls_image():
    img = np.full((600, 800), 210, np.uint8)
    rng = np.random.default_rng(3)
    walls = []
    for _ in range(60):
        x, y = int(rng.integers(40, 740)), int(rng.integers(40, 540))
        if rng.random() < 0.5:
            x2, y2 = x + int(rng.integers(40, 120)), y
        else:
            x2, y2 = x, y + int(rng.integers(40, 120))
        cv2.line(img, (x, y), (min(x2, 790), min(y2, 590)), 30, 3)
        walls.append((x, y, min(x2, 790), min(y2, 590)))
    return img, np.array(walls, dtype=float)


def test_registration_recovers_known_shift():
    img, walls = _synthetic_walls_image()
    shifted = walls + np.array([9.0, -7.0, 9.0, -7.0])  # the scene is off by (9, -7) pixels
    P = fy.sample_points(shifted)
    res = fy.search_registration(fy.edge_map(img), P, cell=40)
    dec = fy.decide_registration(res, 40)
    assert dec['status'] == 'accepted', dec
    assert abs(dec['dx'] - -9) <= 3 and abs(dec['dy'] - 7) <= 3


def test_registration_rejects_noise():
    rng = np.random.default_rng(1)
    img = (rng.random((400, 600)) * 40 + 100).astype(np.uint8)
    P = fy.sample_points(rng.random((30, 4)) * [560, 360, 560, 360] + 10)
    dec = fy.decide_registration(fy.search_registration(fy.edge_map(img), P, cell=40), 40)
    assert dec['status'] == 'unverified'


def test_building_footprint_from_outline_walls():
    dm = {'cellPx': 10.0, 'originX': 0.0, 'originY': 0.0}
    box = [((2, 2), (8, 2)), ((8, 2), (8, 7)), ((8, 7), (2, 7)), ((2, 7), (2, 2))]
    walls = [{'kind': 'terrain_outline', 'a': {'x': a[0], 'y': a[1]}, 'b': {'x': b[0], 'y': b[1]}} for a, b in box]
    objs, skipped = fy.building_objects(walls, dm, (200, 120), 20, 12)
    assert skipped == 0 and len(objs) == 1
    cells = set(objs[0]['cells'])
    assert '4,4' in cells and '0,0' not in cells and '9,9' not in cells
    assert objs[0]['cover'] == 'total' and objs[0]['blocksMovement'] is True


def test_convert_tokens_uses_token_centre():
    scene = {'grid': {'size': 100}, 'flags': {'ddb': {'tokens': [
        {'name': 'Ogre', 'x': 300, 'y': 200, 'width': 2, 'height': 2, 'disposition': -1,
         'flags': {'ddbActorFlags': {'id': 42}}}]}}}
    ident = np.array([[1.0, 0, 0], [0, 1.0, 0]])
    dm = {'cellPx': 100.0, 'originX': 0.0, 'originY': 0.0}
    sp = fy.convert_tokens(scene, lambda x, y: (x, y), fy.Correction(), ident, dm, 0.9)
    assert sp[0]['cell'] == {'x': 4, 'y': 3} and sp[0]['sizeCells'] == 2
    assert sp[0]['ddbMonsterId'] == 42 and sp[0]['disposition'] == 'hostile'
