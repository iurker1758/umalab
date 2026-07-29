# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "apsw-sqlite3mc>=3.50",
#     "UnityPy>=1.23",
# ]
# ///
"""Extract the game's favorite-mark icons from a local Uma Musume (Global) client.

The 15 favorite marks (carrot, cakes, card suits, running shoes, ...) exist
only as sprites inside the game's UI atlas bundles — they are not on any CDN
or fan site — so they are pulled from your own installed client, the same
legal posture as the fetched character icons (DECISIONS.md #10): local only,
gitignored, never committed.

Reads (never writes) the client files under
%USERPROFILE%/AppData/LocalLow/Cygames/Umamusume: the encrypted `meta` asset
index locates the `atlas/common/common_tex` bundle in dat/, the bundle is
decrypted in memory, and the `utx_ico_favorite_03_01..15` sprites are saved to
frontend/public/icons/marks/mark_01.png .. mark_15.png plus an index.json
listing the ids in game order. Sprite _00 is skipped — it is the game's
greyed-out "no mark set" state, which the app expresses as "no tag".

Keys and the meta/bundle decryption scheme are adapted from
Vali-98/umamusu-utils (MIT): umamusu/shared.py (meta DB key derivation) and
umamusu/assets/dump.py (asset-bundle XOR layer). Credited in README.md.

Usage (one-time, dev machine with the Global client installed):
    uv run scripts/extract_fav_icons.py
or from any venv that has the two inline deps installed:
    python scripts/extract_fav_icons.py

Idempotent: output files are rewritten atomically on every run.
"""
import argparse
import json
import os
import struct
from io import BytesIO
from pathlib import Path

import apsw
import UnityPy

BACKEND_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BACKEND_DIR.parent / "frontend" / "public" / "icons" / "marks"

ATLAS_NAME = "atlas/common/common_tex"
SPRITE_PREFIX = "utx_ico_favorite_03_"
MARK_NUMBERS = range(1, 16)  # _00 is the "unset" state, not an assignable mark

# Global-client meta DB key material (umamusu-utils shared.py): the 33-byte
# key is XORed bytewise with the first 13 bytes of the base key, then handed
# to SQLite3MultipleCiphers as a hex key.
META_DB_KEY = bytes([
    0x36, 0x23, 0x6B, 0x4C, 0x2A, 0x39,
    0x21, 0x75, 0x52, 0x26, 0x32, 0x76,
    0x25, 0x50, 0x3F, 0x35, 0x5D, 0x77,
    0x58, 0x6D, 0x40, 0x71, 0x38, 0x5E,
    0x4C, 0x31, 0x28, 0x74, 0x29, 0x59,
    0x37, 0x24, 0x53,
])
META_DB_BASE_KEY = bytes([
    0xF1, 0x70, 0xCE, 0xA4, 0xDF, 0xCE, 0xA3, 0xE1,
    0xA5, 0xD8, 0xC7, 0x0B, 0xD1,
])

# Asset bundles are XOR-encrypted past a 256-byte plaintext header; the pad is
# the 11-byte base key expanded against the bundle's per-row key `e` from meta
# (umamusu-utils dump.py).
BUNDLE_BASE_KEY = bytes([0x53, 0x2B, 0x46, 0x31, 0xE4, 0xA7, 0xB9, 0x47, 0x3E, 0x7C, 0xFB])
BUNDLE_HEADER_SIZE = 256


def default_game_dir() -> Path | None:
    profile = os.environ.get("USERPROFILE")
    if profile is None:
        return None  # non-Windows — --game-dir is required
    return Path(profile) / "AppData" / "LocalLow" / "Cygames" / "Umamusume"


def open_meta(meta_path: Path) -> apsw.Connection:
    conn = apsw.Connection(str(meta_path), flags=apsw.SQLITE_OPEN_READONLY)
    final_key = bytes(
        META_DB_KEY[i] ^ META_DB_BASE_KEY[i % 13] for i in range(len(META_DB_KEY))
    )
    conn.pragma("hexkey", final_key.hex())
    return conn


def decrypt_bundle(data: bytes, row_key: int) -> bytes:
    key_bytes = struct.pack("<Q", row_key & 0xFFFFFFFFFFFFFFFF)
    pad = bytes(b ^ key_bytes[j] for b in BUNDLE_BASE_KEY for j in range(8))
    out = bytearray(data)
    for i in range(BUNDLE_HEADER_SIZE, len(out)):
        out[i] ^= pad[i % len(pad)]
    return bytes(out)


def atomic_write_bytes(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--game-dir",
        type=Path,
        default=None,
        help="Uma Musume data dir with `meta` and `dat/` (default: the Global LocalLow dir)",
    )
    args = parser.parse_args()
    game_dir: Path | None = args.game_dir or default_game_dir()
    if game_dir is None:
        raise SystemExit("no default game dir on this OS — pass --game-dir")

    meta_path = game_dir / "meta"
    if not meta_path.exists():
        raise SystemExit(
            f"meta not found at {meta_path} — is the Global client installed? "
            "(--game-dir to override)"
        )

    cur = open_meta(meta_path).cursor()
    row = next(iter(cur.execute("SELECT h, e FROM a WHERE n = ?", (ATLAS_NAME,))), None)
    if row is None:
        raise SystemExit(f"{ATLAS_NAME} not present in meta — game update may have moved it")
    bundle_hash, row_key = row
    bundle_path = game_dir / "dat" / bundle_hash[:2] / bundle_hash
    if not bundle_path.exists():
        raise SystemExit(
            f"bundle {bundle_path} not on disk — open the game once so it downloads "
            "the UI atlas"
        )

    env = UnityPy.load(BytesIO(decrypt_bundle(bundle_path.read_bytes(), row_key)))
    sprites = {
        obj.read().m_Name: obj
        for obj in env.objects
        if obj.type.name == "Sprite"
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ids: list[str] = []
    missing: list[str] = []
    for n in MARK_NUMBERS:
        sprite_name = f"{SPRITE_PREFIX}{n:02d}"
        mark_id = f"mark_{n:02d}"
        obj = sprites.get(sprite_name)
        if obj is None:
            missing.append(sprite_name)
            continue
        image = obj.read().image
        buf = BytesIO()
        image.save(buf, format="PNG")
        atomic_write_bytes(OUT_DIR / f"{mark_id}.png", buf.getvalue())
        ids.append(mark_id)

    atomic_write_bytes(
        OUT_DIR / "index.json",
        (json.dumps(ids, indent=2) + "\n").encode("utf-8"),
    )
    print(f"marks: {len(ids)} extracted -> {OUT_DIR}")
    if missing:
        print(f"WARNING: sprites not found in {ATLAS_NAME}: {', '.join(missing)}")
        print("(game update may have renamed them — rerun discovery against the atlas)")


if __name__ == "__main__":
    main()
