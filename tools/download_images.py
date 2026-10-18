"""Download monster and magic item artwork referenced by `image_url` in public/data/*.json.

Run `python tools/cache_manager.py regenerate` (offline, no web requests) first so the JSON has `image_url`.
This script then makes plain HTTP requests to the public D&D Beyond image CDN (no login or Chrome needed),
saves files to public/images/<kind>/<id>.<ext> (gitignored), and writes the local `image` path into the JSON.
Already-downloaded files are skipped, so it is safe to re-run or stop with Ctrl+C.

Usage: python tools/download_images.py [--kind monsters|magic-items] [--limit N] [--delay SECONDS]
"""
import argparse
import json
import os
import random
import sys
import time

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from scraper_base import ROOT_DIR, attach_image, local_image_path

TARGETS = {
    "monsters": os.path.join(ROOT_DIR, "public", "data", "monsters.json"),
    "magic-items": os.path.join(ROOT_DIR, "public", "data", "magic_items.json"),
}


def process(kind, path, limit, delay):
    with open(path, 'r', encoding='utf-8') as f:
        assets = json.load(f)

    downloaded = 0
    try:
        for asset in assets:
            if not asset.get('image_url') or 'duplicate_of' in asset:
                continue
            _, disk_path = local_image_path(kind, asset['id'], asset['image_url'])
            needs_download = not (os.path.exists(disk_path) and os.path.getsize(disk_path) > 0)
            if needs_download and downloaded >= limit:
                continue
            attach_image(asset, kind, download=needs_download)
            if needs_download:
                downloaded += 1
                time.sleep(delay * random.uniform(0.5, 1.5))
    except KeyboardInterrupt:
        print("Interrupted; saving progress.")

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(assets, f, indent=2)
    with_image = sum(1 for a in assets if a.get('image'))
    print(f"{kind}: downloaded {downloaded} this run, {with_image} entries now have a local image.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--kind', choices=list(TARGETS), help='Only process one asset type')
    parser.add_argument('--limit', type=int, default=100000, help='Maximum number of new images to download this run')
    parser.add_argument('--delay', type=float, default=0.5, help='Average seconds to wait between downloads')
    args = parser.parse_args()

    for kind, path in TARGETS.items():
        if args.kind and args.kind != kind:
            continue
        process(kind, path, args.limit, args.delay)


if __name__ == "__main__":
    main()
