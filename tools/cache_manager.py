"""
Cache Import/Export and Offline Regeneration Manager for Crits and Giggles.

This tool manages the archived cache of scraped HTML pages (dnd_beyond/) and
accompanying state files (tools/state/), allowing:
1. Export: Archive the cached HTML pages and state into a compressed archive (.zip or .tar.gz).
2. Import: Extract archive contents into dnd_beyond/ and tools/state/ (preserving and merging
   existing files without wiping), then run the scrapers in offline mode to regenerate
   public/data JSON files.
3. Merge: Merges existing JSON dataset entries when regenerating datasets so prior data
   is preserved rather than wiped clean.
"""

import argparse
import copy
import glob
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DND_BEYOND_DIR = os.path.join(PROJECT_ROOT, 'dnd_beyond')
TOOLS_STATE_DIR = os.path.join(PROJECT_ROOT, 'tools', 'state')
PUBLIC_DATA_DIR = os.path.join(PROJECT_ROOT, 'public', 'data')

CACHE_CATEGORIES = ['monsters', 'spells', 'magic_items', 'adventures', 'egtw']
# Downloaded monster / magic item artwork lives in public/images/ (tools/download_images.py), not dnd_beyond/.
IMAGES_CATEGORY = 'images'
EXPORT_CATEGORIES = CACHE_CATEGORIES + [IMAGES_CATEGORY]

def get_rel_path(abs_path):
    return os.path.relpath(abs_path, PROJECT_ROOT).replace('\\', '/')

def export_cache(output_path, include_state=True, categories=None, base_dir=None):
    """
    Creates a zip or tar archive of the cached HTML pages under dnd_beyond/
    and optionally scraper state under tools/state/.
    """
    root_dir = os.path.abspath(base_dir) if base_dir else PROJECT_ROOT
    output_path = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    is_tar = output_path.endswith('.tar.gz') or output_path.endswith('.tgz') or output_path.endswith('.tar')
    archive_format = 'tar' if is_tar else 'zip'

    target_categories = set(categories) if categories else set(EXPORT_CATEGORIES)

    files_to_pack = []
    dnd_dir = os.path.join(root_dir, 'dnd_beyond')
    state_dir = os.path.join(root_dir, 'tools', 'state')

    # 1. Collect dnd_beyond cache files
    if os.path.exists(dnd_dir):
        for root, _, files in os.walk(dnd_dir):
            for file in files:
                abs_file = os.path.join(root, file)
                rel_file = os.path.relpath(abs_file, root_dir).replace('\\', '/')
                parts = rel_file.split('/')
                # parts[0] == 'dnd_beyond', parts[1] == category
                if len(parts) > 1 and parts[1] not in target_categories:
                    continue
                files_to_pack.append((abs_file, rel_file))

    # 1b. Collect downloaded artwork under public/images/
    images_dir = os.path.join(root_dir, 'public', 'images')
    if IMAGES_CATEGORY in target_categories and os.path.exists(images_dir):
        for root, _, files in os.walk(images_dir):
            for file in files:
                abs_file = os.path.join(root, file)
                rel_file = os.path.relpath(abs_file, root_dir).replace('\\', '/')
                files_to_pack.append((abs_file, rel_file))

    # 2. Collect tools/state files if requested
    if include_state and os.path.exists(state_dir):
        for root, _, files in os.walk(state_dir):
            for file in files:
                abs_file = os.path.join(root, file)
                rel_file = os.path.relpath(abs_file, root_dir).replace('\\', '/')
                files_to_pack.append((abs_file, rel_file))

    if not files_to_pack:
        print(f"Warning: No cache files found to export under {dnd_dir}.")

    print(f"Exporting {len(files_to_pack)} files to {output_path}...")

    if archive_format == 'tar':
        mode = 'w:gz' if (output_path.endswith('.gz') or output_path.endswith('.tgz')) else 'w'
        with tarfile.open(output_path, mode) as tf:
            for abs_file, rel_file in files_to_pack:
                tf.add(abs_file, arcname=rel_file)
    else:
        with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
            for abs_file, rel_file in files_to_pack:
                # Images are already compressed; storing them avoids slow, pointless deflate.
                is_image = rel_file.startswith('public/images/')
                zf.write(abs_file, arcname=rel_file,
                         compress_type=zipfile.ZIP_STORED if is_image else zipfile.ZIP_DEFLATED)

    archive_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Export complete: {output_path} ({archive_size_mb:.2f} MB, {len(files_to_pack)} files).")
    return output_path

