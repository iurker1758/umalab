"""Regenerate app/data/cards.json from uma.moe's resources endpoints.

Joins character.json.gz (card_id-keyed Global roster) with
character_names.json.gz (chara_id -> {name, skins}) into
card_id -> {chara_id, name, outfit}. The output is committed; rerun this
manually when the game adds characters (DECISIONS.md #6).

Usage:
    python scripts/build_reference_data.py --api-key-file <path>
    # or set UMA_MOE_API_KEY

Needs a uma.moe API key (sent as X-API-Key; anonymous requests get 403).
Also prints the manifest's artifact list, flagging any skill/factor artifact —
a future hook for regenerating factor_names.json from the same source.
"""
import argparse
import gzip
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any, cast

BASE_URL = "https://uma.moe/resources"
OUT_FILE = Path(__file__).resolve().parent.parent / "app" / "data" / "cards.json"


def fetch(url: str, api_key: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"X-API-Key": api_key, "User-Agent": "Mozilla/5.0 (UmaLab reference builder)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def fetch_json(url: str, api_key: str) -> Any:
    raw = fetch(url, api_key)
    if raw[:2] == b"\x1f\x8b":  # the CDN sometimes serves .gz paths pre-decompressed
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def load_api_key(args: argparse.Namespace) -> str:
    if args.api_key_file:
        return Path(args.api_key_file).read_text(encoding="utf-8").strip()
    key = os.environ.get("UMA_MOE_API_KEY", "").strip()
    if not key:
        sys.exit("No API key: pass --api-key-file or set UMA_MOE_API_KEY")
    return key


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-key-file", help="path to a file holding the uma.moe API key")
    api_key = load_api_key(parser.parse_args())

    manifest = fetch_json(f"{BASE_URL}/manifest.json", api_key)
    print(f"manifest version: {manifest.get('version')}")
    print("artifacts:")
    for artifact in manifest.get("files", manifest.get("artifacts", [])):
        name = artifact if isinstance(artifact, str) else artifact.get("name", str(artifact))
        flag = "  <-- possible factor-names source" if any(
            token in str(name).lower() for token in ("skill", "factor")
        ) else ""
        print(f"  {name}{flag}")

    characters_raw = fetch_json(f"{BASE_URL}/current/character.json.gz", api_key)
    names = cast(
        "dict[str, dict[str, Any]]",
        fetch_json(f"{BASE_URL}/current/character_names.json.gz", api_key),
    )

    if isinstance(characters_raw, dict):  # tolerate either shape: card_id-keyed dict or list
        characters_raw = list(cast("dict[str, Any]", characters_raw).values())
    characters = cast("list[dict[str, Any]]", characters_raw)

    cards: dict[str, dict[str, Any]] = {}
    for char in characters:
        card_id = int(cast(int, char["id"]))
        card_id_str = str(card_id)
        chara_id = card_id % 1_000_000 // 100 if card_id > 999_999 else card_id // 100
        entry = names.get(str(chara_id), {})
        skins = cast("dict[str, str]", entry.get("skins") or {})
        skin_key = f"{card_id % 100:02d}"
        cards[card_id_str] = {
            "chara_id": chara_id,
            "name": entry.get("name") or char.get("name") or f"Card {card_id}",
            "outfit": skins.get(skin_key, ""),
        }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(cards, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(cards)} cards -> {OUT_FILE}")


if __name__ == "__main__":
    main()
