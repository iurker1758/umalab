"""Regenerate app/data/{cards,factors}.json from uma.moe's resources endpoints.

cards.json: joins character.json.gz (card_id-keyed Global roster) with
character_names.json.gz (chara_id -> {name, skins}) into
card_id -> {chara_id, name, outfit}.

factors.json: from factors.json.gz — the game's own factor names
(Global master.mdb text_data category 147), reshaped to
key -> {name, type} where key = uma.moe id // 10 (= factor_id // 100 in a
dump record). Types: 0 blue, 1 pink, 2 race, 3 white skill, 4 scenario,
5 unique, -1 other.

Both outputs are committed; rerun this manually when the game updates
(DECISIONS.md #6).

Usage:
    python scripts/build_reference_data.py
    # key comes from UMA_MOE_API_KEY in backend/.env (or the env var,
    # or --api-key-file <path>)

Needs a uma.moe API key (sent as X-API-Key; anonymous requests get 403).
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
DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"


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
    """Key sources, highest precedence first: --api-key-file, the
    UMA_MOE_API_KEY env var, then backend/.env (the usual home)."""
    if args.api_key_file:
        return Path(args.api_key_file).read_text(encoding="utf-8").strip()
    key = os.environ.get("UMA_MOE_API_KEY", "").strip()
    if key:
        return key
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "UMA_MOE_API_KEY":
                key = value.strip().strip("'\"")
                if key:
                    return key
    sys.exit("No API key: set UMA_MOE_API_KEY in backend/.env or pass --api-key-file")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-key-file", help="path to a file holding the uma.moe API key")
    api_key = load_api_key(parser.parse_args())

    manifest = fetch_json(f"{BASE_URL}/manifest.json", api_key)
    print(f"manifest version: {manifest.get('version')}")

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

    raw_factors = cast(
        "list[dict[str, Any]]", fetch_json(f"{BASE_URL}/current/factors.json.gz", api_key)
    )
    factors = {
        str(int(cast(str, f["id"])) // 10): {"name": f["text"], "type": f["type"]}
        for f in raw_factors
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for filename, payload in (("cards.json", cards), ("factors.json", factors)):
        out = DATA_DIR / filename
        out.write_text(
            json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {len(payload)} entries -> {out}")


if __name__ == "__main__":
    main()
