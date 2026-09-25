"""Phase 3 pipeline: build doc['regions'] from every available source, best first."""
import math
import os

import polygons as poly
from common import cached_path, read_json
from regions import (ADVENTURE_FILES, area_index, area_text_ref, cell_key, centre_cell,
                     flood_fill_region, legacy_to_new_cells, make_region, polygon_coverage,
                     px_to_cell, resolve_overlaps, slugify, sort_cells)


def _legacy_entry(legacy, url):
    return legacy.get(url) or legacy.get(os.path.basename(url))


def _unique(cells):
    seen, out = set(), []
    for c in cells:
        k = (c['x'], c['y'])
        if k not in seen:
            seen.add(k)
            out.append(c)
    return out


def import_regions(mspec, doc, ctx, sources, legacy):
    def audit(level, code, message):
        doc['audit'].append({'level': level, 'code': code, 'message': message})

    variants = ctx['variants']
    dm = variants['dm']
    dg = dm['grid']
    is_hex = dg is None
    columns, rows = doc['grid']['columns'], doc['grid']['rows']
    adv_file = ADVENTURE_FILES[mspec['adventure']]
    idx = area_index(read_json(cached_path('5etools', sources, adv_file)))
    entry = ctx['entries']['dm']
    f = dm['width'] / entry['width']
    if is_hex:
        size = entry['grid']['size']
        cell_px_for_class = size

        def to_cell(px, py):
            return int(math.floor(px / size)), int(math.floor(py / (size * 0.75)))
    else:
        cell_px_for_class = dg['cellPx']

        def to_cell(px, py):
            return px_to_cell(px, py, dg)

    groups = {}
    order = []
    for area, pts in poly.map_regions_px(entry, f):
        node = idx.get(area)
        key, name = poly.split_area_name(node['name']) if node else (None, str(area))
        rid = key or f'R-{slugify(name)}'
        g = groups.get(rid)
        if g is None:
            g = groups[rid] = {'name': name, 'node': node, 'area': area, 'coverage': {}, 'labels': [],
                               'outline': False, 'centroids': []}
            order.append(rid)
        kind = poly.classify_polygon(pts, dm['width'], cell_px_for_class)
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        if kind == 'hotspot' or is_hex:
            g['labels'].append(to_cell(cx, cy))
        else:
            g['outline'] = True
            for c, v in polygon_coverage(pts, (dm['width'], dm['height']), dg, columns, rows).items():
                g['coverage'][c] = max(g['coverage'].get(c, 0.0), v)
            g['centroids'].append(to_cell(cx, cy))

    regions = {}
    covs = {rid: g['coverage'] for rid, g in groups.items() if g['outline'] and g['coverage']}
    resolved = resolve_overlaps(covs)
    for rid in order:
        g = groups[rid]
        text_ref = area_text_ref(adv_file, g['area'], g['node']) if g['node'] else None
        if g['outline']:
            cells = resolved.get(rid, set())
            conf = 0.9
            if cells:
                note = '5etools room outline rasterized at 50% coverage'
            else:
                owned = {c for r_ in resolved.values() for c in r_}
                cells = set(g['centroids']) - owned
                note = 'polygon covers under half of any cell; the centre cell is used'
                conf = 0.5
            labels = g['labels'] or ([centre_cell(cells)] if cells else [])
            regions[rid] = make_region(rid, g['name'], cells, labels, 'polygon', conf, note, text_ref)
        else:
            hex_note = ' (hex position is approximate)' if is_hex else ''
            regions[rid] = make_region(rid, g['name'], set(), g['labels'], 'label-only', 0.3 if is_hex else 0.5,
                                       '5etools badge hotspot; only the label position is known' + hex_note,
                                       text_ref)

    # ddb notes give label points (and regions the polygons did not name).
    for n in ctx.get('labels', []):
        cell = {'x': n['cell']['x'], 'y': n['cell']['y']}
        r = regions.get(n['id'])
        if r is None:
            regions[n['id']] = make_region(n['id'], n['name'], set(), [(cell['x'], cell['y'])], 'label-only',
                                           0.5, 'D&D Beyond map pin; only the label position is known')
            order.append(n['id'])
        else:
            r['labelCells'] = _unique(r['labelCells'] + [cell])

    # Legacy hand-coded extents for label-only regions, or whole regions when nothing else exists.
    leg = _legacy_entry(legacy, dm['url']) if not is_hex else None
    if leg and leg.get('regions'):
        lgrid = {'cellPitch': leg['cellPitch'], 'offsetX': leg['offsetX'], 'offsetY': leg['offsetY']}
        have_external = bool(regions)
        taken = {tuple(int(v) for v in c.split(',')) for r in regions.values() for c in r['cells']}
        # Smaller regions first so they keep their cells where legacy extents overlap.
        for lr in sorted((x for x in leg['regions'] if x['id'] != 'ocean'), key=lambda x: len(x['cells'])):
            cells = legacy_to_new_cells(lr['cells'], lgrid, dg, columns, rows) - taken
            if not cells:
                continue
            if have_external:
                r = regions.get(lr['id'])
                if r is None or r['cells']:
                    continue
                taken |= cells
                r['cells'] = sort_cells(cell_key(x, y) for x, y in cells)
                r['extentMethod'] = 'legacy'
                r['provenance'] = {'source': 'legacy-handcoded', 'confidence': 0.4,
                                   'note': 'extent converted from the earlier hand-coded regions; '
                                           'the name comes from the book'}
            else:
                taken |= cells
                regions[lr['id']] = make_region(lr['id'], lr['name'], cells, [centre_cell(cells)], 'legacy',
                                                0.4, 'converted from the earlier hand-coded regions')
                order.append(lr['id'])

    # Flood-fill fallback for label-only regions when walls were accepted.
    if ctx.get('wallOutcome') in ('identity', 'small-correction', 'resolved') and not is_hex:
        for rid in order:
            r = regions[rid]
            if r['cells'] or not r['labelCells']:
                continue
            lc = r['labelCells'][0]
            cells, leaked = flood_fill_region((lc['x'], lc['y']), doc['walls'], columns, rows)
            cells = cells - {tuple(int(v) for v in c.split(',')) for r_ in regions.values() for c in r_['cells']}
            if leaked:
                audit('info', 'FLOOD_FILL_LEAK',
                      f'Region {rid} {r["name"]} could not be bounded by walls, so only its label position is known.')
            elif cells:
                r['cells'] = sort_cells(cell_key(x, y) for x, y in cells)
                r['extentMethod'] = 'flood-fill'
                r['provenance'] = {'source': 'derived', 'confidence': 0.5,
                                   'note': 'flood fill from the label inside walls'}

    doc['regions'] = [regions[rid] for rid in order if rid in regions]
    methods = {}
    for r in doc['regions']:
        methods[r['extentMethod']] = methods.get(r['extentMethod'], 0) + 1
    if doc['regions']:
        audit('info', 'REGIONS', f'{len(doc["regions"])} regions were built: ' +
              ', '.join(f'{v} by {k}' for k, v in sorted(methods.items())) + '.')
    ctx['regionGroups'] = groups
