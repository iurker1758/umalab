"""Regenerate app/data/{cards,factors,skills}.json from uma.moe's resources.

cards.json: joins character.json.gz (card_id-keyed Global roster) with
character_names.json.gz (chara_id -> {name, skins}) into
card_id -> {chara_id, name, outfit, title}. The title (the card's bracketed
epithet, e.g. "[Starlight Beat]") isn't in any uma.moe artifact — it's read
from the local Global client's master.mdb (plain SQLite, text_data category
5) when the game is installed; otherwise titles carry over from the previous
cards.json so a gameless regeneration never wipes them.

factors.json: from factors.json.gz — the game's own factor names
(Global master.mdb text_data category 147), reshaped to
key -> {name, type} where key = uma.moe id // 10 (= factor_id // 100 in a
dump record). Types: 0 blue, 1 pink, 2 race, 3 white skill, 4 scenario,
5 unique, -1 other.

skills.json: skill_id -> {name, rarity, unique} from skills.json.gz,
gap-patched from the local master.mdb (skill_data + text_data category 47,
the game's own names/rarities) and, for gameless regenerations, from the
factor table and the previous committed file — see the pass comments in
main(). The unique flag is normalized locally (uma.moe's is inconsistent).

relations.json: the succession affinity tables (relation groups, their
points, and the rank bands behind the in-game △/○/◎ symbols) — these exist
on no fan API, so they come straight from the local client's master.mdb
(succession_relation, succession_relation_member, succession_relation_rank).

races.json: win-saddle id -> {name, g1_race_ids} plus race_id -> name, for
the shared-G1-win affinity bonus (single_mode_wins_saddle expanded through
race_instance to race, G1 = grade 100; names from text_data categories 111
and 32). Composite saddles (e.g. Classic Triple Crown) expand to all their
component races.

relations.json and races.json are skipped (previous committed files kept)
when the game isn't installed, like card titles.

All outputs are committed; rerun this manually when the game updates
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
import sqlite3
import sys
import urllib.request
from pathlib import Path
from typing import Any, cast

BASE_URL = "https://uma.moe/resources"
DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"
MASTER_MDB = (
    Path(os.path.expanduser("~"))
    / "AppData/LocalLow/Cygames/Umamusume/master/master.mdb"
)


def load_card_titles() -> dict[str, str]:
    """Card epithets from the local game client, falling back to whatever the
    committed cards.json already has (a machine without the game keeps them)."""
    titles: dict[str, str] = {}
    cards_file = DATA_DIR / "cards.json"
    if cards_file.exists():
        prev = cast(
            "dict[str, dict[str, Any]]",
            json.loads(cards_file.read_text(encoding="utf-8")),
        )
        titles = {
            cid: cast(str, c["title"])
            for cid, c in prev.items()
            if isinstance(c.get("title"), str) and c["title"]
        }
    if MASTER_MDB.exists():
        con = sqlite3.connect(f"file:{MASTER_MDB}?mode=ro", uri=True)
        try:
            rows = con.execute(
                'SELECT "index", text FROM text_data WHERE category = 5'
            ).fetchall()
        finally:
            con.close()
        titles.update({str(cid): text for cid, text in rows if text})
        print(f"card titles: {len(rows)} from local master.mdb")
    else:
        print(f"card titles: master.mdb not found, kept {len(titles)} previous")
    return titles


def load_mdb_skills() -> dict[str, dict[str, Any]]:
    """The game's own skill table: id -> {name, rarity}. Authoritative for
    Global — used to fill uma.moe's holes with real names instead of guesses.
    Empty on a machine without the game."""
    if not MASTER_MDB.exists():
        return {}
    con = sqlite3.connect(f"file:{MASTER_MDB}?mode=ro", uri=True)
    try:
        rows = con.execute(
            'SELECT s.id, t.text, s.rarity FROM skill_data s'
            ' JOIN text_data t ON t.category = 47 AND t."index" = s.id'
        ).fetchall()
    finally:
        con.close()
    return {
        str(sid): {"name": " ".join(str(text).split()), "rarity": rarity}
        for sid, text, rarity in rows
        if text
    }


def build_relations() -> dict[str, Any] | None:
    """The succession affinity tables, verbatim from the local client.

    None when the game isn't installed — the caller keeps the committed
    file, same posture as card titles: a gameless regeneration never wipes
    data only the client can provide.
    """
    if not MASTER_MDB.exists():
        return None
    con = sqlite3.connect(f"file:{MASTER_MDB}?mode=ro", uri=True)
    try:
        points = {
            str(rt): pt
            for rt, pt in con.execute(
                "SELECT relation_type, relation_point FROM succession_relation"
            )
        }
        members: dict[str, list[int]] = {}
        for rt, cid in con.execute(
            "SELECT relation_type, chara_id FROM succession_relation_member"
            " ORDER BY relation_type, chara_id"
        ):
            members.setdefault(str(rt), []).append(cid)
        rank_rows = con.execute(
            "SELECT relation_rank, rank_value_max FROM succession_relation_rank"
            " ORDER BY relation_rank"
        ).fetchall()
    finally:
        con.close()
    # relation_rank 1/2/3 are the game's △/○/◎ bands; the symbols themselves
    # aren't in the DB, only on screen.
    symbols = {1: "△", 2: "○", 3: "◎"}
    ranks = [{"max": mx, "symbol": symbols[rank]} for rank, mx in rank_rows]
    return {"ranks": ranks, "points": points, "members": members}


def build_races() -> dict[str, Any] | None:
    """Win-saddle -> G1 races mapping for the shared-win affinity bonus.

    Saddles are what a dump's win_saddle_id_array holds; composites expand to
    every component race. Non-G1 components are dropped (grade 100 = G1 —
    only shared G1 wins score points under the 2026-06-24 Global system),
    which can leave a saddle's g1_race_ids empty; it's kept for its name.

    Venue variants (the same G1 run at an alternate track — Kyoto-renovation
    reroutes, the rotating JBC hosts) are separate race rows with the same
    name; the game matches wins across them (in-game verified 2026-07-30:
    two cross-venue checks both scored the +3), so every variant group is
    canonicalized to its lowest race id here. race.\"group\" can't do this —
    it's 1 for every race.
    None when the game isn't installed (committed file kept).
    """
    if not MASTER_MDB.exists():
        return None
    con = sqlite3.connect(f"file:{MASTER_MDB}?mode=ro", uri=True)
    try:
        saddle_names = {
            idx: " ".join(str(text).split())
            for idx, text in con.execute(
                'SELECT "index", text FROM text_data WHERE category = 111'
            )
            if text
        }
        instance_race = dict(
            con.execute("SELECT id, race_id FROM race_instance").fetchall()
        )
        g1_ids = {
            rid for (rid,) in con.execute("SELECT id FROM race WHERE grade = 100")
        }
        all_race_names = {
            idx: " ".join(str(text).split())
            for idx, text in con.execute(
                'SELECT "index", text FROM text_data WHERE category = 32'
            )
            if text
        }
        instance_cols = ", ".join(f"race_instance_id_{i}" for i in range(1, 9))
        saddle_rows = con.execute(
            f"SELECT id, {instance_cols} FROM single_mode_wins_saddle"
        ).fetchall()
    finally:
        con.close()
    # Canonical id per G1: lowest race id among same-named rows.
    by_race_name: dict[str, list[int]] = {}
    for rid in g1_ids:
        by_race_name.setdefault(all_race_names.get(rid, f"Race {rid}"), []).append(rid)
    canonical = {rid: min(ids) for ids in by_race_name.values() for rid in ids}

    saddles: dict[str, dict[str, Any]] = {}
    used_race_ids: set[int] = set()
    for row in saddle_rows:
        saddle_id, instances = row[0], row[1:]
        race_ids = sorted(
            {
                canonical[instance_race[inst]]
                for inst in instances
                if inst and instance_race.get(inst) in g1_ids
            }
        )
        used_race_ids.update(race_ids)
        saddles[str(saddle_id)] = {
            "name": saddle_names.get(saddle_id, f"Saddle {saddle_id}"),
            "g1_race_ids": race_ids,
        }
    # Names only for races some saddle can actually reference — display data
    # for the shared-win breakdown, not a full race catalog.
    race_names = {
        str(rid): all_race_names.get(rid, f"Race {rid}") for rid in sorted(used_race_ids)
    }
    return {"saddles": saddles, "race_names": race_names}


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

    titles = load_card_titles()
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
            "title": titles.get(card_id_str, ""),
        }

    raw_factors = cast(
        "list[dict[str, Any]]", fetch_json(f"{BASE_URL}/current/factors.json.gz", api_key)
    )
    factors = {
        str(int(cast(str, f["id"])) // 10): {"name": f["text"], "type": f["type"]}
        for f in raw_factors
    }

    raw_skills = cast(
        "list[dict[str, Any]]", fetch_json(f"{BASE_URL}/current/skills.json.gz", api_key)
    )
    skills: dict[str, dict[str, Any]] = {}
    for s in raw_skills:
        sid = s.get("skill_id")
        if not isinstance(sid, int) or str(sid) in skills:
            continue  # duplicates exist (per-card unique rows); first wins
        # Some names carry embedded newlines ("Red \r\nShift/…") — collapse.
        name = " ".join(str(s.get("name") or "").split()) or f"Skill {sid}"
        skills[str(sid)] = {
            "name": name,
            "rarity": s.get("rarity"),
            "unique": bool(s.get("unique")),
        }

    # uma.moe's skill list has holes that real dumps hit, and its unique
    # flag is wrong on some rows. Patch and normalize locally.
    # Pass 1 — master.mdb: the installed client's own names/rarities fill
    # any hole exactly. Suffix arithmetic can NOT stand in for this: the
    # published pairs run both x1-gold/x2-white ("Beeline Burst" /
    # "Straightaway Adept") and x1-white/x2-gold ("Uma Stan"/"Superstan"),
    # and some suffix ids (200661) don't exist in the game at all.
    mdb_skills = load_mdb_skills()
    filled = 0
    for sid, info in mdb_skills.items():
        if sid not in skills:
            skills[sid] = {"name": info["name"], "rarity": info["rarity"], "unique": False}
            filled += 1
    if mdb_skills:
        print(f"skills: {filled} holes filled from local master.mdb")
    else:
        print("skills: master.mdb not found, using fallback passes only")

    # Pass 2 — base uniques: a type-5 factor key is chara_id*100 + 1, and the
    # matching unique skill id is 100001 + (chara_id - 1000)*10 (verified
    # against a real dump: factor key 101001 "Shooting for Victory!" is
    # skill 100101 on a trained Taiki Shuttle).
    for key_str, info in factors.items():
        key = int(key_str)
        if info["type"] == 5 and key % 100 == 1:
            sid = str(100001 + (key // 100 - 1000) * 10)
            if sid not in skills:
                skills[sid] = {"name": info["name"], "rarity": 5, "unique": True}

    # Pass 3 — inherited uniques: 9XXXXX is the inheritable (white-star) copy
    # of unique 1XXXXX; same name. The base is recognized by rarity >= 3, not
    # the not-yet-normalized upstream unique flag.
    for key_str in list(skills):
        sid_int = int(key_str)
        if 100000 <= sid_int <= 199999 and cast(int, skills[key_str]["rarity"] or 0) >= 3:
            inherited = str(sid_int + 800000)
            if inherited not in skills:
                skills[inherited] = {
                    "name": skills[key_str]["name"],
                    "rarity": 1,
                    "unique": True,
                }

    # Pass 4 — gameless fallback, ◎/○ families only: when a type-3 factor
    # name ends in ○, suffix 1 is the ◎ tier and 2 the ○ tier (holds for
    # every such pair uma.moe publishes). Families without a ○ name are left
    # alone — one of their suffixes is a gold skill whose name nothing here
    # can derive, and guessing used to write white names onto gold ids.
    for key_str, info in factors.items():
        name = cast(str, info["name"])
        if info["type"] != 3 or not name.endswith("○"):
            continue
        for suffix, tier_name in ((1, name[:-1] + "◎"), (2, name)):
            sid = str(int(key_str) * 10 + suffix)
            if sid not in skills:
                skills[sid] = {"name": tier_name, "rarity": 1, "unique": False}

    # Pass 5 — carry-over, like card titles: a machine without the game keeps
    # any previously committed entry the passes above couldn't reproduce.
    # Skipped when master.mdb is present — it is exhaustive for Global, so
    # anything still missing doesn't exist, and stale fabrications from older
    # script versions get dropped instead of carried forward.
    skills_file = DATA_DIR / "skills.json"
    if not mdb_skills and skills_file.exists():
        prev_skills = cast(
            "dict[str, dict[str, Any]]",
            json.loads(skills_file.read_text(encoding="utf-8")),
        )
        for sid, entry in prev_skills.items():
            skills.setdefault(sid, entry)

    # Normalize the unique flag — uma.moe ships it wrong on some rows (42 of
    # 137 inherited uniques, 4 of 82 rarity-5 bases). Full-table audit: every
    # rarity 3/4 row is an upgraded unique, rarity 5+ is a base unique, and
    # 9XXXXX is the inherited-unique range; nothing else is ever unique.
    for sid, entry in skills.items():
        entry["unique"] = (
            cast(int, entry["rarity"] or 0) >= 3 or 900000 <= int(sid) <= 999999
        )

    # master.mdb-only files: skip (keep the committed copy) without the game.
    mdb_outputs: list[tuple[str, Any]] = []
    for filename, payload in (
        ("relations.json", build_relations()),
        ("races.json", build_races()),
    ):
        if payload is None:
            print(f"{filename}: master.mdb not found, kept committed file")
        else:
            mdb_outputs.append((filename, payload))

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for filename, payload in (
        ("cards.json", cards),
        ("factors.json", factors),
        ("skills.json", skills),
        *mdb_outputs,
    ):
        out = DATA_DIR / filename
        out.write_text(
            json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {len(payload)} entries -> {out}")


if __name__ == "__main__":
    main()
