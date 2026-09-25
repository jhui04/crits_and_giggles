"""Phase 4 driver: terrain layer, terrain-aware regions, and objects for tactical maps."""
import objects
import terrain as tr
import regions as rg
import vlm as vlmmod
from common import read_image, url_to_path


def _audit(doc, level, code, message):
    doc['audit'].append({'level': level, 'code': code, 'message': message})


def _region_cells(r):
    return [tuple(int(v) for v in c.split(',')) for c in r['cells']]


def reassign_regions_by_label(doc):
    """Geodesic nearest-label extents for 5etools label-only regions once terrain exists."""
    layer = doc.get('terrain')
    if not layer:
        return 0
    rows = layer['rows']
    columns, nrows = doc['grid']['columns'], doc['grid']['rows']
    blocked = {'#', 'B', '^'}

    def walkable(x, y):
        return rows[y][x] not in blocked

    targets = [r for r in doc['regions']
               if r['extentMethod'] in ('legacy', 'label-only') and r.get('textRef') and r['labelCells']]
    if not targets:
        return 0
    labels = {r['id']: [(c['x'], c['y']) for c in r['labelCells']] for r in targets}
    # Cells owned by regions that keep their own extent stay out of the search.
    fixed = {c for r in doc['regions'] if r not in targets for c in _region_cells(r)}
    out = rg.geodesic_nearest_label(labels, lambda x, y: walkable(x, y) and (x, y) not in fixed,
                                    columns, nrows, max_dist=12)
    changed = 0
    for r in targets:
        cells = out.get(r['id'], set())
        if not cells:
            continue
        r['cells'] = rg.sort_cells(rg.cell_key(x, y) for x, y in cells)
        r['extentMethod'] = 'nearest-label'
        r['provenance'] = {'source': 'derived', 'confidence': 0.6,
                           'note': 'cells nearest to the label by walking distance over known terrain'}
        changed += 1
    return changed


def build_terrain_layer(mspec, doc, ctx, opts):
    import register_images as reg
    variants = ctx['variants']
    dm = variants['dm']
    dg = dm['grid']
    columns, rows = doc['grid']['columns'], doc['grid']['rows']
    img = read_image(url_to_path(dm['url']))
    box_dm = None
    legend = mspec.get('legend')
    if legend and ctx.get('playerToDm') is not None:
        box_dm = tr.transform_box(legend['approxBox'], ctx['playerToDm'])
    legend_names = [r[0] for r in legend['rows']] if legend else []
    building = [tuple(int(v) for v in c.split(',')) for o in doc['objects'] if o['kind'] == 'building'
                for c in o['cells']]
    unreachable = []
    if (ctx.get('wallOutcome') in ('identity', 'small-correction', 'resolved')
            and not any(w['kind'] == 'terrain_outline' for w in doc['walls'])):
        starts = {c for r in doc['regions'] for c in _region_cells(r)}
        if starts:
            reach = tr.reachable_cells(starts, doc['walls'], columns, rows)
            unreachable = [(x, y) for y in range(rows) for x in range(columns) if (x, y) not in reach]
    vlm = opts['vlm']
    layer, info = tr.build_terrain(img, dg, columns, rows, mspec.get('terrainK', 8), vlm,
                                   legend_names, box_dm, building, unreachable, opts.get('backend', 'cluster'),
                                   mspec['title'])
    total = info['total']
    known_pct = round(100.0 * info['known'] / total)
    if opts.get('backend') == 'sam3':
        _audit(doc, 'warn', 'SAM3_UNAVAILABLE',
               'The sam3 terrain backend is not installed, so the colour-cluster backend was used instead.')
    if vlm.enabled and info['known'] > 0 and any(c != 'unknown' for c, _ in info['clusters'].values()):
        note = f'colour clusters named by {vlm.model}; {len(info["clusters"])} clusters'
        source, conf = 'vision', round(max(0.3, info['meanConfidence']), 2)
        _audit(doc, 'info', 'TERRAIN',
               f'Terrain was classified automatically. {known_pct} percent of cells got a named ground type.')
    else:
        note = 'no vision model was available; clusters are unnamed'
        source, conf = 'derived', 0.1
        _audit(doc, 'warn', 'TERRAIN_UNNAMED',
               'Terrain clusters could not be named because no vision model answered. Cells are marked unknown.')
    layer['provenance'] = {'source': source, 'confidence': conf, 'note': note}
    doc['terrain'] = layer
    n = reassign_regions_by_label(doc) if info['known'] > 0.5 * total else 0
    if n:
        _audit(doc, 'info', 'REGIONS_BY_LABEL',
               f'{n} regions were re-measured as the cells nearest each label over walkable terrain.')
    ctx['terrainInfo'] = info


def import_terrain_and_objects(mspec, doc, ctx, opts):
    if mspec['kind'] != 'tactical':
        return
    if opts.get('backend') != 'none':
        build_terrain_layer(mspec, doc, ctx, opts)
    objects.import_objects(mspec, doc, ctx, opts)


def make_vlm(no_vlm):
    return vlmmod.VLM(enabled=not no_vlm)