def extract_archive(archive_path, target_dir, overwrite=False):
    """
    Extracts an archive into target_dir. If overwrite is False, existing files are preserved.
    """
    archive_path = os.path.abspath(archive_path)
    if not os.path.exists(archive_path):
        raise FileNotFoundError(f"Archive not found: {archive_path}")

    is_tar = tarfile.is_tarfile(archive_path)
    extracted_count = 0
    skipped_count = 0

    if is_tar:
        with tarfile.open(archive_path, 'r:*') as tf:
            for member in tf.getmembers():
                if not member.isfile():
                    continue
                dest_path = os.path.abspath(os.path.join(target_dir, member.name))
                if not dest_path.startswith(os.path.abspath(target_dir)):
                    continue # Zip slip security check
                if os.path.exists(dest_path) and not overwrite:
                    skipped_count += 1
                    continue
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                with tf.extractfile(member) as src_f, open(dest_path, 'wb') as dst_f:
                    shutil.copyfileobj(src_f, dst_f)
                extracted_count += 1
    else:
        with zipfile.ZipFile(archive_path, 'r') as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                dest_path = os.path.abspath(os.path.join(target_dir, info.filename))
                if not dest_path.startswith(os.path.abspath(target_dir)):
                    continue # Zip slip security check
                if os.path.exists(dest_path) and not overwrite:
                    skipped_count += 1
                    continue
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                with zf.open(info) as src_f, open(dest_path, 'wb') as dst_f:
                    shutil.copyfileobj(src_f, dst_f)
                extracted_count += 1

    print(f"Extracted {extracted_count} files ({skipped_count} existing files preserved).")
    return extracted_count

def merge_json_records(existing_data, new_data, key_func=None):
    """
    Merges two JSON structures (lists of dicts, or dicts containing list/assets/spells).
    Preserves all existing records not present in new_data, and updates/adds records from new_data.
    """
    if key_func is None:
        key_func = lambda item: str(item.get('id', item.get('name', '')))

    if isinstance(existing_data, list) and isinstance(new_data, list):
        merged_dict = {}
        for item in existing_data:
            if isinstance(item, dict):
                merged_dict[key_func(item)] = item
            else:
                merged_dict[str(item)] = item
        for item in new_data:
            if isinstance(item, dict):
                merged_dict[key_func(item)] = item
            else:
                merged_dict[str(item)] = item
        return list(merged_dict.values())

    elif isinstance(existing_data, dict) and isinstance(new_data, dict):
        result = copy.deepcopy(existing_data)
        for k, v in new_data.items():
            if k in result and isinstance(result[k], list) and isinstance(v, list):
                result[k] = merge_json_records(result[k], v, key_func=key_func)
            else:
                result[k] = v
        return result

    return new_data

# A --force offline reparse of the full monster cache (~900 pages) takes a few minutes
# on a fast machine; a scraper killed by the timeout leaves a partial JSON file behind.
SCRAPER_TIMEOUT_SECONDS = 1800

def run_scraper_offline(scraper_name, base_dir=None, timeout=SCRAPER_TIMEOUT_SECONDS):
    """
    Executes a scraper script in offline mode (--offline) with proper arguments.
    """
    root_dir = os.path.abspath(base_dir) if base_dir else PROJECT_ROOT
    scraper_path = os.path.join(root_dir, 'tools', scraper_name)
    if not os.path.exists(scraper_path):
        print(f"Error: Scraper script not found: {scraper_path}")
        return False

    cmd = [sys.executable, scraper_path, '--offline']
    if scraper_name in ['monster_scraper.py', 'magic_item_scraper.py', 'spell_scraper.py']:
        cmd.extend(['--force', '--limit', '100000'])
    elif scraper_name == 'world_scraper.py':
        cmd.extend(['--force', '--limit', '1000'])
    elif scraper_name == 'adventure_scraper.py':
        cmd.append('--force')

    print(f"Running: {' '.join(cmd)}")
    try:
        proc = subprocess.run(
            cmd,
            cwd=root_dir,
            capture_output=True,
            # Scrapers print non-ASCII names. With the Windows default (cp1252) the
            # reader thread dies with UnicodeDecodeError, the child's stdout pipe fills,
            # and the scraper hangs on a blocked write until the timeout kills it.
            encoding='utf-8',
            errors='replace',
            timeout=timeout
        )
        if proc.returncode != 0:
            print(f"Error running {scraper_name} (code {proc.returncode}):")
            if proc.stdout:
                print(proc.stdout[-1000:])
            if proc.stderr:
                print(proc.stderr[-1000:])
            return False
        else:
            print(f"Successfully executed {scraper_name}.")
            return True
    except subprocess.TimeoutExpired:
        print(f"Error: {scraper_name} timed out after {timeout} seconds.")
        return False
    except Exception as e:
        print(f"Error executing {scraper_name}: {e}")
        return False

