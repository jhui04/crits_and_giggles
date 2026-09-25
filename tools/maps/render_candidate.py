"""Draw an extraction result (extract.py) over the map so it can be inspected. Writes candidate.jpg next to candidate.json.
Usage: python tools/maps/render_candidate.py 5.1 A"""
import json
import os
import sys

import cv2

from common import read_image, url_to_path
from extract import TERRAIN_CHARS
from judge import JUDGE_DIR, TERRAIN_COLORS, load_doc, put_label, write_img


def main(number, tag):
    doc, _ = load_doc(number)
    im = next(i for i in doc['images'] if i['variant'] == 'dm')
    img = read_image(url_to_path(im['url']))
    cp, ox, oy = im['cellPx'], im['originX'], im['originY']
    wd = os.path.join(JUDGE_DIR, doc['mapId'], 'extract', tag)
    with open(os.path.join(wd, 'candidate.json'), encoding='utf-8') as f:
        cand = json.load(f)
    char_cls = {v: k for k, v in TERRAIN_CHARS.items()}
    tint = img.copy()
    for y, row in enumerate(cand.get('terrainRows', [])):
        for x, ch in enumerate(row):
            cls = char_cls[ch]
            if cls != 'void':
                x0, y0 = int(ox + x * cp), int(oy + y * cp)
                cv2.rectangle(tint, (x0, y0), (int(x0 + cp), int(y0 + cp)), TERRAIN_COLORS[cls], -1)
    out = cv2.addWeighted(tint, 0.4, img, 0.6, 0)
    for w in cand.get('walls', []):
        pts = [(int(ox + p[0] * cp), int(oy + p[1] * cp)) for p in w['points']]
        for a, b in zip(pts, pts[1:] + ([pts[0]] if w['closed'] else [])):
            cv2.line(out, a, b, (0, 0, 255), 3)
    for o in cand.get('objects', []):
        x0, y0, x1, y1 = o['box']
        cv2.rectangle(out, (int(ox + x0 * cp), int(oy + y0 * cp)), (int(ox + (x1 + 1) * cp), int(oy + (y1 + 1) * cp)), (255, 0, 255), 2)
        put_label(out, o['kind'][:10], (int(ox + x0 * cp), int(oy + y0 * cp) - 3), (255, 0, 255), 0.45)
    write_img(os.path.join(wd, 'candidate.jpg'), out)
    print('Wrote', os.path.join(wd, 'candidate.jpg'))


if __name__ == '__main__':
    main(*sys.argv[1:3])
