"""Fetch character icons for every card in app/data/cards.json.

Downloads the in-game 128x128 veteran-list icon per card_id into
frontend/public/icons/chara/ and writes an index.json mapping
card_id -> filename (so the frontend never guesses file extensions).

Sources (no auth): uma.moe's frontend assets, falling back to GameTora's
thumbnails for any miss. The output directory is gitignored — game art is
fetched locally, never committed (DECISIONS.md #10).

Usage:
    python scripts/fetch_icons.py

Idempotent: files that already exist (and look like real images) are skipped;
rerun after regenerating cards.json. To force a full re-download, delete
frontend/public/icons/chara/. Note the skip is per-file: a card that once
resolved via the GameTora .png fallback keeps that .png on reruns even if
uma.moe later serves the .webp — delete the .png to let it upgrade.
"""
import http.client
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


def looks_like_image(data: bytes) -> bool:
    """Magic-byte check so an error page or truncated file is never trusted."""
    return data.startswith(b"\x89PNG") or (
        data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    )


def fetch(url: str) -> bytes | None:
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (UmaLab icon fetcher)"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code != 404:  # 404 = try the next source; anything else is worth seeing
            print(f"  HTTP {e.code} from {url}")
        return None
    except (OSError, http.client.HTTPException) as e:
        # URLError/timeouts, plus mid-read failures (connection reset, SSL
        # errors, IncompleteRead) — one card missing, not a dead run.
        print(f"  unreachable ({e}): {url}")
        return None


def save_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def valid_existing(names: tuple[str, ...]) -> str | None:
    for name in names:
        path = OUT_DIR / name
        if path.exists():
            if looks_like_image(path.read_bytes()):
                return name
            path.unlink()  # corrupt leftover — refetch instead of trusting the name
    return None


def main() -> None:
    cards = json.loads(CARDS_FILE.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Seed from the previous run so an interrupted rerun can only improve the
    # index, never truncate it below what's already on disk. Entries for cards
    # gone from cards.json are dropped; a card that goes missing this run is
    # popped below.
    index: dict[str, str] = {}
    index_path = OUT_DIR / "index.json"
    if index_path.exists():
        try:
            prev = json.loads(index_path.read_text(encoding="utf-8"))
            index = {k: v for k, v in prev.items() if k in cards and isinstance(v, str)}
        except (ValueError, AttributeError):
            pass  # corrupt or wrong-shaped index — rebuild from scratch
    fetched = skipped = missing = 0
    try:
        for card_id_str, card in sorted(cards.items()):
            candidates = (
                (f"chara_stand_{card_id_str}.webp", UMA_MOE_URL.format(card_id=card_id_str)),
                (
                    f"chara_stand_{card_id_str}.png",
                    GAMETORA_URL.format(chara_id=card["chara_id"], card_id=card_id_str),
                ),
            )
            existing = valid_existing(tuple(n for n, _ in candidates))
            if existing:
                index[card_id_str] = existing
                skipped += 1
                continue
            for filename, url in candidates:
                data = fetch(url)
                if data and looks_like_image(data):
                    save_atomic(OUT_DIR / filename, data)
                    index[card_id_str] = filename
                    fetched += 1
                    break
            else:
                index.pop(card_id_str, None)  # no file on disk — drop any stale entry
                missing += 1
                print(f"  no icon found for card {card_id_str} ({card['name']})")
    finally:
        # Always leave a consistent index for whatever did land on disk.
        save_atomic(
            index_path,
            (json.dumps(index, indent=2, sort_keys=True) + "\n").encode("utf-8"),
        )
    print(f"icons: {fetched} fetched, {skipped} already present, {missing} missing")
    print(f"index: {index_path} ({len(index)} entries)")


if __name__ == "__main__":
    main()
