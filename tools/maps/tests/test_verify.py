"""Phase 5 tests: verification checks on synthetic MapDocuments."""
import verify as vf


def _doc(**kw):
    doc = {'title': 'Map T: Test', 'kind': 'tactical', 'grid': {'columns': 6, 'rows': 4, 'feetPerCell': 5,
                                                              'printedScale': '1 square = 5 feet'},
           'regions': [], 'walls': [], 'objects': [], 'spawns': [], 'audit': []}
    doc.update(kw)
    return doc


def _wall(ax, ay, bx, by, kind='wall'):
    return {'id': 'w', 'a': {'x': ax, 'y': ay}, 'b': {'x': bx, 'y': by}, 'kind': kind, 'blocksMovement': True,
            'blocksSight': 'full', 'cover': 'total', 'provenance': {'source': 'ddb-meta', 'confidence': 0.9}}


def _codes(doc, level=None):
    return [a['code'] for a in doc['audit'] if level is None or a['level'] == level]


def test_strip_tags():
    assert vf.strip_tags('a {@creature sahuagin|MM} and {@dc 15} check') == 'a sahuagin and 15 check'
    assert vf.strip_tags('{@item longsword|phb|a fine sword}') == 'longsword'


def test_door_must_touch_a_wall():
    doc = _doc(walls=[_wall(0, 0, 4, 0), _wall(1.5, 0, 2.5, 0, 'door'), _wall(3, 3, 4, 3, 'door')])
    vf.check_doors(doc)
    assert 'DOOR_FLOATING' in _codes(doc, 'warn')
    good = _doc(walls=[_wall(0, 0, 4, 0), _wall(1.5, 0, 2.5, 0, 'door')])
    vf.check_doors(good)
    assert 'DOORS_ATTACHED' in _codes(good, 'ok')


def test_spawn_on_blocked_and_deep_water():
    layer = {'rows': ['ss#W', 'ssss']}
    doc = _doc(terrain=layer, spawns=[{'cell': {'x': 2, 'y': 0}}, {'cell': {'x': 3, 'y': 0}}])
    vf.check_spawns(doc)
    assert 'SPAWN_BLOCKED' in _codes(doc, 'warn') and 'SPAWN_DEEP_WATER' in _codes(doc, 'info')


def test_label_outside_region_and_overlap_and_split():
    r1 = {'id': 'P1', 'name': 'A', 'cells': ['0,0', '1,0'], 'labelCells': [{'x': 5, 'y': 3}]}
    r2 = {'id': 'P2', 'name': 'B', 'cells': ['1,0', '4,3'], 'labelCells': [{'x': 4, 'y': 3}]}
    doc = _doc(regions=[r1, r2])
    vf.check_labels(doc)
    vf.check_regions(doc)
    assert 'LABEL_OUTSIDE_REGION' in _codes(doc, 'warn')
    assert 'REGIONS_OVERLAP' in _codes(doc, 'warn')
    assert 'REGION_SPLIT' in _codes(doc, 'info')


def test_clean_regions():
    doc = _doc(regions=[{'id': 'P1', 'name': 'A', 'cells': ['0,0', '1,0'], 'labelCells': [{'x': 0, 'y': 0}]}])
    vf.check_labels(doc)
    vf.check_regions(doc)
    assert 'REGIONS_CLEAN' in _codes(doc, 'ok')


def test_object_on_water():
    doc = _doc(terrain={'rows': ['sW']}, objects=[{'kind': 'crate', 'cells': ['1,0']},
                                                   {'kind': 'building', 'cells': ['1,0']}])
    vf.check_objects(doc)
    assert _codes(doc, 'warn') == ['OBJECT_ON_WATER']


def test_expected_feature_questions_use_area_text():
    region = {'id': 'P9', 'name': 'Tavern', 'cells': ['0,0', '1,0'], 'labelCells': [],
              'textRef': {'source': '5etools', 'file': 'x', 'areaId': 'a9'}}
    nodes = {'a9': {'entries': ['The room has {@item tables|phb} and a roaring fire.',
                                {'type': 'entries', 'entries': ['A bridge leads out.']}]}}
    doc = _doc(regions=[region], terrain={'rows': ['ss']},
               audit=[{'level': 'info', 'code': 'OBJECTS_FROM_LEGEND', 'message': ''}])
    vf.check_expected_features(doc, nodes)
    msgs = [a['message'] for a in doc['audit'] if a['code'] == 'EXPECTED_FEATURE_MISSING']
    assert any('P9 Tavern mentions tables' in m and 'tell the assistant' in m for m in msgs)
    assert any('bridge' in m for m in msgs)
    doc2 = _doc(regions=[region], terrain={'rows': ['sp']},
                objects=[{'kind': 'table', 'cells': ['0,0'], 'regionId': 'P9'}],
                audit=[{'level': 'info', 'code': 'OBJECTS_FROM_LEGEND', 'message': ''}])
    vf.check_expected_features(doc2, nodes)
    assert not [a for a in doc2['audit'] if a['code'] == 'EXPECTED_FEATURE_MISSING']


def test_no_object_questions_when_objects_not_attempted():
    region = {'id': 'P9', 'name': 'Tavern', 'cells': ['0,0'], 'labelCells': [],
              'textRef': {'source': '5etools', 'file': 'x', 'areaId': 'a9'}}
    doc = _doc(regions=[region])
    vf.check_expected_features(doc, {'a9': {'entries': ['Tables and chairs.']}})
    assert not doc['audit']


def test_judgment_question_once_per_kind():
    doc = _doc(objects=[{'kind': 'palm_tree', 'cover': 'half', 'cells': ['0,0']},
                        {'kind': 'palm_tree', 'cover': 'half', 'cells': ['1,0']}])
    vf.judgment_questions(doc)
    qs = [a['message'] for a in doc['audit'] if a['level'] == 'question']
    assert qs == ['Palm trees are set to half cover. Keep it, or change to three-quarters cover? '
                  'To change it, tell the assistant "palm trees give three-quarters cover".']


def test_audit_markdown_is_plain_text():
    doc = _doc(audit=[{'level': 'warn', 'code': 'X', 'message': 'Something is off.'},
                      {'level': 'question', 'code': 'Q', 'message': 'Keep it?'}])
    md = vf.audit_markdown(doc)
    assert md.startswith('# Audit for Map T: Test')
    assert '## Warnings' in md and '- Something is off.' in md and '## Questions for you' in md
    assert '|' not in md and '![' not in md
