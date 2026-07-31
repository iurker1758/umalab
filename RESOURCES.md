# Resources

External tools, data sources, and reference material relevant to UmaLab —
what each offers and how (or whether) we use it. Add an entry whenever a new
resource informs a feature, so future work can find it again.

## In use

- [uma.moe](https://uma.moe) ([github.com/uma-moe](https://github.com/uma-moe)) —
  resources API behind our committed reference data (character roster, factor
  name/type table, skills); their open-source stack documented the factor-id
  encoding `app/ingest.py` decodes. Needs `UMA_MOE_API_KEY` for
  `scripts/build_reference_data.py`.
- [xancia/UmaExtractor](https://github.com/xancia/UmaExtractor) (fork of
  [rockisch/umadump](https://github.com/rockisch/umadump)) — the veteran-dump
  tool whose `data.json` format we import. Watch it for dump-format changes
  when the game updates.

## Reference / inspiration

- [Vali-98/umamusu-utils](https://github.com/Vali-98/umamusu-utils) (MIT) —
  meta-DB key derivation and asset-bundle decryption. The out-of-repo
  favorite-mark extraction tool adapted it to pull mark icons from a local
  Global client; **no longer used**, since DECISIONS.md #22 replaced the
  extracted art with committed original SVGs. Kept here for the trail if
  reading client assets ever comes back.

- [ウマ娘設計図 (design.u-ma.org)](https://design.u-ma.org/) — JP
  inheritance-blueprint designer; the model for our planned English
  equivalent (lineage slots, spark targets, affinity display).
- [ayaliz/hakuraku](https://github.com/ayaliz/hakuraku/) (MIT; frontend of
  hakuraku.moe, detached fork of SSHZ-ORG/hakuraku, actively maintained) —
  Uma Musume **Global** toolbox (Vite + React + TS) whose Veterans page
  ingests the **same UmaExtractor `data.json`** we do; the closest existing
  sibling of UmaLab. Highest-value pieces:
  - `src/data/VeteransHelper.ts` — pure functions for factor-id
    categorization and the full **inheritance affinity math**
    (`calculateAffinity`, pair/grandparent variants, win-saddle race bonus)
    plus `calculateSparkChance` (per-category base proc rates scaled by
    affinity) — the core of a blueprint designer.
  - `SparkProcModal.tsx` — Poisson-binomial DP over both parents' trees for
    P(≥1)/P(≥2) sparks, full-run vs first-inheritance modes — overlaps our
    planned `expected_sparks` port; compare formulas.
  - `AffinityCalculatorPanel.tsx` / `RacePlannerModal.tsx` /
    `OptimizerPanel.tsx` — UX blueprints: affinity calculator fed from your
    own roster, G1 run planner, weighted spark-score roster ranking.
  - `public/data/umdb.json` + `umdb/data.proto` — committed English/Global
    reference data incl. **succession_relation /
    succession_relation_member** tables (relation points per chara) and
    win-saddle mappings that our uma.moe-sourced `app/data/` lacks.

  Caveats: its data pipeline is gitignored (only compiled data committed),
  spark base rates are hardcoded community constants (verify before
  shipping), and the affinity math may omit group/scenario-link bonuses —
  sanity-check against in-game values.
- [Uma Musume Support Card Tier List
  (euophrys.github.io/uma-tiers)](https://euophrys.github.io/uma-tiers/)
  ([source: Euophrys/umamusume-tierlist](https://github.com/Euophrys/umamusume-tierlist),
  MIT) — interactive **support-card** tier list for Global and JP; ranks are
  computed client-side from a deterministic expected-value model of training
  turns with user-tunable stat weights (`src/components/tierlist-calc.js`).
  Useful to us: machine-readable per-limit-break card effect data for Global
  (`src/cards/gl.js`, generated from master.mdb via the repo's
  `db-convert.py`), a GameTora id mapping
  (`src/components/gametora_conversion.json`), and the general "client-side
  EV calc with tunable weights" pattern our spark-scoring UI will follow.
  No per-skill valuation, no character tiers, no inheritance/spark data —
  orthogonal to sparks unless we grow a support-deck dimension.
- [Umamusume Reference Document ~ Global Edition (Erzzy, Google
  Docs)](https://docs.google.com/document/d/11X2P7pLuh-k9E7PhRiD20nDX22rNWtCpC1S4IMx_8pQ/edit)
  — community-maintained competitive reference for Global, five tabs
  (Banners & Tier Lists, New Player Info, Mechanics, Strategy, Mid-Run
  Info). The Mechanics → Legacies tab holds the canonical numbers for our
  spark-scoring milestone:
  - **End-of-run spark acquisition**: blue = one of the 5 stats uniformly
    at random, star odds by stat bracket (<600 / 600–1100 / >1100 →
    3★ at 0% / ~6% / ~10%); pink chosen among aptitudes at A+; whites
    20% per white skill, 25% per ◎, 40% per gold, +2.5% (+5% gold) per
    family member holding the same spark; white star split 50/45/5,
    improving to 20/70/10 at SS+ rank. One TP reroll, keep either result.
  - **Inheritance rates per spark**: blue 70/80/90%, pink 1/3/5%, unique
    5/10/15%, race whites 1/2/3%, other whites 3/6/9% — all scaled by
    (1 + affinity/100). Matches hakuraku's hardcoded rates, which
    corroborates both.
  - Blue spark stat values (+5/+12/+21), pink-star aptitude-raise costs,
    affinity symbol thresholds (linear effect, no breakpoints), and the
    pending Global affinity change (+1 per shared graded win → +3 per
    shared G1 only, retroactive) that a blueprint designer should model.
  - Also: race-speed/accel/HP formulas, guts thresholds, gacha math, and
    a 1–5 character rating rubric (CM / Team Trials / parent value).

- [Crazyfellow's Parenting & Gene guide (Google
  Docs)](https://docs.google.com/document/d/1Q3IJKbtkplmuY-PAJMNjYiLtasv0eU0aIBEqp8_C3tg/edit)
  — the deepest breeding-mechanics reference we have; JP terminology,
  actively updated through mid-2026, data verified with hakuraku's
  maintainer and sourced from large JP datasets (Polaris/Shoppo, incl. a
  2021 Cygames **patent** for the compatibility formula). The origin of the
  inheritance-rate table Erzzy's doc reproduces. Canonical for:
  - **Inheritance formula**: `base_rate * (1 + individual_affinity/100)`
    per lineage member — affinity is per-**individual** link, not the
    overall symbol; grandparent rates come out ≈ half the parent's. Base
    rates: blue 70/80/90%, pink+aptitude whites 1/3/5%, unique 5/10/15%,
    race 1/2/3%, other whites 3/6/9%. Gold inspiration events are
    cosmetic — they just indicate a 3★ proc.
  - **Spark generation**: blue = 1 of 5 stats at 20% each, 3★ needs the
    stat ≥600 (~5.5–6.5% 3★ at 600–1099, ~10–11% at 1100+, per-band data
    table); whites/greens star split by career rank score (90/10/0 below
    ~B, 50/45/5 below SS, 20/70/10 at SS+, 17.5/70/12.5 at UE+); white
    acquisition 20% base (+2.5% per lineage holder, cap ~35%), gold-skill
    versions 40–70% (+5%), ◎ versions 25–40%; race sparks 20–30% per G1
    **won**, duplicates don't stack; scenario sparks ~20% base, same
    lineage bonus, capped at 3 procs per inspiration turn.
  - **Inheritance payouts**: blue +5/+12/+21 initial and 1–10/1–16/1–28
    mid-run; scenario 10/20/30 per stat initial, 3/6/9 mid-run; skill
    hints +1–3 initial, +1–5 mid-run; already-learned skills convert
    hints to small stat gains. Sparks only generate from skills actually
    learned during the run.
  - **Affinity system status**: Global switched to the new G1-only system
    on 2026-06-24 (+3 per shared G1 win, parent↔parent overlaps count,
    boosted base values; G2/G3 and titles no longer count) — the blueprint
    designer should model the new system, not the legacy one. Thresholds:
    ◎ >150, ○ 51–150, △ ≤50; ideal race count 22–26 with dirt.
  - Linked tools: [umaishow](https://mee1080.github.io/umaishow/) base
    affinity table, [GameTora affinity
    planner](https://gametora.com/umamusume/compatibility) (per-server),
    [uma.pwnation.net](https://uma.pwnation.net/) race planner (supports
    Global), u-tools (JP).