def regenerate_json_files(scrapers=None, base_dir=None):
    """
    Runs the scraper scripts in offline mode to regenerate JSON files,
    performing a non-destructive merge with any existing JSON files.
    """
    root_dir = os.path.abspath(base_dir) if base_dir else PROJECT_ROOT
    data_dir = os.path.join(root_dir, 'public', 'data')
    # public/data is gitignored; make sure it exists before any scraper writes into it.
    os.makedirs(data_dir, exist_ok=True)

    json_targets = {
        'monster_scraper.py': os.path.join(data_dir, 'monsters.json'),
        'spell_scraper.py': os.path.join(data_dir, 'spells.json'),
        'magic_item_scraper.py': os.path.join(data_dir, 'magic_items.json'),
        'world_scraper.py': os.path.join(data_dir, 'scraped_world.json'),
        'adventure_scraper.py': os.path.join(data_dir, 'scraped_campaign.json'),
    }

    scraper_order = [
        'monster_scraper.py',
        'spell_scraper.py',
        'magic_item_scraper.py',
        'world_scraper.py',
        'adventure_scraper.py'
    ]

    selected_scrapers = [s for s in scraper_order if scrapers is None or s in scrapers]

    # Backup existing JSON files for post-run merge verification
    existing_jsons = {}
    for scraper, json_path in json_targets.items():
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    existing_jsons[json_path] = json.load(f)
            except Exception as e:
                print(f"Warning: Could not read existing {json_path}: {e}")

    success_all = True
    for scraper in selected_scrapers:
        json_path = json_targets[scraper]
        pre_existing = existing_jsons.get(json_path)

        print(f"\n--- Regenerating via {scraper} ---")
        ok = run_scraper_offline(scraper, base_dir=root_dir)
        if not ok:
            success_all = False
            continue

        # Perform merge if pre-existing data existed
        if pre_existing and os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    generated_data = json.load(f)

                if scraper == 'world_scraper.py':
                    merged_data = merge_json_records(
                        pre_existing,
                        generated_data,
                        key_func=lambda x: str(x.get('id', x.get('name', '')))
                    )
                elif scraper == 'adventure_scraper.py':
                    merged_data = merge_json_records(
                        pre_existing,
                        generated_data,
                        key_func=lambda x: str(x.get('name', x.get('id', '')))
                    )
                else:
                    merged_data = merge_json_records(
                        pre_existing,
                        generated_data,
                        key_func=lambda x: str(x.get('id', ''))
                    )

                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(merged_data, f, indent=2, ensure_ascii=False)
                print(f"Merged data saved to {json_path}.")
            except Exception as e:
                print(f"Warning: Error while merging {json_path}: {e}")

    return success_all

def import_cache(archive_path, regenerate=True, overwrite=False, scrapers=None, base_dir=None):
    """
    Imports cache from archive, extracting into dnd_beyond/ and tools/state/,
    merging with existing files, and regenerating JSON datasets in offline mode.
    """
    root_dir = os.path.abspath(base_dir) if base_dir else PROJECT_ROOT
    archive_path = os.path.abspath(archive_path)
    if not os.path.exists(archive_path):
        raise FileNotFoundError(f"Archive not found: {archive_path}")

    print(f"Importing cache from {archive_path} into {root_dir}...")
    extracted = extract_archive(archive_path, root_dir, overwrite=overwrite)
    print(f"Extracted {extracted} files into repository structure.")

    if regenerate:
        print("\nRegenerating JSON files using scrapers in offline mode...")
        ok = regenerate_json_files(scrapers=scrapers, base_dir=root_dir)
        if not ok:
            print("Some scrapers failed during regeneration.")
        else:
            print("All JSON files successfully regenerated and merged.")
        return ok

    return True

def main():
    parser = argparse.ArgumentParser(
        description="Import/export scraper HTML cache and regenerate JSON datasets offline."
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Export command
    export_parser = subparsers.add_parser("export", help="Export cached HTML and state to an archive")
    export_parser.add_argument(
        "--output", "-o",
        required=True,
        help="Path to output archive file (.zip or .tar.gz)"
    )
    export_parser.add_argument(
        "--no-state",
        action="store_true",
        help="Exclude tools/state/ files from export"
    )
    export_parser.add_argument(
        "--category", "-c",
        action="append",
        choices=EXPORT_CATEGORIES,
        help="Specific categories to export (can specify multiple). 'images' is the downloaded artwork in public/images/"
    )

    # Import command
    import_parser = subparsers.add_parser("import", help="Import cached HTML from an archive and regenerate JSON")
    import_parser.add_argument(
        "--input", "-i",
        required=True,
        help="Path to input archive file (.zip or .tar.gz)"
    )
    import_parser.add_argument(
        "--no-regenerate",
        action="store_true",
        help="Do not run scrapers to regenerate JSON after extracting"
    )
    import_parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing cache files instead of preserving them"
    )
    import_parser.add_argument(
        "--scraper", "-s",
        action="append",
        help="Specific scrapers to run during regeneration (e.g. monster_scraper.py)"
    )

    # Regenerate command
    regen_parser = subparsers.add_parser("regenerate", help="Run scrapers in offline mode to regenerate/merge JSONs")
    regen_parser.add_argument(
        "--scraper", "-s",
        action="append",
        help="Specific scrapers to run (e.g. monster_scraper.py)"
    )

    args = parser.parse_args()

    if args.command == "export":
        export_cache(
            output_path=args.output,
            include_state=not args.no_state,
            categories=args.category
        )
    elif args.command == "import":
        import_cache(
            archive_path=args.input,
            regenerate=not args.no_regenerate,
            overwrite=args.overwrite,
            scrapers=args.scraper
        )
    elif args.command == "regenerate":
        regenerate_json_files(scrapers=args.scraper)
    else:
        parser.print_help()

if __name__ == '__main__':
    main()
