"""Shared helpers for the map compiler: paths, manifest, sources, image IO."""
import json
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PUBLIC = os.path.join(ROOT, 'public')
OUT_DIR = os.path.join(PUBLIC, 'data', 'maps')
CACHE = os.path.join(ROOT, 'tools', 'external', 'cache')
SOURCES_JSON = os.path.join(ROOT, 'tools', 'state', 'maps_sources.json')
STATE_DIR = os.path.join(ROOT, 'tools', 'state')  # git-ignored, holds data specific to the user's scrapes
MANIFEST = os.path.join(STATE_DIR, 'maps_manifest.json')
LEGACY_GRIDS = os.path.join(STATE_DIR, 'legacy_map_grids.json')


class MapBuildError(Exception):
    """A plain-text error the DM can read aloud from a screen reader."""


def posmod(a, m):
    return a - m * math.floor(a / m)


def load_manifest():
    if not os.path.exists(MANIFEST):
        raise MapBuildError('tools/state/maps_manifest.json is missing. It lists the maps to compile and is not checked in.')
    with open(MANIFEST, encoding='utf-8') as f:
        return json.load(f)


def load_sources():
    if not os.path.exists(SOURCES_JSON):
        raise MapBuildError('tools/state/maps_sources.json is missing. Run npm run maps:fetch first.')
    with open(SOURCES_JSON, encoding='utf-8') as f:
        return json.load(f)


def cached_path(kind, sources, name):
    key = 'fiveEtools' if kind == '5etools' else 'ddbMeta'
    sha = sources[key]['sha']
    return os.path.join(CACHE, kind, sha[:12], os.path.basename(name))


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def url_to_path(url):
    """'/maps/5.1-palma-flora.png' -> absolute path under public/."""
    return os.path.join(PUBLIC, *url.lstrip('/').split('/'))


def read_image(path, gray=False):
    data = np.fromfile(path, dtype=np.uint8)
    flag = cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR
    img = cv2.imdecode(data, flag)
    if img is None:
        raise MapBuildError(f'Could not read image {path}.')
    return img


def image_size(path):
    img = read_image(path, gray=True)
    h, w = img.shape[:2]
    return w, h
