"""Fetch character icons for every card in app/data/cards.json.

Downloads the in-game 128x128 veteran-list icon per card_id into
frontend/public/icons/chara/ and writes an index.json mapping
card_id -> filename (so the frontend never guesses file extensions).

Sources (no auth): uma.moe's frontend assets, falling back to GameTora's
thumbnails for any miss. The output directory is gitignored — game art is
fetched locally, never committed (DECISIONS.md #10).

Usage:
    python scripts/fetch_icons.py

Idempotent: existing files are skipped; rerun after regenerating cards.json.
"""
import json
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
CARDS_FILE = BACKEND_DIR / "app" / "data" / "cards.json"
OUT_DIR = BACKEND_DIR.parent / "frontend" / "public" / "icons" / "chara"

UMA_MOE_URL = "https://uma.moe/assets/images/character_stand/chara_stand_{card_id}.webp"
GAMETORA_URL = (
    "https://gametora.com/images/umamusume/characters/thumb/"
    "chara_stand_{chara_id}_{card_id}.png"
)


def fetch(url: str) -> bytes | None:
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (UmaLab icon fetcher)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except urllib.error.HTTPError:
        return None


def main() -> None:
    cards = json.loads(CARDS_FILE.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    index: dict[str, str] = {}
    fetched = skipped = missing = 0
    for card_id_str, card in sorted(cards.items()):
        candidates = (
            (f"chara_stand_{card_id_str}.webp", UMA_MOE_URL.format(card_id=card_id_str)),
            (
                f"chara_stand_{card_id_str}.png",
                GAMETORA_URL.format(chara_id=card["chara_id"], card_id=card_id_str),
            ),
        )
        existing = next((n for n, _ in candidates if (OUT_DIR / n).exists()), None)
        if existing:
            index[card_id_str] = existing
            skipped += 1
            continue
        for filename, url in candidates:
            data = fetch(url)
            if data:
                (OUT_DIR / filename).write_bytes(data)
                index[card_id_str] = filename
                fetched += 1
                break
        else:
            missing += 1
            print(f"  no icon found for card {card_id_str} ({card['name']})")

    (OUT_DIR / "index.json").write_text(
        json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"icons: {fetched} fetched, {skipped} already present, {missing} missing")
    print(f"index: {OUT_DIR / 'index.json'} ({len(index)} entries)")


if __name__ == "__main__":
    main()
