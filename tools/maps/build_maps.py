"""Map compiler orchestrator.

Turns each battle-map image plus external metadata into a MapDocument JSON file
under public/data/maps/. Phases add steps to `build_map`; every step records what
it did in the document's `audit` list.

Usage:
  python tools/maps/build_maps.py            build all maps
  python tools/maps/build_maps.py --only 5.1 build one map by number
  python tools/maps/build_maps.py --selftest run the unit checks without pytest
"""
import argparse
import datetime
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import grid as gridmod  # noqa: E402
import import_foundry as foundry  # noqa: E402
import phase4  # noqa: E402
import verify  # noqa: E402
from regions import ADVENTURE_FILES, area_index  # noqa: E402
import polygons as poly  # noqa: E402
from regions_pipeline import import_regions  # noqa: E402
import register_images as reg  # noqa: E402
from common import (LEGACY_GRIDS, MapBuildError, OUT_DIR, cached_path, image_size, load_manifest,  # noqa: E402
                    load_sources, read_image, read_json, url_to_path)


def audit(doc, level, code, message):
    doc['audit'].append({'level': level, 'code': code, 'message': message})


def load_map_entries(sources):
    """Merge the map entries of all four adventure files: {basename: entry}."""
    entries = {}
    for name in sources['fiveEtools']['files']:
        adv = read_json(cached_path('5etools', sources, name))
        entries.update(gridmod.find_map_entries(adv))
    return entries


def basename_of(url):
    return os.path.splitext(os.path.basename(url))[0]


def _round(v, n=3):
    return round(float(v), n)


def calibrate(mspec, entries, doc, ctx):
    """Phase 1 steps 1 to 3: per-image grid from 5etools, checked against the manifest."""
    expected = mspec.get('expectedGrid', {})
    variants = {}
    for variant, url in mspec['images'].items():
        path = url_to_path(url)
        width, height = image_size(path)
        entry = entries.get(basename_of(url))
        if entry is None:
            raise MapBuildError(f'{mspec["title"]}: no 5etools entry for image {basename_of(url)}.')
        ctx.setdefault('entries', {})[variant] = entry
        if expected.get('hex'):
            variants[variant] = {'url': url, 'width': width, 'height': height,
                                 'entry': entry, 'grid': None}
            continue
        g = gridmod.entry_grid(entry, width)
        gridmod.check_expected(g, expected[variant], f'{mspec["title"]} ({variant} image)')
        variants[variant] = {'url': url, 'width': width, 'height': height, 'entry': entry, 'grid': g}
        try:
            sx, sy = gridmod.score_image(path, g)
        except Exception as exc:  # scoring is informational only
            audit(doc, 'info', 'GRID_SCORE', f'The {variant} image grid could not be scored: {exc}.')
        else:
            level = 'warn' if min(sx, sy) < 1.2 else 'ok'
            audit(doc, level, 'GRID_SCORE',
                  f'The {variant} image grid lines score {sx:.2f} across and {sy:.2f} down. '
                  'Values near 1.0 would mean the grid does not line up with the drawing.')
    ctx['variants'] = variants


