"""Phase 3 tests: hotspot classifier, polygon rasterization, overlaps, legacy conversion."""
import polygons as poly
import regions as rg


def test_hotspot_vs_outline():
    hot = [(0, 0), (100, 0), (100, 100), (0, 100)]
    assert poly.classify_polygon(hot, 2550, 37.5) == 'hotspot'
    big = [(0, 0), (400, 0), (400, 300), (0, 300)]
    assert poly.classify_polygon(big, 2550, 37.5) == 'outline'
    five = hot + [(50, 120)]
    assert poly.classify_polygon(five, 2550, 37.5) == 'outline'
    # Scales with the local image width.
    half = [(0, 0), (50, 0), (50, 50), (0, 50)]
    assert poly.classify_polygon(half, 1275, 18.75) == 'hotspot'


def test_split_area_name():
    assert poly.split_area_name('P9. Tavern') == ('P9', 'Tavern')
    assert poly.split_area_name('L01. Turret Cavern') == ('L1', 'Turret Cavern')
    assert poly.split_area_name('Overview') == (None, 'Overview') or poly.split_area_name('Overview')[0] is None


def test_polygon_rasterization_on_square():
    grid = {'originX': 0.0, 'originY': 0.0, 'cellPx': 10.0}
    square = [(20, 20), (50, 20), (50, 40), (20, 40)]
    cov = rg.polygon_coverage(square, (100, 100), grid, 10, 10)
    full = {c for c, v in cov.items() if v >= 0.5}
    assert full == {(x, y) for x in (2, 3, 4) for y in (2, 3)}


def test_overlap_higher_coverage_then_smaller_region_wins():
    a = {(0, 0): 1.0, (1, 0): 0.6, (2, 0): 1.0}
    b = {(1, 0): 0.9}
    out = rg.resolve_overlaps({'A': a, 'B': b})
    assert (1, 0) in out['B'] and (1, 0) not in out['A']
    tie = rg.resolve_overlaps({'A': {(0, 0): 1.0, (1, 0): 1.0}, 'B': {(1, 0): 1.0}})
    assert (1, 0) in tie['B']


def test_legacy_conversion_matches_plan_example():
    legacy_grid = {'cellPitch': 75, 'offsetX': 66, 'offsetY': 35}
    grid = {'originX': 27.5, 'originY': 34.0, 'cellPx': 37.5}
    cells = rg.legacy_to_new_cells(['17,8'], legacy_grid, grid, 67, 43)
    xs = sorted({c[0] for c in cells})
    ys = sorted({c[1] for c in cells})
    assert xs == [35, 36] and ys == [16, 17]


def test_geodesic_nearest_label_respects_walkability():
    walk = lambda x, y: x != 5  # a solid column at x = 5
    out = rg.geodesic_nearest_label({'A': [(2, 2)], 'B': [(8, 2)]}, walk, 10, 5, max_dist=12)
    assert (4, 2) in out['A'] and (6, 2) in out['B'] and (5, 2) not in out['A'] | out['B']


def test_flood_fill_bounded_and_leaky():
    def wall(x1, y1, x2, y2):
        return {'a': {'x': x1, 'y': y1}, 'b': {'x': x2, 'y': y2}, 'blocksMovement': True,
                'provenance': {'confidence': 0.9}}
    box = [wall(1, 1, 4, 1), wall(4, 1, 4, 4), wall(4, 4, 1, 4), wall(1, 4, 1, 1)]
    cells, leaked = rg.flood_fill_region((2, 2), box, 10, 10)
    assert not leaked and cells == {(x, y) for x in (1, 2, 3) for y in (1, 2, 3)}
    cells, leaked = rg.flood_fill_region((2, 2), [], 30, 30, cap=400)
    assert leaked and cells == set()


def test_connected_components_and_centre():
    comps = rg.connected_components({(0, 0), (1, 1), (5, 5)})
    assert sorted(len(c) for c in comps) == [1, 2]
    assert rg.centre_cell({(0, 0), (1, 0), (2, 0)}) == (1, 0)
