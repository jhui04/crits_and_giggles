"""Fetch external map data (5etools adventure JSON and ddb-meta scene files).

Downloads are pinned to the current `main` commit SHA of each repo and cached
under tools/external/cache/. Re-running is idempotent: files whose SHA-pinned
copy already exists are skipped. `--offline` reuses the cache without any
network access.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(ROOT, 'tools', 'external', 'cache')
SOURCES_JSON = os.path.join(ROOT, 'tools', 'state', 'maps_sources.json')
MANIFEST = os.path.join(ROOT, 'tools', 'state', 'maps_manifest.json')


def http_get(url, token=None):
    headers = {'User-Agent': 'crits-and-giggles-map-fetch'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def resolve_sha(repo, branch, token):
    data = http_get(f'https://api.github.com/repos/{repo}/commits/{branch}', token)
    return json.loads(data)['sha']


def wanted_files(manifest):
    five = manifest['sources']['fiveEtools']
    ddb = manifest['sources']['ddbMeta']
    five_files = sorted(five['adventureFiles'].values())
    ddb_files = sorted({m['ddbScene'] for m in manifest['maps'] if m.get('ddbScene')})
    return five_files, ddb_files, five, ddb


def cache_path(kind, sha, name):
    # SHA-pinned so a deliberate re-fetch never silently mixes versions.
    return os.path.join(CACHE, kind, sha[:12], os.path.basename(name))


def download(repo, sha, path_in_repo, dest, token):
    if os.path.exists(dest):
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    url = f'https://raw.githubusercontent.com/{repo}/{sha}/{path_in_repo}'
    data = http_get(url, token)
    tmp = dest + '.part'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, dest)
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--offline', action='store_true', help='reuse cache, no network')
    args = ap.parse_args(argv)

    with open(MANIFEST, encoding='utf-8') as f:
        manifest = json.load(f)
    five_files, ddb_files, five, ddb = wanted_files(manifest)

    if args.offline:
        if not os.path.exists(SOURCES_JSON):
            print('Offline mode needs tools/state/maps_sources.json from an earlier fetch.', file=sys.stderr)
            return 1
        sources = json.load(open(SOURCES_JSON, encoding='utf-8'))
        missing = []
        for kind, key, names in (('5etools', 'fiveEtools', five_files), ('ddb-meta', 'ddbMeta', ddb_files)):
            for name in names:
                if not os.path.exists(cache_path(kind, sources[key]['sha'], name)):
                    missing.append(f'{kind}: {os.path.basename(name)}')
        if missing:
            print('The cache is incomplete. Missing files:', file=sys.stderr)
            for m in missing:
                print(m, file=sys.stderr)
            return 1
        print('Offline: using existing cache.')
        return 0

    token = os.environ.get('GITHUB_TOKEN')
    five_sha = resolve_sha(five['repo'], five['branch'], token)
    ddb_sha = resolve_sha(ddb['repo'], ddb['branch'], token)

    downloaded = 0
    for rel in five_files:
        if download(five['repo'], five_sha, rel, cache_path('5etools', five_sha, rel), token):
            downloaded += 1
    for name in ddb_files:
        rel = f"{ddb['sceneDir']}/{name}"
        if download(ddb['repo'], ddb_sha, rel, cache_path('ddb-meta', ddb_sha, name), token):
            downloaded += 1

    sources = {
        'fiveEtools': {'repo': five['repo'], 'sha': five_sha, 'files': five_files},
        'ddbMeta': {'repo': ddb['repo'], 'sha': ddb_sha, 'files': ddb_files},
    }
    os.makedirs(os.path.dirname(SOURCES_JSON), exist_ok=True)
    with open(SOURCES_JSON, 'w', encoding='utf-8') as f:
        json.dump(sources, f, indent=2)
        f.write('\n')
    total = len(five_files) + len(ddb_files)
    print(f'Fetched {downloaded} new files; {total} files are in the cache.')
    print(f'5etools SHA {five_sha[:12]}, ddb-meta SHA {ddb_sha[:12]}.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (urllib.error.URLError, OSError) as exc:
        print(f'Fetching map sources failed: {exc}. Try again, or set GITHUB_TOKEN if rate limited.', file=sys.stderr)
        sys.exit(1)