def register(mspec, doc, ctx):
    """Phase 1 steps 4 and 5: DM <-> player registration and the player variant grid."""
    v = ctx['variants']
    dm = v['dm']
    player = v.get('player')
    if player is None or dm['grid'] is None:
        ctx['playerToDm'] = None
        return
    m, ratio, n = reg.register_files(url_to_path(player['url']), url_to_path(dm['url']))
    doc_note = None
    expected_scale = dm['width'] / player['width']
    if m is not None and not reg.transform_plausible(m, expected_scale):
        audit(doc, 'warn', 'REGISTRATION_IMPLAUSIBLE',
              'The automatic match between the player and DM images had an odd rotation or scale, '
              'so it was discarded.')
        m = None
    if m is None or ratio < 0.3:
        # Fallback: assume the images share a frame and trust the 5etools player grid.
        sc = dm['width'] / player['width']
        m = np.array([[sc, 0.0, 0.0], [0.0, sc, 0.0]])
        audit(doc, 'warn', 'REGISTRATION_FALLBACK',
              f'The player image could not be matched to the DM image automatically '
              f'(inlier ratio {ratio:.2f}). The 5etools grid lines were aligned instead.')
        doc_note = f'registration fallback, inlier ratio {ratio:.2f}'
        conf = 0.5
    else:
        conf = 0.9
        scale = reg.affine_scale(m)
        audit(doc, 'ok', 'REGISTRATION',
              f'The player image matches the DM image. Scale {scale:.3f}, shift '
              f'{m[0][2]:.1f} across and {m[1][2]:.1f} down pixels, '
              f'inlier ratio {ratio:.2f} from {n} feature matches.')
        doc_note = f'ORB registration, inlier ratio {ratio:.2f}'
    ctx['playerToDm'] = m
    ctx['registrationNote'] = doc_note
    pgrid, snapped, residual, est_cell = reg.canonical_player_grid(m, dm['grid'], player['grid'])
    if snapped:
        audit(doc, 'warn', 'PLAYER_GRID_SNAPPED',
              f'The player image grid was off by {residual:.2f} cells and was snapped to the printed grid.')
    if abs(est_cell - pgrid['cellPx']) > 0.03 * pgrid['cellPx']:
        audit(doc, 'warn', 'PLAYER_CELL_SIZE',
              f'The registered cell size {est_cell:.1f} pixels differs from the printed grid {pgrid["cellPx"]:.1f}.')
    player['grid'] = {**player['grid'], **pgrid}
    player['confidence'] = conf
    ctx['registrationInlier'] = ratio


def corner_residuals(dm_grid, player_grid, player_to_dm, columns, rows):
    """Largest error, in DM cells, of canonical corner cell centres between variants."""
    worst = 0.0
    for (cx, cy) in ((0, 0), (columns - 1, 0), (0, rows - 1), (columns - 1, rows - 1)):
        px = player_grid['originX'] + (cx + 0.5) * player_grid['cellPx']
        py = player_grid['originY'] + (cy + 0.5) * player_grid['cellPx']
        dx, dy = reg.apply_affine(player_to_dm, px, py)
        ex = dm_grid['originX'] + (cx + 0.5) * dm_grid['cellPx']
        ey = dm_grid['originY'] + (cy + 0.5) * dm_grid['cellPx']
        worst = max(worst, max(abs(dx - ex), abs(dy - ey)) / dm_grid['cellPx'])
    return worst


