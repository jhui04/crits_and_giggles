"""
Unit and integration tests for tools/cache_manager.py
"""

import json
import os
import shutil
import tempfile
import pytest
import zipfile
import tarfile
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.cache_manager import (
    export_cache,
    extract_archive,
    merge_json_records,
    import_cache,
    CACHE_CATEGORIES
)

def test_merge_json_records_list():
    existing = [
        {"id": "1", "name": "Goblin", "hp": 7},
        {"id": "2", "name": "Orc", "hp": 15}
    ]
    new_data = [
        {"id": "2", "name": "Orc", "hp": 18},
        {"id": "3", "name": "Dragon", "hp": 200}
    ]
    merged = merge_json_records(existing, new_data)
    assert len(merged) == 3
    id_map = {item["id"]: item for item in merged}
    assert id_map["1"]["hp"] == 7
    assert id_map["2"]["hp"] == 18
    assert id_map["3"]["hp"] == 200

def test_merge_json_records_dict():
    existing = {
        "id": "world-1",
        "name": "Wildemount",
        "assets": [
            {"id": "1", "name": "Zadash"},
            {"id": "2", "name": "Rexxentrum"}
        ]
    }
    new_data = {
        "id": "world-1",
        "name": "Wildemount",
        "assets": [
            {"id": "2", "name": "Rexxentrum Prime"},
            {"id": "3", "name": "Nicodranas"}
        ]
    }
    merged = merge_json_records(existing, new_data)
    assert merged["id"] == "world-1"
    assert len(merged["assets"]) == 3
    names = {a["id"]: a["name"] for a in merged["assets"]}
    assert names["1"] == "Zadash"
    assert names["2"] == "Rexxentrum Prime"
    assert names["3"] == "Nicodranas"

def test_export_and_extract_roundtrip():
    with tempfile.TemporaryDirectory() as tmpdir:
        fake_repo = os.path.join(tmpdir, "repo")
        os.makedirs(os.path.join(fake_repo, "dnd_beyond", "monsters"))
        os.makedirs(os.path.join(fake_repo, "tools", "state"))

        sample_monster = os.path.join(fake_repo, "dnd_beyond", "monsters", "page1.html")
        with open(sample_monster, "w", encoding="utf-8") as f:
            f.write("<html>Monster Page 1</html>")

        sample_state = os.path.join(fake_repo, "tools", "state", "monster_scraper_state.json")
        with open(sample_state, "w", encoding="utf-8") as f:
            f.write(json.dumps({"last_page": 1}))

        archive_path = os.path.join(tmpdir, "export.zip")
        export_cache(archive_path, base_dir=fake_repo)
        assert os.path.exists(archive_path)

        # Extract to a fresh directory
        target_repo = os.path.join(tmpdir, "extracted_repo")
        extracted_count = extract_archive(archive_path, target_repo)
        assert extracted_count == 2
        assert os.path.exists(os.path.join(target_repo, "dnd_beyond", "monsters", "page1.html"))
        assert os.path.exists(os.path.join(target_repo, "tools", "state", "monster_scraper_state.json"))

def test_extract_archive_preserves_existing():
    with tempfile.TemporaryDirectory() as tmpdir:
        archive_path = os.path.join(tmpdir, "test_cache.zip")
        with zipfile.ZipFile(archive_path, "w") as zf:
            zf.writestr("dnd_beyond/monsters/test.html", "<html>NEW</html>")
            zf.writestr("dnd_beyond/monsters/extra.html", "<html>EXTRA</html>")

        target_dir = os.path.join(tmpdir, "target")
        existing_file = os.path.join(target_dir, "dnd_beyond/monsters/test.html")
        os.makedirs(os.path.dirname(existing_file), exist_ok=True)
        with open(existing_file, "w", encoding="utf-8") as f:
            f.write("<html>ORIGINAL</html>")

        extract_archive(archive_path, target_dir, overwrite=False)
        with open(existing_file, "r", encoding="utf-8") as f:
            assert f.read() == "<html>ORIGINAL</html>"

        extra_file = os.path.join(target_dir, "dnd_beyond/monsters/extra.html")
        assert os.path.exists(extra_file)
        with open(extra_file, "r", encoding="utf-8") as f:
            assert f.read() == "<html>EXTRA</html>"

def test_extract_archive_tar_gz():
    with tempfile.TemporaryDirectory() as tmpdir:
        archive_path = os.path.join(tmpdir, "test_cache.tar.gz")
        with tarfile.open(archive_path, "w:gz") as tf:
            sample_content = b"<html>CONTENT</html>"
            info = tarfile.TarInfo(name="dnd_beyond/spells/spell1.html")
            info.size = len(sample_content)
            import io
            tf.addfile(info, io.BytesIO(sample_content))

        target_dir = os.path.join(tmpdir, "target")
        extract_archive(archive_path, target_dir, overwrite=False)
        extracted_file = os.path.join(target_dir, "dnd_beyond/spells/spell1.html")
        assert os.path.exists(extracted_file)
        with open(extracted_file, "rb") as f:
            assert f.read() == sample_content


def test_export_and_import_include_images():
    with tempfile.TemporaryDirectory() as tmpdir:
        fake_repo = os.path.join(tmpdir, "repo")
        os.makedirs(os.path.join(fake_repo, "dnd_beyond", "monsters"))
        os.makedirs(os.path.join(fake_repo, "public", "images", "monsters"))
        with open(os.path.join(fake_repo, "dnd_beyond", "monsters", "page1.html"), "w", encoding="utf-8") as f:
            f.write("<html>Monster Page 1</html>")
        image_bytes = b"fake png image bytes"
        with open(os.path.join(fake_repo, "public", "images", "monsters", "1.png"), "wb") as f:
            f.write(image_bytes)

        archive_path = os.path.join(tmpdir, "export.zip")
        export_cache(archive_path, base_dir=fake_repo)
        with zipfile.ZipFile(archive_path) as zf:
            assert "public/images/monsters/1.png" in zf.namelist()

        # Restricting categories must exclude images unless requested
        html_only = os.path.join(tmpdir, "html_only.zip")
        export_cache(html_only, categories=["monsters"], base_dir=fake_repo)
        with zipfile.ZipFile(html_only) as zf:
            assert "public/images/monsters/1.png" not in zf.namelist()

        target_repo = os.path.join(tmpdir, "target")
        import_cache(archive_path, regenerate=False, base_dir=target_repo)
        with open(os.path.join(target_repo, "public", "images", "monsters", "1.png"), "rb") as f:
            assert f.read() == image_bytes