def import_scene(mspec, doc, ctx, sources):
    """Phase 2: walls, doors, labels, spawns, and building footprints from ddb-meta."""
    ctx['labels'] = []
    ctx['wallOutcome'] = 'none'
    if not mspec.get('ddbScene'):
        return
    variants = ctx['variants']
    player = variants.get('player')
    is_hex = variants['dm']['grid'] is None
    if player is None or (ctx.get('playerToDm') is None and not is_hex):
        return
    scene = read_json(cached_path('ddb-meta', sources, mspec['ddbScene']))
    exp = mspec.get('expect', {})
    p2d = ctx.get('playerToDm')
    dg = variants['dm']['grid']
    to_player = foundry.scene_to_player(scene, player['width'])
    if is_hex:
        # Hex overview: only counts, the ignored-walls note, lights, and label pins matter.
        size = variants['dm']['entry']['grid']['size']
        n_walls = len(scene.get('walls', []))
        if n_walls:
            audit(doc, 'info', 'WALLS_IGNORED',
                  f'The scene has {n_walls} walls, but this is an overview map, so they are ignored.')
        ctx['wallOutcome'] = 'ignored-overview'
        labels = []
        for n in (scene.get('flags', {}).get('ddb', {}).get('notes') or []):
            parsed = foundry.parse_note_label(n.get('label'))
            pos = (n.get('positions') or [None])[0]
            if parsed and pos:
                px, py = to_player(pos['x'], pos['y'])
                labels.append({'id': parsed[0], 'name': parsed[1],
                               'cell': {'x': int(px // size), 'y': int(py // (size * 0.75))}})
        ctx['labels'] = labels
        doc['lights'] = scene.get('lights', [])
        return
    n_walls = len(scene.get('walls', []))
    n_notes = len((scene.get('flags', {}).get('ddb', {}).get('notes')) or [])
    n_tokens = len((scene.get('flags', {}).get('ddb', {}).get('tokens')) or [])
    for what, got, want in (('walls', n_walls, exp.get('ddbWalls')), ('notes', n_notes, exp.get('ddbNotes')),
                            ('tokens', n_tokens, exp.get('ddbTokens'))):
        if want is not None and got != want:
            audit(doc, 'warn', 'SOURCE_COUNT_MISMATCH',
                  f'The scene file has {got} {what} but {want} were expected.')
    identity = foundry.Correction(center=(player['width'] / 2.0, player['height'] / 2.0))
    corr = identity
    overview = mspec['kind'] == 'overview'
    status, conf, note = 'none', 0.3, ''
    if overview:
        if n_walls:
            audit(doc, 'info', 'WALLS_IGNORED',
                  f'The scene has {n_walls} walls, but this is an overview map, so they are ignored.')
            ctx['wallOutcome'] = 'ignored-overview'
    elif n_walls:
        wp = foundry.wall_points_player(scene, to_player)
        pts = foundry.sample_points(wp)
        gray = read_image(url_to_path(player['url']), gray=True)
        E = foundry.edge_map(gray)
        cell_p = player['grid']['cellPx']
        res = foundry.search_registration(E, pts, cell_p)
        dist_map = None
        dm_entry = ctx['entries']['dm']
        if dm_entry.get('mapRegions'):
            f = variants['dm']['width'] / dm_entry['width']
            outlines = [p for (_a, p) in poly.map_regions_px(dm_entry, f)
                        if poly.classify_polygon(p, variants['dm']['width'], dg['cellPx']) == 'outline']
            if outlines:
                d2p = reg.invert_affine(p2d)
                polys_px = [[reg.apply_affine(d2p, x, y) for x, y in pl] for pl in outlines]
                dist_map = foundry.polygon_edge_distance_map(polys_px, E.shape)
        dec = foundry.decide_registration(res, cell_p, dist_map, pts, mspec['title'].split(': ')[-1] + ' walls')
        status, conf, note = dec['status'], dec['confidence'], dec['reason']
        if status in ('accepted', 'resolved'):
            corr = foundry.Correction(dec['k'], dec['dx'], dec['dy'], (player['width'] / 2.0, player['height'] / 2.0))
            audit(doc, 'ok', 'WALLS_REGISTERED', note[0].upper() + note[1:] + '.')
            exact = dec['confidence'] == 0.9
            ctx['wallOutcome'] = ('identity' if exact else 'small-correction') if status == 'accepted' else 'resolved'
        else:
            audit(doc, 'warn', 'WALLS_UNVERIFIED', note)
            ctx['wallOutcome'] = 'ambiguous' if dec.get('ambiguous') else 'unverified'
        ctx['wallDecision'] = dec
        want = exp.get('wallRegistration')
        family = ('ambiguous', 'unverified')
        if want and want != ctx['wallOutcome'] and not (want in family and ctx['wallOutcome'] in family):
            audit(doc, 'info', 'EXPECTATION_DIFFERS',
                  f'Wall registration for this map was expected to be {want} but came out as {ctx["wallOutcome"]}. '
                  'The automatic tie-break was investigated and left as computed.')
        doc['walls'] = foundry.convert_walls(scene, to_player, corr, p2d, dg, conf, note)
        if status in ('accepted', 'resolved'):
            objs, skipped = foundry.building_objects(
                doc['walls'], dg, (variants['dm']['width'], variants['dm']['height']),
                doc['grid']['columns'], doc['grid']['rows'])
            doc['objects'].extend(objs)
            if objs:
                audit(doc, 'info', 'BUILDINGS_FOUND', f'{len(objs)} building footprints were found from roof outlines.')
            if skipped:
                audit(doc, 'info', 'BUILDINGS_SKIPPED',
                      f'{skipped} enclosed areas were too large to be buildings and were skipped.')
    ctx['labels'] = foundry.convert_notes(scene, to_player, corr, p2d, dg)
    if len(ctx['labels']) != n_notes:
        audit(doc, 'warn', 'NOTES_DROPPED',
              f'{n_notes - len(ctx["labels"])} map pins had no readable label or position and were skipped.')
    doc['lights'] = scene.get('lights', [])
    if not overview:
        doc['spawns'] = foundry.convert_tokens(scene, to_player, corr, p2d, dg,
                                               0.9 if status in ('accepted', 'resolved') else 0.5)


def slug_adventure(mspec):
    return mspec['adventure']


def load_legacy():
    # Optional: hand-coded regions from an older scrape, kept in the git-ignored tools/state.
    return read_json(LEGACY_GRIDS) if os.path.exists(LEGACY_GRIDS) else {}


def build_map(mspec, entries, sources, legacy=None, opts=None):
    legacy = legacy if legacy is not None else load_legacy()
    opts = opts if opts is not None else {'vlm': phase4.make_vlm(True), 'backend': 'none'}
    doc = {
        'schemaVersion': 1,
        'mapId': mspec['mapId'],
        'number': mspec['number'],
        'title': mspec['title'],
        'kind': mspec['kind'],
        'source': {'book': 'EGtW', 'adventure': mspec['adventure']},
        'grid': {},
        'images': [],
        'regions': [],
        'walls': [],
        'objects': [],
        'spawns': [],
        'audit': [],
        'generatedAt': None,
        'sourceShas': {'fiveEtools': sources['fiveEtools']['sha'], 'ddbMeta': sources['ddbMeta']['sha']},
    }
    ctx = {}
    calibrate(mspec, entries, doc, ctx)
    variants = ctx['variants']
    dm = variants['dm']

    if mspec.get('expectedGrid', {}).get('hex'):
        size = dm['entry']['grid']['size']
        doc['grid'] = {'type': 'hex', 'columns': int(dm['width'] // size),
                       'rows': int(dm['height'] // (size * 0.75)),
                       'feetPerCell': mspec['feetPerCell'], 'units': 'feet',
                       'printedScale': mspec['printedScale']}
        for name, var in variants.items():
            doc['images'].append({'variant': name, 'url': var['url'], 'width': var['width'],
                                  'height': var['height'], 'cellPx': size, 'originX': 0, 'originY': 0,
                                  'provenance': {'source': '5etools', 'confidence': 0.9,
                                                 'note': 'hex grid, overview map'}})
        audit(doc, 'info', 'OVERVIEW_MAP',
              'This is a hex travel map at one hex per mile. Tactical rules do not apply.')
        import_scene(mspec, doc, ctx, sources)
        import_regions(mspec, doc, ctx, sources, legacy)
        return doc, ctx

    register(mspec, doc, ctx)
    dg = dm['grid']
    columns, rows = gridmod.canonical_size(dm['width'], dm['height'], dg['cellPx'], dg['originX'], dg['originY'])
    doc['grid'] = {'type': 'square', 'columns': columns, 'rows': rows,
                   'feetPerCell': mspec['feetPerCell'], 'units': dg['units'],
                   'printedScale': mspec['printedScale']}
    for name in ('dm', 'player'):
        var = variants.get(name)
        if var is None:
            continue
        g = var['grid']
        if name == 'dm':
            prov = {'source': '5etools', 'confidence': 0.95, 'note': 'grid formula from 5etools map entry'}
        else:
            prov = {'source': '5etools', 'confidence': var.get('confidence', 0.9),
                    'note': ctx.get('registrationNote') or 'grid formula from 5etools map entry'}
        doc['images'].append({'variant': name, 'url': var['url'], 'width': var['width'],
                              'height': var['height'], 'cellPx': _round(g['cellPx']),
                              'originX': _round(g['originX']), 'originY': _round(g['originY']),
                              'provenance': prov})
    if ctx.get('playerToDm') is not None:
        worst = corner_residuals(dg, variants['player']['grid'], ctx['playerToDm'], columns, rows)
        if worst > 0.25:
            audit(doc, 'warn', 'CORNER_RESIDUAL',
                  f'The DM and player grids disagree by up to {worst:.2f} cells at the map corners.')
        else:
            audit(doc, 'ok', 'CORNER_RESIDUAL',
                  f'The DM and player grids agree to within {worst:.2f} cells at the map corners.')
        m = ctx['playerToDm']
        for img in doc['images']:
            if img['variant'] == 'player':
                img['playerToDm'] = [[_round(v, 6) for v in row] for row in m]
                img['registrationInlierRatio'] = _round(ctx.get('registrationInlier', 0.0), 3)
        pg = variants['player']['grid']
        last_x = pg['originX'] + (columns - 0.5) * pg['cellPx']
        last_y = pg['originY'] + (rows - 0.5) * pg['cellPx']
        if last_x > variants['player']['width'] or last_y > variants['player']['height']:
            audit(doc, 'warn', 'PLAYER_GRID_OUT_OF_BOUNDS',
                  'Some of the map grid lies outside the player image. Cells there exist only on the DM image.')
    import_scene(mspec, doc, ctx, sources)
    import_regions(mspec, doc, ctx, sources, legacy)
    phase4.import_terrain_and_objects(mspec, doc, ctx, opts)
    foundry.name_walls(doc)
    return doc, ctx


def area_nodes_for(mspec, sources, cache):
    adv = ADVENTURE_FILES[mspec['adventure']]
    if adv not in cache:
        cache[adv] = area_index(read_json(cached_path('5etools', sources, adv)))
    return cache[adv]


def build_all(only=None, backend='cluster', no_vlm=False):
    manifest = load_manifest()
    sources = load_sources()
    entries = load_map_entries(sources)
    legacy = load_legacy()
    opts = {'vlm': phase4.make_vlm(no_vlm), 'backend': backend}
    area_cache = {}
    os.makedirs(OUT_DIR, exist_ok=True)
    index = {'schemaVersion': 1, 'maps': {}, 'byImage': {}}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    for mspec in manifest['maps']:
        if only and mspec['number'] != only:
            continue
        doc, _ctx = build_map(mspec, entries, sources, legacy, opts)
        doc['generatedAt'] = now
        verify.verify_document(doc, area_nodes_for(mspec, sources, area_cache))
        with open(os.path.join(OUT_DIR, mspec['mapId'] + '.audit.md'), 'w', encoding='utf-8') as f:
            f.write(verify.audit_markdown(doc))
        fname = mspec['mapId'] + '.json'
        with open(os.path.join(OUT_DIR, fname), 'w', encoding='utf-8') as f:
            json.dump(doc, f, indent=1)
            f.write('\n')
        index['maps'][mspec['mapId']] = {'title': mspec['title'], 'file': fname, 'kind': mspec['kind']}
        for url in mspec['images'].values():
            index['byImage'][url] = mspec['mapId']
        print(verify.console_summary(doc))
    if not only:
        with open(os.path.join(OUT_DIR, 'index.json'), 'w', encoding='utf-8') as f:
            json.dump(index, f, indent=1)
            f.write('\n')


def selftest():
    """Run every test_* function in tools/maps/tests without needing pytest."""
    import importlib.util
    import traceback
    tests_dir = os.path.join(HERE, 'tests')
    passed = failed = 0
    for fname in sorted(os.listdir(tests_dir)):
        if not (fname.startswith('test_') and fname.endswith('.py')):
            continue
        spec = importlib.util.spec_from_file_location(fname[:-3], os.path.join(tests_dir, fname))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        for name in sorted(dir(mod)):
            if name.startswith('test_') and callable(getattr(mod, name)):
                try:
                    getattr(mod, name)()
                    passed += 1
                except Exception:
                    failed += 1
                    print(f'FAILED {fname}::{name}')
                    traceback.print_exc()
    print(f'{passed} checks passed, {failed} failed.')
    return 1 if failed else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', help='build only this map number, for example 5.1')
    ap.add_argument('--terrain-backend', choices=['cluster', 'sam3', 'none'], default='cluster')
    ap.add_argument('--no-vlm', action='store_true', help='do not call the vision model')
    ap.add_argument('--selftest', action='store_true', help='run the unit checks and exit')
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()
    try:
        build_all(only=args.only, backend=args.terrain_backend, no_vlm=args.no_vlm)
    except MapBuildError as exc:
        print(f'Map build failed: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
