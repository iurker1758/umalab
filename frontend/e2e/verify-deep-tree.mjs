// PR 6b (feat/deep-tree-ui) — deep-tree designer checks. Replaces
// verify-designer.mjs. Baseline-relative (drives picks from live catalog
// data, computes expected letters with an independent reimplementation of
// the bracket rules) and self-restoring: every blueprint the run creates is
// deleted in `finally` via an API list-diff.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
// Set by CI so a headless-only failure is diagnosable: screenshots at the
// moment of the first few failures, plus a JSON summary. Unset locally,
// where the console output and a live browser are enough.
const ART = process.env.E2E_ARTIFACT_DIR || "";
if (ART) mkdirSync(ART, { recursive: true });

let pass = 0, fail = 0;
let thrown = null;
const failures = [];
// Assigned once `page` exists; check() runs long before that in file order,
// so it goes through this hook rather than closing over a TDZ binding.
let onFail = null;
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok ${name}`); }
  else {
    fail++;
    console.log(`  FAIL ${name} ${extra}`);
    failures.push({ name, extra });
    if (onFail) onFail(name);
  }
};

// ---------- independent bracket math (the spec, not the app code) ----------
const LETTERS = ["G", "F", "E", "D", "C", "B", "A", "S"];
const CAP = LETTERS.indexOf("A");
const idx = (l) => LETTERS.indexOf(l);
const bump = (s) => (s >= 10 ? 4 : s >= 7 ? 3 : s >= 4 ? 2 : s >= 1 ? 1 : 0);
const boost = (base, stars) => LETTERS[Math.min(idx(base) + bump(stars), CAP)];
// Letters the bump actually buys: the cap takes the rest, and a base already
// past A keeps its own ceiling. The From column reports THIS, not `bump` — a
// 4★ on a B is worth +2 and moves one step (issue #42).
const gained = (base, stars) =>
  Math.min(idx(base) + bump(stars), Math.max(CAP, idx(base))) - idx(base);
// What the From column should read for a projected row, cap note included.
const fromText = (base, stars) =>
  `${stars}★ → +${gained(base, stars)}` + (gained(base, stars) < bump(stars) ? " (at cap)" : "");
const KEYS = ["turf", "dirt", "sprint", "mile", "medium", "long", "front", "pace", "late", "end"];
const LABEL = {
  turf: "Turf", dirt: "Dirt", sprint: "Sprint", mile: "Mile", medium: "Medium",
  long: "Long", front: "Front", pace: "Pace", late: "Late", end: "End",
};

// ---------- baseline from the API ----------
// Checked, unlike a bare .json(): these sit above the try block, so a 500 or
// an HTML error page would otherwise surface as `SyntaxError: Unexpected
// token '<'` with no results file and no screenshot. CI's readiness gate
// polls :8000 directly while this goes through the Vite proxy, so a broken
// proxy is exactly the case it can't rule out.
const getJson = async (path) => {
  let res;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch (e) {
    console.log(`cannot reach ${BASE}${path} (${e}) — are both servers running?`);
    process.exit(1);
  }
  if (!res.ok) {
    console.log(`${BASE}${path} returned ${res.status} ${res.statusText} — cannot run`);
    process.exit(1);
  }
  return res.json();
};

// The affinity checks compare the panel against the endpoint rather than
// against a reimplementation: the formula has its own unit tests (backend
// tests/test_affinity.py, in-game anchored), so what's worth checking here
// is that the page builds the right REQUEST and renders the answer — which
// a second copy of the math in this file wouldn't test at all.
const postJson = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log(`POST ${BASE}${path} returned ${res.status} ${res.statusText} — cannot run`);
    process.exit(1);
  }
  return res.json();
};

const catalog = await getJson("/api/catalog");
const baselineIds = new Set((await getJson("/api/blueprints")).map((b) => b.id));
// This run makes its OWN spark list rather than writing into one of yours
// (DECISIONS.md #37) — so cleanup deletes a list it created, and can never
// take a spark out of a build you assembled. Named with a run-unique prefix
// because the name is unique per user: a leftover from an aborted run would
// otherwise 409 the create and fail the section for the wrong reason.
const E2E_LIST_PREFIX = "e2e spark list";
const listName = `${E2E_LIST_PREFIX} ${Date.now()}`;
// The union across your lists, read before anything is written. Used only to
// pick a spark you do NOT already have, so the assertions below run against a
// known-empty membership rather than against whatever you had favorited.
const baselineFavorites = new Set(
  (await getJson("/api/spark-lists")).flatMap((l) =>
    l.sparks.map((s) => `${s.kind}:${s.key}`)
  )
);
// Tracked at creation, not diffed at the end — the create writes a real row
// immediately and anything awaited after it can throw, and a timeout between
// the two would leave the list in your account forever.
const listsOwned = new Set();
// Optional: the roster is the pull's source, and an empty one is a legitimate
// state (nobody has imported a dump). CI seeds tests/fixtures/roster.json so
// the roster section always runs there; locally it runs against whatever you
// have imported. The suite NEVER imports — imports are full-replace snapshots
// (DECISIONS.md #3), so seeding from here would destroy a real roster.
const roster = await getJson("/api/veterans");
const owned = new Set();

// Cast: base cards only (picked by exact chip label), chosen so every
// assertion is reachable regardless of which dump/reference is loaded.
// A green spark's factor key IS a card_id, so the green a node can hold is
// decided by who is cast in it (DECISIONS.md #36). Fetched up here because
// G11's cast now has to satisfy that: she is the node this suite types a
// green onto, so she has to be a card the reference HAS one for.
const factorRef = await getJson("/api/factors");
const greenOf = (cardId) =>
  factorRef.find((f) => f.kind === "unique" && f.key === cardId);
const used = new Set();
const pickCard = (what, pred) => {
  for (const e of catalog) {
    if (used.has(e.chara_id)) continue;
    const c = e.cards[0];
    if (c.aptitudes !== null && pred(c.aptitudes, c)) {
      used.add(e.chara_id);
      return { entry: e, card: c, apt: c.aptitudes };
    }
  }
  console.log(`no catalog card fits the ${what} constraints — cannot run`);
  process.exit(1);
};
// Trainee + G11: a visible mile boost needs base mile ≤ C (C+2 < A).
const T = pickCard("trainee", (a) => idx(a.mile) >= 0 && idx(a.mile) <= idx("C"));
const G11 = pickCard(
  "g11",
  (a, c) => idx(a.mile) >= 0 && idx(a.mile) <= idx("C") && greenOf(c.card_id) !== undefined
);
// P1: mile below A (the 10★ +4 must move it) plus an A aptitude ≠ mile for
// the past-cap info note.
const P1 = pickCard(
  "p1",
  (a) => idx(a.mile) >= 0 && idx(a.mile) < CAP && KEYS.some((k) => k !== "mile" && a[k] === "A")
);
const aptA = KEYS.find((k) => k !== "mile" && P1.apt[k] === "A");
// P2: an aptitude below A to carry an undroppable typed spark. Mile is
// excluded so the typed pink can never collide with the mile assertions.
const P2 = pickCard("p2", (a) =>
  KEYS.some((k) => k !== "mile" && idx(a[k]) >= 0 && idx(a[k]) < CAP)
);
const aptLow = KEYS.find((k) => k !== "mile" && idx(P2.apt[k]) >= 0 && idx(P2.apt[k]) < CAP);
const G12 = pickCard("g12", () => true);

// ---------- roster cast (independent reimplementation, like the brackets) ----------
// A pink factor packs its aptitude in the key and its stars in the
// remainder; keys from app/data/factors.json type 1. Reimplemented here
// rather than imported so the suite checks the app against the spec.
const PINK_KEYS = {
  11: "turf", 12: "dirt",
  21: "front", 22: "pace", 23: "late", 24: "end",
  31: "sprint", 32: "mile", 33: "medium", 34: "long",
};
const pinkOf = (factors) => {
  let best = null;
  for (const f of factors ?? []) {
    const aptitude = PINK_KEYS[f.key];
    if (aptitude === undefined || f.star < 1 || f.star > 3) continue;
    if (best === null || f.star > best.stars) best = { aptitude, stars: f.star };
  }
  return best;
};
const memberAt = (v, position) => v.lineage.find((m) => m.position_id === position);
// A roster chip is labeled by identity plus the pink it carries — two
// veterans trained from the same card would otherwise read identically.
// It is NOT unique on a real roster: five Taiki Shuttles, two of them
// carrying 2★ Turf, are two chips with the same accessible name, and the
// pull helper's locator then matches both and Playwright refuses to click.
// So the cast below takes only veterans whose label nothing else shares.
const vetChipLabel = (v) => {
  const pink = pinkOf(v.factors);
  return (
    `${v.name}${v.outfit !== "Original" ? ` (${v.outfit})` : ""} · ` +
    (pink === null ? "no pink" : `${pink.stars}★ ${LABEL[pink.aptitude]}`)
  );
};
const labelCount = new Map();
for (const v of roster) {
  const label = vetChipLabel(v);
  labelCount.set(label, (labelCount.get(label) ?? 0) + 1);
}
// The map names a node from the CATALOG, by chara — so a veteran (or a
// lineage member) whose card the catalog doesn't serve renders as
// "Chara 1234" and the name assertions below would be checking a fallback.
const catalogCharas = new Set(catalog.map((e) => e.chara_id));
// Every position the pull reads. A veteran short of one is no use here: the
// checks below assert on all six.
const pullable = (v) =>
  pinkOf(v.factors) !== null &&
  catalogCharas.has(v.chara_id) &&
  labelCount.get(vetChipLabel(v)) === 1 &&
  [10, 20, 11, 12, 21, 22].every((p) => {
    const m = memberAt(v, p);
    return m !== undefined && pinkOf(m.factors) !== null && catalogCharas.has(m.chara_id);
  });

// Two veterans whose pulls are distinguishable: different charas, and
// different position-10 parents, so replacing one with the other visibly
// changes both Parent 1 and Grandparent 1-1.
const candidates = roster.filter(pullable);
const RV1 = candidates[0];
const RV2 = candidates.find(
  (v) =>
    RV1 !== undefined &&
    v.chara_id !== RV1.chara_id &&
    memberAt(v, 10).chara_id !== memberAt(RV1, 10).chara_id
);
// A common spark (white / race / scenario) that ONLY grandparents carry.
// Legacy Sparks stops at the veteran's PARENTS (DECISIONS.md #31): breeding
// from her pushes her grandparents out of the 6-slot tree, so a spark sitting
// on one can never be inherited from her, and the chooser must not offer it.
// Derived from the live roster — which names qualify depends on your dump, so
// the check below skips itself when none do.
const COMMON_KINDS = new Set(["white", "race", "scenario"]);
const commonNames = (factors) =>
  (factors ?? []).filter((f) => COMMON_KINDS.has(f.kind)).map((f) => f.name);
const reachableSparks = new Set(
  roster.flatMap((v) => [
    ...commonNames(v.factors),
    ...v.lineage
      .filter((m) => m.relation === "parent")
      .flatMap((m) => commonNames(m.factors)),
  ])
);
const gpOnlySpark = roster
  .flatMap((v) => v.lineage.filter((m) => m.relation === "grandparent"))
  .flatMap((m) => commonNames(m.factors))
  .find((n) => !reachableSparks.has(n));
// The control: a name that IS reachable has to be offered, or "not found"
// below would pass just as well against a broken search box.
const reachableSpark = [...reachableSparks][0];

// A catalog card to hand-place where a later pull will land, so the confirm
// has something hand-authored to warn about. It sits at Grandparent 2-2 and
// is then swallowed by a pull into Parent 2, so it must clash with neither
// veteran: not their charas, and not the succession parents either of them
// writes into the surrounding nodes.
const GX =
  RV1 === undefined || RV2 === undefined
    ? undefined
    : (() => {
        const taken = new Set(
          [RV1, RV2].flatMap((v) => [
            v.chara_id,
            memberAt(v, 10).chara_id,
            memberAt(v, 20).chara_id,
          ])
        );
        const entry = catalog.find(
          (e) => !used.has(e.chara_id) && e.cards[0].aptitudes !== null && !taken.has(e.chara_id)
        );
        if (entry === undefined) return undefined;
        used.add(entry.chara_id);
        return { entry, card: entry.cards[0] };
      })();

// The roster section runs only when the data supports every one of its
// assertions. CI seeds tests/fixtures/roster.json and sets
// E2E_REQUIRE_ROSTER, so an unusable roster there is a broken seeding step
// rather than an empty database — it must fail loudly instead of quietly
// skipping the section it exists to cover.
const rosterReady = RV1 !== undefined && RV2 !== undefined && GX !== undefined;
if (!rosterReady && process.env.E2E_REQUIRE_ROSTER) {
  console.log(
    `roster required but unusable: ${roster.length} veterans, ${candidates.length} with a ` +
    "full pinked six-slot lineage, and a spare catalog chara for the overwrite check — " +
    "did the fixture import step run?"
  );
  process.exit(1);
}

console.log(
  `baseline: ${catalog.length} catalog charas, ${baselineIds.size} blueprints; ` +
  `T=${T.entry.name} (mile ${T.apt.mile}), P1=${P1.entry.name} (mile ${P1.apt.mile}, ` +
  `${aptA} A), P2=${P2.entry.name} (${aptLow} ${P2.apt[aptLow]}), ` +
  `G11=${G11.entry.name}, G12=${G12.entry.name}`
);
console.log(
  rosterReady
    ? `roster: ${roster.length} veterans; RV1=${RV1.name} (${RV1.trained_chara_id}), ` +
      `RV2=${RV2.name} (${RV2.trained_chara_id}), GX=${GX.entry.name}`
    : `roster: ${roster.length} veterans — unusable, roster checks will be skipped`
);

const bpName = `verify-deep-tree ${Date.now()}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
// Windows where the run deliberately breaks the network. Anything logged
// inside one is expected; anything outside is real. This replaces an index
// into `errors` taken once, which classified EVERY later HTTP failure as
// noise — including a genuine 500 from the blueprints API in the middle of
// the persistence section, the highest-value part of the run. That was a
// false-green risk in exactly the place it could hide most.
let deliberate = false;
const expected = [];
const logError = (message) => (deliberate ? expected : errors).push(message);
const breaking = async (fn) => {
  deliberate = true;
  try {
    return await fn();
  } finally {
    deliberate = false;
  }
};

page.on("pageerror", (e) => logError(String(e)));
// "Failed to load resource" carries no URL, which makes a failure here
// impossible to act on — the response hook below reports the same thing with
// the method and URL attached.
page.on("console", (m) => {
  if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) logError(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) logError(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
});
// Accept every confirm (delete + discard-unsaved prompts) unless a check has
// armed the switch. The roster pull's overwrite guard is the one place where
// DECLINING is the behaviour under test, and a confirm nobody tests
// declining is a confirm that has silently become an overwrite. One handler
// reading a flag, not two handlers: both would fire and the first to answer
// would win, which is a race rather than a choice.
let dialogAction = "accept";
let lastDialog = null;
page.on("dialog", (d) => {
  lastDialog = d.message();
  void (dialogAction === "dismiss" ? d.dismiss() : d.accept());
});
const withDialog = async (action, fn) => {
  dialogAction = action;
  lastDialog = null;
  try {
    return await fn();
  } finally {
    dialogAction = "accept";
  }
};

// Screenshot at the moment of failure, not at the end — this suite is one
// long narrative, so by `finally` the page has moved well past the break.
// Serialised through one chain so shots never interleave, and capped: a
// cascade of 40 failures needs the first few, not all of them.
let shots = Promise.resolve();
if (ART) {
  let taken = 0;
  onFail = (name) => {
    if (taken >= 5) return;
    const n = ++taken;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    shots = shots
      .then(() => page.screenshot({ path: `${ART}/failure-${n}-${slug}.png`, fullPage: true }))
      .catch(() => {}); // a dead page must not mask the real failure
  };
}

// ---------- helpers ----------
const chipLabel = ({ entry, card }) =>
  `${entry.name}${card.outfit !== "Original" ? ` (${card.outfit})` : ""}`;
// Map chips are labeled "<node> — <content>".
const mapChip = (node) => page.locator(`.vped button[aria-label^="${node} — "]`);
const selectNode = async (node) => {
  await mapChip(node).click();
};
const pickInto = async (who) => {
  // The picker opens from the panel: Choose (empty) or Replace (filled).
  const open = page.locator('.focus-pick, .focus-actions button[aria-label^="Replace "]');
  await open.first().click();
  await page.waitForSelector(".designer-picker");
  await page.locator(".uma-search").fill(who.entry.name);
  await page.locator(`.designer-picker .card-chip[aria-label="${chipLabel(who)}"]`).click();
  await page.waitForSelector(".designer-picker", { state: "detached" });
};
// Pull a roster veteran into the selected node. Returns the confirm message
// the app raised, or null if it went through without asking.
const pullInto = async (v, action = "accept") =>
  withDialog(action, async () => {
    const open = page.locator('.focus-pick, .focus-actions button[aria-label^="Replace "]');
    await open.first().click();
    await page.waitForSelector(".designer-picker");
    await page.locator(".picker-source .seg", { hasText: "My Roster" }).click();
    // No name search on this tab — the roster is sorted and filtered instead,
    // and veterans render as the roster page's own cards (.card), not the
    // catalog's bare chips.
    await page.locator(`.designer-picker .card[aria-label="${vetChipLabel(v)}"]`).click();
    if (action === "dismiss") {
      // Declining an overwrite has to leave the picker exactly as it was:
      // the confirm is raised on the way to a pick, so closing first would
      // throw away the filters and sort on the way to a dialog the user then
      // declined, and make "Cancel" cost a search.
      check("declining an overwrite leaves the picker open",
        (await page.locator(".designer-picker").count()) === 1);
      await page.keyboard.press("Escape");
    }
    await page.waitForSelector(".designer-picker", { state: "detached" });
    // The dialog is raised synchronously inside the click handler, so by the
    // time the picker has closed it has already been answered.
    return lastDialog;
  });
const sparkLabel = (member) => {
  const pink = pinkOf(member.factors);
  return `${pink.stars}★ ${LABEL[pink.aptitude]}`;
};
// A deep chip that holds a character names her after the spark: the portrait
// is decorative, so the label is the only place her identity is reachable.
// The cast guarantees every pulled member's chara is in the catalog, so this
// never has to cope with the "…" not-loaded form.
const charaNameOf = (charaId) => catalog.find((e) => e.chara_id === charaId)?.name;
// Whether a deep chip shows somebody. Deliberately NOT "renders an <img>":
// character art is gitignored (DECISIONS.md #10) and CI never fetches it, so
// requiring the portrait would fail there for a reason unrelated to the code.
// The slot falls back to her initial, and the thing worth asserting is that
// it knows who it is at all — never the "+" an empty slot shows.
const hasFace = async (node) => {
  const ico = mapChip(node).locator(".sp-ico");
  if ((await ico.count()) !== 1) return false;
  if ((await mapChip(node).locator("img.sp-ico").count()) === 1) return true;
  return ((await ico.textContent()) ?? "").trim() !== "+";
};
const deepLabel = (member) => `${sparkLabel(member)} · ${charaNameOf(member.chara_id)}`;
const setSpark = async (node, aptitude, stars) => {
  await page.locator(`select[aria-label="${node} pink spark"]`).selectOption(aptitude);
  await page.locator(`[aria-label="${node} stars"] .seg`, { hasText: `${stars}★` }).click();
};
// The save bar: an editable name field with a caret that drops the list of
// the OTHER blueprints, plus duplicate/delete icons and the autosave status.
const nameField = () => page.locator(".bp-field .designer-name");
const pickerLabel = async () => (await nameField().inputValue()).trim();
const openPicker = async () => {
  await page.locator(".bp-caret").click();
  await page.waitForSelector(".bp-menu");
};
const closePicker = async () => {
  await page.keyboard.press("Escape");
  await page.waitForSelector(".bp-menu", { state: "detached" });
};
// Autosave is debounced; every mutation settles through this. "Saved" alone
// isn't settled — it also reads Saved in the moment before a create or a
// switch lands — so a blueprint has to actually be open too.
const settled = () =>
  page.waitForFunction(
    () =>
      document.querySelector(".designer-autosave")?.textContent === "Saved" &&
      (document.querySelector(".bp-field .designer-name")?.value ?? "") !== "",
    null,
    { timeout: 5000 }
  );
// Poll the API for a state the page reaches on its own (a debounced write,
// a retry) rather than sleeping a guessed interval.
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
const rows = async () => await (await fetch(`${BASE}/api/blueprints`)).json();
// Rows this run brought into existence. "Not in the startup snapshot" is not
// the same thing — a blueprint saved from another tab mid-run is also absent
// from it, and deleting that is real data loss against a live database. The
// suite's own rows are either `bpName`-prefixed (the timestamp makes that
// unambiguous) or untitled ones created through the UI, which is what this
// claims. Called right after our own creates, so the window in which someone
// else's row could be mistaken for ours is a moment rather than the whole run.
const claimNew = async () => {
  for (const b of await rows()) if (!baselineIds.has(b.id)) owned.add(b.id);
};
const rowById = async (id) => (await rows()).find((b) => b.id === id);
const sparkOf = (bp, i = 0) => bp?.slots?.sparks?.[i] ?? null;
const openedNamed = (label) =>
  page.waitForFunction(
    (n) => document.querySelector(".bp-field .designer-name")?.value === n,
    label,
    { timeout: 5000 }
  );
const rename = async (name) => {
  await nameField().fill(name);
  await nameField().press("Enter");
  if (await page.locator(".bp-menu").count()) await closePicker();
  await settled();
};
const switchTo = async (label) => {
  await openPicker();
  await page.locator(".bp-menu button.bp-row", { hasText: label }).first().click();
  await page.waitForSelector(".bp-menu", { state: "detached" });
};
const newBlueprint = async () => {
  const before = await pickerLabel();
  await switchTo("+ New Blueprint");
  await page.waitForFunction(
    (n) => document.querySelector(".bp-field .designer-name")?.value !== n,
    before,
    { timeout: 5000 }
  );
  await claimNew();
};
const barButton = (action) => page.locator(`.designer-save button[aria-label^="${action}"]`);
const aptRow = (label) =>
  page.locator(".apt-table tr").filter({
    has: page.locator("td.apt-key", { hasText: new RegExp(`^${label}$`) }),
  });
const rowLetter = async (label) =>
  (await aptRow(label).locator("td").nth(1).textContent()).trim();
const rowFrom = async (label) =>
  ((await aptRow(label).locator("td").nth(2).textContent()) ?? "").trim();

try {
  await page.goto(BASE);
  await page.waitForSelector(".nav");
  await page.locator(".nav a", { hasText: "Designer" }).click();
  await page.waitForURL("**/designer");
  await page.waitForSelector(".designer");
  check("designer route renders", true);
  // Every design is a server row: the page opens one, creating it if the
  // table was empty. Whatever it landed on, start this run in a fresh one.
  // The bar renders before a row exists (a design with no row still has to
  // be able to report that it isn't saved), so waiting for it is not waiting
  // for the bootstrap — wait for a blueprint to actually be open. On an
  // empty table that includes creating one.
  await page.waitForSelector(".designer-autosave", { timeout: 5000 });
  const opened = await settled().then(() => true, () => false);
  check("a blueprint is open on arrival", opened && (await pickerLabel()).length > 0);
  await newBlueprint();
  await rename(bpName);
  check("map renders all 31 nodes", (await page.locator(".vped .vnode").count()) === 31);
  check("all nodes empty in a new blueprint",
    (await page.locator(".vped .vnode.pick").count()) === 31);
  check("trainee focused by default",
    (await page.locator(".focus-name").textContent()) === "Trainee");

  // ---------- trainee: catalog-only picker, base letters ----------
  await page.locator(".focus-pick").click();
  await page.waitForSelector(".designer-picker");
  // Catalog is the default source whether or not a roster exists: a plan
  // that starts from the sparks you're hunting has to work against an empty
  // roster, so pulling a veteran is the shortcut and never the entry point.
  // The tab strip appears only when there's something to pull.
  // This picker is the TRAINEE's, which never offers the roster: the trainee
  // is the horse you're about to train, so it isn't in your roster — and a
  // pull there would be the one click that empties all 31 nodes.
  check("the trainee's picker offers no roster tab",
    (await page.locator(".designer-picker .picker-source").count()) === 0);
  await page.locator(".uma-search").fill(T.entry.name);
  await page.locator(`.designer-picker .card-chip[aria-label="${chipLabel(T)}"]`).click();
  await page.waitForSelector(".designer-picker", { state: "detached" });
  check("trainee panel shows the pick",
    (await page.locator(".focus-name").textContent()) === T.entry.name);
  check("trainee turf = card base", (await rowLetter("Turf")) === T.apt.turf);
  check("trainee mile = card base", (await rowLetter("Mile")) === T.apt.mile);
  check("trainee has no spark editor",
    (await page.locator('select[aria-label="Trainee pink spark"]').count()) === 0);
  // A trainee alone has no affinity, so no proc chance can be estimated. The
  // tab is there anyway: it is where sparks are TYPED, and gating it on a
  // score once made the only editor vanish whenever the design was too sparse
  // to score or the backend blipped. It opens onto an honest empty state.
  check("the Sparks tab exists before there's a score to roll against",
    (await page.locator(".focus-tab").count()) === 2 &&
    (await page.locator(".proc-table").count()) === 0);
  await page.locator(".focus-tabs .focus-tab", { hasText: "Sparks" }).click();
  check("and says the tree is empty rather than showing numbers",
    (await page.locator(".focus .proc-table").count()) === 0 &&
    (await page.locator(".focus .focus-note", { hasText: "No sparks on the ancestors" }).count()) === 1);
  await page.locator(".focus-tabs .focus-tab", { hasText: "Details" }).click();
  // A trainee alone is not a pairing: the panel says what's missing rather
  // than scoring an empty tree as a confident zero.
  check("affinity waits for a parent",
    (await page.locator(".focus", { hasText: "Run Affinity" }).count()) === 1 &&
    (await page.locator(".focus .aff-total").count()) === 0 &&
    (await page.locator(".focus-note", { hasText: "at least one parent" }).count()) === 1);
  // The tile keeps its footprint before there's a number, the way empty
  // cards keep their letter cells — the map must not reflow when a score
  // lands.
  check("the trainee's chip holds the affinity tile's space meanwhile",
    (await mapChip("Trainee").locator(".aff-chip b.blank").count()) === 1);

  // ---------- parents + GPs ----------
  await selectNode("Parent 1");
  await pickInto(P1);
  check("p1 panel shows the pick",
    (await page.locator(".focus-name").textContent()) === P1.entry.name);
  await selectNode("Parent 2");
  await pickInto(P2);
  await selectNode("Grandparent 1-1");
  await pickInto(G11);
  await setSpark("Grandparent 1-1", "mile", 3);
  await selectNode("Grandparent 1-2");
  await pickInto(G12);
  await setSpark("Grandparent 1-2", "mile", 3);

  // Conflict grey-outs in the P2 picker: sibling P1 and the trainee.
  await selectNode("Parent 2");
  await page.locator('.focus-actions button[aria-label^="Replace "]').click();
  await page.waitForSelector(".designer-picker");
  await page.locator(".uma-search").fill(P1.entry.name);
  const p1Chip = page.locator(`.designer-picker .card-chip[aria-label*="${P1.entry.name}"]`).first();
  check("P1's chara greyed out in P2 picker",
    (await p1Chip.getAttribute("aria-label"))?.includes("must be different"));
  await page.locator(".uma-search").fill(T.entry.name);
  const tChip = page.locator(`.designer-picker .card-chip[aria-label*="${T.entry.name}"]`).first();
  check("trainee's chara greyed out in P2 picker",
    (await tChip.getAttribute("aria-label"))?.includes("trainee's own character"));
  await page.keyboard.press("Escape");
  await page.waitForSelector(".designer-picker", { state: "detached" });

  // ---------- trainee window: 6★ mile from the typed GP pinks ----------
  await selectNode("Trainee");
  const tMile = boost(T.apt.mile, 6);
  check(`trainee mile boosted to ${tMile}`, (await rowLetter("Mile")) === tMile);
  check(`trainee mile From = ${fromText(T.apt.mile, 6)}`,
    (await rowFrom("Mile")) === fromText(T.apt.mile, 6), await rowFrom("Mile"));
  check("boosted letter highlighted",
    (await aptRow("Mile").locator(".apt-final.boosted").count()) === 1);

  // ---------- run affinity, on the trainee's panel only ----------
  // The request the page should be sending: the four filled slots, each a
  // catalog pick and so carrying no won saddles, and no key at all for the
  // two empty grandparents — an empty slot is nobody, not a slot worth zero.
  const expectedAff = await postJson("/api/affinity", {
    trainee_chara_id: T.entry.chara_id,
    p1: { chara_id: P1.entry.chara_id, win_saddle_ids: [] },
    p2: { chara_id: P2.entry.chara_id, win_saddle_ids: [] },
    g11: { chara_id: G11.entry.chara_id, win_saddle_ids: [] },
    g12: { chara_id: G12.entry.chara_id, win_saddle_ids: [] },
  });
  const affTotal = page.locator(".focus .aff-number");
  // Polled, not read once: scoring is debounced, and an earlier score from
  // when only P1 was filled would otherwise be read as this one's answer.
  check(`affinity scores ${expectedAff.total} ${expectedAff.symbol}`,
    await until(async () =>
      (await affTotal.count()) === 1 &&
      (await affTotal.textContent()) === String(expectedAff.total)));
  check("band symbol matches the total",
    (await page.locator(".aff-symbol").textContent()) === expectedAff.symbol);
  check("one row per scored link, under labelled columns",
    (await page.locator(".aff-links tbody tr").count()) === 7 &&
    (await page.locator(".aff-links thead th").allTextContents()).join(",") ===
      "Link,Rel.,Wins,Total");
  // Per-link, not per-ancestor: the response carries a `*_affinity` for each
  // of the six, but the TRAINEE's panel shows the run's link table, not a
  // roll-up of the ancestors. Their individual numbers live on their own
  // panels (`.aff-compose`), which is what this asserts is absent here —
  // an earlier version of this check queried a class no component renders,
  // so it passed no matter what the panel contained.
  check("the trainee's panel breaks the run down by link, not by ancestor",
    (await page.locator(".focus .aff-links").count()) === 1 &&
    (await page.locator(".focus .aff-compose").count()) === 0);
  check("the link rows sum to the total",
    (await page.locator(".aff-link-sum").allTextContents())
      .slice(1)  // drop the column header
      .reduce((n, t) => n + Number(t), 0) === expectedAff.total);
  // The same number on the trainee's map chip, so judging a pairing doesn't
  // cost a click. With the band symbol here — this one IS a whole pairing.
  check("the trainee's map chip carries the total",
    (await mapChip("Trainee").locator(".aff-chip .aff-chip-sym").textContent()) ===
      expectedAff.symbol &&
    (await mapChip("Trainee").locator(".aff-chip b").textContent()) ===
      String(expectedAff.total));
  check("the chip's label says it too, appended so prefixes still match",
    (await mapChip("Trainee").getAttribute("aria-label"))
      ?.endsWith(` · affinity ${expectedAff.symbol} ${expectedAff.total}`));
  // Not a row of its own: it sits in the head grid, right of the portrait
  // (which spans the left two columns) and above the track pair, two columns
  // wide. Measured rather than read off the DOM order — the claim is about
  // where it lands, and grid placement makes those two independent.
  check("the affinity tile is in the head, right of the portrait, above the track pair",
    await mapChip("Trainee").evaluate((el) => {
      const box = (sel) => el.querySelector(sel)?.getBoundingClientRect() ?? null;
      const aff = box(".head .aff-chip");
      const icon = box(".head img, .head .lineage-icon-fallback");
      const turf = box('.head .apt-cell[title^="Turf"]');
      if (aff === null || icon === null || turf === null) return false;
      return (
        aff.left >= icon.right - 1 &&
        aff.bottom <= turf.top + 1 &&
        aff.width > turf.width  // two columns to the letters' one
      );
    }));
  // Every ancestor shows its INDIVIDUAL affinity — every link it appears in,
  // the number a proc off it rolls against. Bandless: the △/○/◎ table grades
  // whole pairings, so a symbol on one ancestor would read as a rating for
  // her alone.
  const chipAff = (node) => mapChip(node).locator(".aff-chip b").textContent();
  const linkPts = (id) => {
    const l = expectedAff.links.find((x) => x.link === id);
    return l.relation_points + l.win_points;
  };
  check("each ancestor carries its individual affinity",
    (await chipAff("Parent 1")) === String(expectedAff.p1_affinity) &&
    (await chipAff("Parent 2")) === String(expectedAff.p2_affinity) &&
    (await chipAff("Grandparent 1-1")) === String(expectedAff.g11_affinity) &&
    (await chipAff("Grandparent 1-2")) === String(expectedAff.g12_affinity));
  check("only the trainee's tile carries a band symbol",
    (await page.locator(".vped .aff-chip-sym").count()) === 1);
  // Unsigned on purpose: "+175" invites adding the tiles up, and this is the
  // one quantity that doesn't support it.
  check("ancestor tiles are unsigned",
    (await page.locator(".vped .aff-chip b").allTextContents()).every((t) => !t.startsWith("+")));
  // What those numbers are: every link the ancestor is part of. A parent's
  // includes the parent-pair link, so it lands in BOTH parents and a
  // grandparent's triple sits inside its parent's number — which is why they
  // deliberately do not partition the total (DECISIONS.md #15/#29).
  check("a parent's is her own link, both triples and the parent pair",
    expectedAff.p1_affinity ===
      linkPts("t-p1") + linkPts("t-p1-g11") + linkPts("t-p1-g12") + linkPts("p1-p2") &&
    expectedAff.p2_affinity ===
      linkPts("t-p2") + linkPts("t-p2-g21") + linkPts("t-p2-g22") + linkPts("p1-p2"));
  check("a grandparent's is its own triple alone",
    expectedAff.g11_affinity === linkPts("t-p1-g11") &&
    expectedAff.g12_affinity === linkPts("t-p1-g12"));
  // The misranking that owned-link produced, guarded against: `t-p1`/`t-p2`
  // are the only links that can never carry a win bonus, so attributing each
  // link to its deepest node left parents below their own grandparents on any
  // lineage with real overlap. A parent must never read lower than a
  // grandparent beneath her — her number contains that grandparent's.
  check("a parent never reads below her own grandparents",
    expectedAff.p1_affinity >= expectedAff.g11_affinity &&
    expectedAff.p1_affinity >= expectedAff.g12_affinity);
  check("an empty ancestor shows no number",
    (await mapChip("Grandparent 2-1").locator(".aff-chip b.blank").count()) === 1);
  // The tile stops at the grandparents: below them the game scores no
  // affinity at all, and those chips are anonymous spark slots.
  check("the seven named nodes carry a tile, and nothing deeper does",
    (await page.locator(".vped .aff-chip").count()) === 7);
  // An ancestor's panel shows its INDIVIDUAL affinity instead — the number a
  // proc off it rolls against, with the links it's composed of. Nesting and
  // double-counting are why this lives here and not on a tile.
  await selectNode("Parent 1");
  check("a parent's panel shows her individual affinity, not the run's",
    (await page.locator(".focus .aff-number").textContent()) ===
      String(expectedAff.p1_affinity) &&
    (await page.locator(".focus .aff-symbol").count()) === 0);
  check("and the four links it's composed of, in tree order",
    (await page.locator(".focus .aff-compose .aff-link-name").allTextContents()).join(",") ===
      "Trainee · Parent 1,Parent 1 · GP 1-1,Parent 1 · GP 1-2,Parent 1 · Parent 2");
  check("the composing rows sum to the number above them",
    (await page.locator(".focus .aff-compose .aff-link-sum").allTextContents())
      .reduce((n, t) => n + Number(t), 0) === expectedAff.p1_affinity);
  await selectNode("Grandparent 1-1");
  check("a grandparent's is one link, named rather than tabulated",
    (await page.locator(".focus .aff-number").textContent()) ===
      String(expectedAff.g11_affinity) &&
    (await page.locator(".focus .aff-compose").count()) === 0 &&
    (await page.locator(".focus .aff-caption").textContent()) === "Parent 1 · GP 1-1");
  // G2-1 and G2-2 are unfilled in this cast, so P2's composition must list
  // only the links whose other member exists — a zeroed row would claim a
  // grandparent nobody has.
  await selectNode("Parent 2");
  check("a parent's composition skips links into empty slots",
    (await page.locator(".focus .aff-compose .aff-link-name").allTextContents()).join(",") ===
      "Trainee · Parent 2,Parent 1 · Parent 2");
  // ---------- inspiration proc estimates ----------
  // Unlike affinity, this model has no server implementation to compare
  // against and no unit runner behind it — procs.ts is pure client math, so
  // these checks are the only place it is verified at all. Hence a second
  // copy of the formula here, which the affinity checks above deliberately
  // avoid: there, a reimplementation would test nothing the endpoint didn't
  // already answer.
  const procPct = (type, stars, aff) => {
    const base = {
      pink: [1, 3, 5], white: [3, 6, 9], unique: [5, 10, 15],
      race: [1, 2, 3], scenario: [3, 6, 9],
    }[type][stars - 1];
    const p = Math.min(base * (1 + aff / 100), 100) / 100;
    return 1 - (1 - p) ** 2;
  };
  const pct = (p) => `${(p * 100).toFixed(1)}%`;
  const openTab = async (name) =>
    page.locator(".focus-tabs .focus-tab", { hasText: name }).click();

  // Every node that can hold sparks is tabbed, scored or not. A deep spark
  // slot is the one that isn't: the document gives generations 3-4 a pink and
  // nothing else, so there is no spark list to type and no tab to hold one.
  check("a named ancestor has a Sparks tab", (await page.locator(".focus-tab").count()) === 2);
  check("the tabs are Details and Sparks — the label names the sheet, not the estimate",
    (await page.locator(".focus-tab").allTextContents()).join(",") === "Details,Sparks");
  await selectNode("Sparks 3-1");
  check("a deep spark slot has no tabs", (await page.locator(".focus-tab").count()) === 0);

  await selectNode("Grandparent 1-1");
  await openTab("Sparks");
  const rowFor = (name) => page.locator(".focus .proc-table tbody tr", { hasText: name });
  const chanceOf = (name) => rowFor(name).locator(".proc-chance").textContent();
  const g11Pink = procPct("pink", 3, expectedAff.g11_affinity);
  check(`g11's 3★ pink at ${expectedAff.g11_affinity} affinity estimates ${pct(g11Pink)}`,
    (await page.locator(".focus .proc-table tbody tr").allTextContents()).length === 1 &&
    (await chanceOf("Mile")) === pct(g11Pink));
  check("named as the spark it is, with its stars and its kind's colour",
    (await rowFor("Mile").locator(".proc-name").textContent())?.trim() === "Mile" &&
    (await rowFor("Mile").locator(".proc-level").textContent())?.trim() === "★★★" &&
    (await rowFor("Mile").getAttribute("class"))?.includes("proc-row-pink"));
  // The pink's editor is on Details, beside the letters it bumps at career
  // start — so on an editable table it holds the level column with the same
  // glyphs a locked table uses, rather than leaving a gap where every other
  // row has a control. A value where the others are controls, not a missing
  // control.
  check("the pink row shows its level, and offers no ✕ — its editor is on Details",
    (await rowFor("Mile").locator(".proc-drop").count()) === 0 &&
    (await rowFor("Mile").locator(".proc-level .proc-stars").count()) === 1);
  // The tab is where the other kinds are typed: they feed nothing but these
  // numbers, unlike the pink, which bumps the letters on the Details tab.
  // Driven off the served reference rather than hardcoded names, the same way
  // this suite derives its cast from /api/catalog.
  const pickOf = (kind) => factorRef.find((f) => f.kind === kind);
  // By id, never by displayed name: race and scenario sparks routinely
  // contain a skill's name as a substring, so a `hasText` match would click a
  // different kind's row and every assertion below would fail on reference
  // data alone.
  // The level is chosen on the match itself, so an add names both the spark
  // and its ★ — there is no "lands at 1★, then correct it" step to drive.
  //
  // Entry is a POPOUT as of #35, not an inline search: the panel carries one
  // "Add a Spark" button and the box, the browse sections and the ★ picker
  // live behind it. The box keeps the aria-label the inline one had, so only
  // the open and the dismiss are new here.
  const openChooser = async (label) => {
    if ((await page.locator(".spark-popout").count()) === 0) {
      await page.locator(".focus .spark-open").click();
      await page.waitForSelector(`.spark-popout input[aria-label="${label} spark search"]`);
    }
  };
  const closeChooser = async () => {
    if ((await page.locator(".spark-popout").count()) > 0) {
      await page.keyboard.press("Escape");
      await page.waitForSelector(".spark-popout", { state: "detached" });
    }
  };
  const addSpark = async (label, ref, stars = 1) => {
    await openChooser(label);
    await page.locator(`.spark-popout input[aria-label="${label} spark search"]`).fill(ref.name);
    await page
      .locator(`.spark-matches button[data-spark="${ref.kind}:${ref.key}"][data-stars="${stars}"]`)
      .click();
    await closeChooser();
  };
  const added = [];
  for (const kind of ["white", "unique", "race", "scenario"]) {
    // The green is HERS, not an arbitrary one: a unique's key is a card_id,
    // so the chooser offers this node exactly one and the other 136 are
    // sparks she can never carry (DECISIONS.md #36).
    const ref = kind === "unique" ? greenOf(G11.card.card_id) : pickOf(kind);
    await addSpark("G1-1", ref);
    added.push(ref);
  }
  // The rule itself, on screen: one green offered on a cast node, not 137.
  await openChooser("G1-1");
  const greensOffered = await page.locator(".spark-popout .proc-kind-unique").count();
  check("a cast node is offered only her own green, which she now holds",
    greensOffered === 1 &&
    (await page.locator(`.spark-popout li:has(.proc-kind-unique) .spark-held`).count()) === 1);
  await closeChooser();
  // Every kind rolls on its OWN base — white 3/6/9, green 5/10/15, race
  // 1/2/3, scenario 3/6/9 — so a 1★ of each at one affinity must produce
  // three distinct numbers, not one repeated.
  const expected1Star = Object.fromEntries(
    added.map((r) => [r.kind, pct(procPct(r.kind, 1, expectedAff.g11_affinity))])
  );
  check(`each kind rolls on its own base (${added.map((r) => `${r.kind} ${expected1Star[r.kind]}`).join(", ")})`,
    await until(async () =>
      (await Promise.all(added.map((r) => chanceOf(r.name)))).join(",") ===
        added.map((r) => expected1Star[r.kind]).join(",")));
  check("green outruns white, and race trails both, at the same star and affinity",
    Number(expected1Star.unique.replace("%", "")) >
      Number(expected1Star.white.replace("%", "")) &&
    Number(expected1Star.white.replace("%", "")) >
      Number(expected1Star.race.replace("%", "")));
  check("each is named from the reference and coloured by its kind",
    (await Promise.all(
      added.map(async (r) => (await rowFor(r.name).getAttribute("class")))
    )).every((cls, i) => cls?.includes(`proc-row-${added[i].kind}`)));
  // The kind is colour and bar fill only — spelling it out cost the names
  // width they need, and the tables never repeat it as a word.
  check("no spelled-out kind in the spark column",
    (await page.locator(".focus .proc-table .proc-kind").count()) === 0);
  // GROUPED by kind here, not ranked — the two tables default differently on
  // purpose. At one member's single affinity every chance is
  // min(base × (1 + aff/100), 100), a pure function of (kind, ★), so the
  // ranking is a tie for most of its length and the order inside a tie says
  // nothing. Pink → Green → Race → White → Scenario, the game's own grouping.
  const rowKinds = () =>
    page.locator(".focus .proc-table tbody tr").evaluateAll((rows) =>
      rows.map((r) => [...r.classList].find((c) => c.startsWith("proc-row-"))?.slice(9))
    );
  const rowNames = async () =>
    (await page.locator(".focus .proc-table tbody tr .proc-name").allTextContents())
      .map((t) => t.trim());
  const rankedDown = () =>
    page.locator(".focus .proc-table tbody").evaluate((el) => {
      const nums = [...el.querySelectorAll(".proc-pct")].map((n) =>
        Number(n.textContent.replace("%", ""))
      );
      return nums.length > 3 && nums.every((n, i) => i === 0 || nums[i - 1] >= n);
    });
  // The column headers are the sort control — no separate switch to drive.
  const setSort = (by) =>
    page.locator(`.focus .proc-table th.${by === "kind" ? "proc-name" : "proc-chance"} .proc-h`)
      .click();
  const sortedBy = () =>
    page.locator(".focus .proc-table thead").evaluate((el) => {
      const on = [...el.querySelectorAll("th.proc-th-sort")].find(
        (th) => th.getAttribute("aria-sort") !== "none"
      );
      return on === undefined ? null : `${on.textContent.trim()}:${on.getAttribute("aria-sort")}`;
    });
  check("an ancestor's table groups by kind by default",
    (await rowKinds()).join(",") === "pink,unique,race,white,scenario" &&
    (await sortedBy()) === "Spark:other");
  await setSort("chance");
  check("and ranks by chance when its own header is clicked",
    (await rankedDown()) &&
    (await rowKinds()).join(",") !== "pink,unique,race,white,scenario" &&
    (await sortedBy()) === "Est. Per Run:descending");
  await setSort("kind");
  // The headers carry the sort, so the tab keeps a single control on it.
  // Asserted against what's RENDERED between the tabs and the table — not
  // against the class names of the pill this replaced, which would report
  // "no second switch" however many switches a later change put there under
  // different classes. The panel's own `seg-group`s are the ★ pickers, one
  // per non-pink row, and the tab bar itself.
  check("and the sort lives on the headers, with no second switch under the tabs",
    (await sortedBy()) === "Spark:other" &&
    (await page.locator(".focus .proc-table thead .proc-h").count()) === 2 &&
    // The tab bar is the panel's only segmented control now: the row's ★
    // picker is gone, and the match rows' only appear while searching.
    (await page.locator(".focus .seg-group").count()) === 1 &&
    (await page.locator(".focus").evaluate((f) => {
      const tabs = f.querySelector(".focus-tabs");
      const table = f.querySelector(".proc-table");
      // Every element sat between the tab bar and the table, whatever it is.
      const between = [];
      for (let n = tabs.nextElementSibling; n && n !== table; n = n.nextElementSibling) {
        between.push(n.className);
      }
      return between.length;
    })) === 0);
  // NOTHING in the table can change a chance: the level is chosen on the
  // match row when the spark is added, and the table only shows it. That is
  // what lets both sorts stay live on a table you edit — a control that moved
  // a number would re-rank its own row out from under the pointer that
  // clicked it. Measured before this landed: index 2 → 0 while GROUPED (the
  // sort that was supposed to make it safe), 4 → 0 while ranked, with a
  // different spark left under the cursor both times.
  check("no control in the table can move a row",
    (await page.locator(".focus .proc-table .seg").count()) === 0 &&
    (await page.locator(".focus .proc-table button").count()) ===
      (await page.locator(".focus .proc-table .proc-drop").count()) +
        (await page.locator(".focus .proc-table thead .proc-h").count()));
  // Every row carries the level it was added at, glyphs on the pink and the
  // rest alike — the ✕ is the only thing that differs.
  check("every row shows the level it was added at",
    (await page.locator(".focus .proc-table tbody .proc-stars").count()) === added.length + 1 &&
    (await page.locator(".focus .proc-drop").count()) === added.length);
  // The pink carries no ✕, so its row has to hold that space anyway — or her
  // ★ run to the cell edge and the column stops lining up. Geometry, because
  // this is a claim about where things are drawn.
  check("the ★ line up down the column, ✕ or no ✕",
    await page.locator(".focus .proc-table tbody").evaluate((el) => {
      const rights = [...el.querySelectorAll(".proc-stars")].map(
        (s) => Math.round(s.getBoundingClientRect().right)
      );
      return rights.length > 1 && Math.max(...rights) - Math.min(...rights) <= 1;
    }));
  //
  // The table IS the editor: one row per spark, not a ranked row plus a
  // second entry in a differently-ordered held list 30px below it. Counted
  // over what the panel RENDERS — a check for an absent class name passes
  // whatever is on screen, and the class it named was deleted in the same
  // change that added the check.
  check("each spark is on the panel exactly once",
    (await page.locator(".focus .proc-table tbody tr").count()) === added.length + 1 &&
    (await Promise.all(
      added.map(async (r) =>
        (await page.locator(".focus", { hasText: r.name }).count()) > 0 &&
        (await page.locator(`.focus :text-is("${r.name.replace(/"/g, '\\"')}")`).count()) === 1
      )
    )).every(Boolean) &&
    // One ✕ per non-pink spark, and none anywhere but the rows.
    (await page.locator(".focus .proc-drop").count()) === added.length &&
    (await page.locator(".focus .proc-table .proc-drop").count()) === added.length);
  // ✕ removes it, from the same row that set its level — the held list's only
  // other job. Added and dropped again so the design is left as it was.
  const spare = factorRef.filter((f) => f.kind === "white").at(-1);
  // A DIFFERENT white from the one already held, or the add is a no-op and
  // the ✕ below waits 30s for a row that never appeared — a timeout on an
  // unrelated-looking selector instead of a readable failure here.
  check("the fixture has a second white to add and drop",
    spare !== undefined && spare.key !== pickOf("white").key);
  // Added at 3★ from the match row — one click, no land-at-1★-then-correct.
  // The level the button names is the level the estimate is computed from,
  // which is the whole of what moved out of the table.
  await addSpark("G1-1", spare, 3);
  const withSpare = await until(async () =>
    (await page.locator(".focus .proc-table tbody tr").count()) === added.length + 2);
  check("a spark added at 3★ from the match row lands at 3★",
    withSpare &&
    (await until(async () =>
      (await chanceOf(spare.name)) === pct(procPct("white", 3, expectedAff.g11_affinity)))) &&
    (await rowFor(spare.name).locator(".proc-level .proc-stars").textContent()) === "★★★");
  // And SURVIVES the save, which the rendered glyphs can't tell you: the
  // level is the one field whose default (1★) would mask a drop on the way
  // to the server, so a non-default one has to be read back from the API.
  await settled();
  const withThree = (await (await fetch(`${BASE}/api/blueprints`)).json())
    .find((b) => b.name === bpName);
  check("and the 3★ reaches the server as a 3★",
    (withThree?.slots.named[3]?.factors ?? []).some(
      (f) => f.kind === spare.kind && f.key === spare.key && f.stars === 3
    ));
  // A held spark answers its own search instead of vanishing from it —
  // typing a correct name and getting an empty box reads as "no such spark".
  await openChooser("G1-1");
  await page.locator('.spark-popout input[aria-label="G1-1 spark search"]').fill(spare.name);
  check("searching a spark you already hold says so, rather than nothing",
    (await until(async () => (await page.locator(".spark-held").count()) === 1)) &&
    (await page.locator(".spark-matches li", { hasText: spare.name })
      .locator(".seg").count()) === 0);
  // Favoriting is a separate control from adding, and adding never writes
  // one: a filler white typed onto every node must not reach #27's uncapped
  // watched block (DECISIONS.md #35).
  //
  // Read off the ACCESSIBLE state, not the class: the ★ is a disclosure for
  // the list picker now (#37), so it carries `aria-expanded` for the picker
  // and names its membership in the label. Asserting the class instead would
  // let the label silently stop reporting membership — which is exactly the
  // regression an earlier cut of this shipped.
  check("and adding a spark did not favorite it",
    (await page.locator(`.spark-fav[data-spark="${spare.kind}:${spare.key}"]`)
      .getAttribute("aria-label"))?.endsWith("in none") === true);

  // ---------- favorites and their lists ----------
  // Server state behind Access, unlike everything else this tab writes — so
  // it is read back from the API, and the list is tracked for cleanup at
  // creation rather than diffed at the end.
  //
  // Deliberately NOT a spark you already have: the pill is a toggle, so
  // running this against an existing favorite would assert on the wrong
  // direction. 432 factors, so there is always one.
  //
  // And never a GREEN: this runs on G1-1, which is cast, and a cast node
  // offers only its own card's unique — so a green target would simply not be
  // in the popout and the click below would hang for 30s and abort the run
  // before the cleanup that keeps this suite baseline-relative. Reachable
  // only on a database where every race and scenario spark is already
  // favorited, which is why it isn't what fails today.
  const favTarget = factorRef.find(
    (f) => f.kind !== "unique" && !baselineFavorites.has(`${f.kind}:${f.key}`)
  );
  const favSel = `${favTarget.kind}:${favTarget.key}`;
  await page.locator('.spark-popout input[aria-label="G1-1 spark search"]').fill(favTarget.name);
  // The ★ DISCLOSES the picker and writes nothing (#37) — a favorite is a
  // spark in a named list, so starring has to say which. By id, never by the
  // displayed name: the reference holds distinct factors that share one.
  // Snapshotted BEFORE the click so the assertion below compares real state
  // rather than a name that cannot exist yet.
  const listsBeforeStar = JSON.stringify(await getJson("/api/spark-lists"));
  await page.locator(`.spark-fav[data-spark="${favSel}"]`).click();
  await page.waitForSelector(`.spark-lists [aria-label="New list for ${favTarget.name}"]`);
  const listsNow = async () => await getJson("/api/spark-lists");
  const ourList = async () => (await listsNow()).find((l) => l.name === listName);
  // The WHOLE payload, compared against what it was before the click. The
  // first cut asserted that a list named with this run's fresh timestamp did
  // not exist yet, which is true by construction — it could never fail, so a
  // regression that made the ★ write membership into an EXISTING list would
  // have sailed past it.
  check("the star opens the list picker rather than writing anything",
    (await page.locator(`.spark-fav[data-spark="${favSel}"]`).getAttribute("aria-expanded")) === "true" &&
    JSON.stringify(await listsNow()) === listsBeforeStar);
  // Recorded first: the create writes a real row, and the wait below can time
  // out — which would jump to `finally` with nothing to clean up.
  listsOwned.add(listName);
  await page.locator(`[aria-label="New list for ${favTarget.name}"]`).fill(listName);
  await page.locator(`[aria-label="Create list for ${favTarget.name}"]`).click();
  // Creating from the picker puts the spark in the new list — you are in the
  // middle of starring something, so a list that came back empty would be a
  // second click for an outcome you already asked for.
  check("New List creates it AND puts the spark in it",
    await until(async () => {
      const list = await ourList();
      return list !== undefined &&
        list.sparks.length === 1 &&
        list.sparks[0].kind === favTarget.kind &&
        list.sparks[0].key === favTarget.key;
    }));
  // Resolved ONCE, and guarded: `check` records a failure and carries on, so
  // reading `.id` off an undefined list here would abort the whole run with a
  // TypeError and bury the assertion that actually broke. Everything below
  // needs the id, so a missing list skips the block rather than crashing it.
  const created = await ourList();
  const ourPill = created === undefined
    ? null
    : page.locator(
        `.spark-popout .spark-list-pill[data-list="${created.id}"][data-spark="${favSel}"]`
      );
  if (ourPill === null) {
    check("the list this run created is readable back", false);
  } else {
    check("and the star fills, and says so accessibly",
      (await until(async () =>
        (await ourPill.getAttribute("aria-pressed")) === "true")) &&
      // The label carries the membership, so a screen reader can tell a
      // favorited row from an unfavorited one without opening every picker.
      /in \d+ of \d+$/.test(
        (await page.locator(`.spark-fav[data-spark="${favSel}"]`)
          .getAttribute("aria-label")) ?? ""));
    // The pill is the membership editor, so one click takes it back out —
    // without deleting the list, which is a different act.
    await ourPill.click();
    check("and the pill takes it out again, leaving the list itself",
      await until(async () => {
        const list = await ourList();
        return list !== undefined && list.sparks.length === 0;
      }));
    // Put it back, so the Favorites assertions below have something to show.
    await ourPill.click();
    await until(async () => (await ourList())?.sparks.length === 1);
  }
  await closeChooser();
  // Favorites lift to their own section on the next open — and appear there
  // ONLY, never also in their kind's section: the same spark twice on one
  // surface is the duplication #45 deleted the held list to remove.
  await openChooser("G1-1");
  check("a favorite leads the chooser on the next open, and only once",
    (await page.locator(".spark-popout .spark-section-head").first().textContent()) === "Favorites" &&
    (await page.locator(`.spark-popout .spark-fav[data-spark="${favSel}"]`).count()) === 1);
  // Un-starring must not make the row disappear: membership in the Favorites
  // section is frozen for the life of the popout, so the star empties and
  // nothing moves. It used to vanish from both sections at once, leaving the
  // spark unaddable until the popout was reopened.
  const favStar = `.spark-popout .spark-fav[data-spark="${favSel}"]`;
  await page.locator(favStar).click();
  // The popout was remounted by the reopen, so the pill is looked up afresh
  // rather than reusing the locator above.
  //
  // BOUNDED AND NON-THROWING, like every other long wait in this file. Bare,
  // it takes the 30s default and then throws an UNCAUGHT TimeoutError, which
  // aborts the run and skips the ~1200 lines of designer coverage below —
  // whenever the create above failed, which is exactly when the guard on
  // `ourPill` was supposed to have contained the damage to one check.
  const reopenedPill = `.spark-popout .spark-list-pill[data-spark="${favSel}"].active`;
  const pillBack = await page
    .waitForSelector(reopenedPill, { timeout: 5000 })
    .then(() => true, () => false);
  check("the list pill comes back lit when the chooser reopens", pillBack);
  // It stays in the Favorites SECTION, not merely somewhere on screen: the
  // frozen membership is the whole point, and a row that fell back to its
  // kind section would have moved under the pointer that just clicked it.
  if (pillBack) {
    await page.locator(reopenedPill).first().click();
    check("and emptying its lists leaves the row where it is",
      (await until(async () => (await ourList())?.sparks.length === 0)) &&
      (await page.locator(favStar).count()) === 1 &&
      (await page.locator(".spark-popout .spark-section").first()
        .locator(`.spark-fav[data-spark="${favSel}"]`).count()) === 1);
  }
  await closeChooser();
  // Guarded: clicking unconditionally after a failed `until` aborts the run
  // and skips every assertion below it.
  if (withSpare) {
    // By id, not by the displayed name: the reference holds two distinct
    // whites both called "Pressure", so a name-matched ✕ is ambiguous the
    // moment a member carries both.
    await page
      .locator(`.focus .proc-row[data-spark="${spare.kind}:${spare.key}"] .proc-drop`)
      .click();
    check("and ✕ drops it from that row too",
      await until(async () =>
        (await page.locator(".focus .proc-table tbody tr").count()) === added.length + 1));
  }

  // The trainee's tab answers a different question: what she is likely to
  // come out with, per spark rather than per member.
  await selectNode("Trainee");
  check("the tab choice follows you between nodes",
    (await page.locator(".focus .proc-table").count()) === 1);
  const traineeRows = async () =>
    Promise.all(
      (await page.locator(".focus .proc-table tbody tr").all()).map(async (row) =>
        (await row.locator("td").allTextContents()).map((t) => t.trim()).join("|")
      )
    );
  // G1-1 and G1-2 both hold 3★ Mile, so it is ONE row, at the chance either
  // lands it — 1 − ∏(1−p), not the sum and not the larger.
  const bothMile =
    1 -
    (1 - procPct("pink", 3, expectedAff.g11_affinity)) *
      (1 - procPct("pink", 3, expectedAff.g12_affinity));
  // No star level on this table: the carriers can hold a spark at different
  // levels and the chance is the union across them, so a ★ figure beside it
  // would answer a different question from the number it sits next to.
  check(`a spark two members carry is one row at the combined ${pct(bothMile)}`,
    (await traineeRows()).includes(`Mile|${pct(bothMile)}`));
  check("and the trainee's rows carry no star level",
    (await page.locator(".focus .proc-table .proc-stars").count()) === 0);
  check("the combined chance beats either carrier alone but isn't their sum",
    bothMile > procPct("pink", 3, expectedAff.g11_affinity) &&
    bothMile <
      procPct("pink", 3, expectedAff.g11_affinity) +
        procPct("pink", 3, expectedAff.g12_affinity));
  // Order is by chance (asserted below), so this is the set, not a sequence.
  check("every kind reaches the roll-up",
    [...new Set(
      (await page.locator(".focus .proc-table tbody tr").evaluateAll((rows) =>
        rows.map((r) => [...r.classList].find((c) => c.startsWith("proc-row-")))
      ))
    )].sort().join(",") ===
      "proc-row-pink,proc-row-race,proc-row-scenario,proc-row-unique,proc-row-white");
  // Which members carry it is deliberately NOT here: this table answers what
  // the trainee is likely to come out with, and the breakdown is one click
  // away on each member's own tab.
  // Two columns and no member named anywhere in the body — asserted against
  // what the table RENDERS, not against a class a From column would have to
  // opt into. A check for an absent selector passes whatever is there.
  const traineeBody = await page.locator(".focus .proc-table tbody").textContent();
  check("no From column on the trainee's table",
    (await page.locator(".focus .proc-table thead th").count()) === 2 &&
    (await page.locator(".focus .proc-table tbody tr").first().locator("td").count()) === 2 &&
    !["P1", "P2", "G1-1", "G1-2", "G2-1", "G2-2"].some((m) => traineeBody.includes(m)));
  // Ranked, because the roll-up exists to be compared down.
  check("rows are ordered by chance",
    await page.locator(".focus .proc-table tbody").evaluate((el) => {
      const nums = [...el.querySelectorAll(".proc-chance")]
        .map((n) => Number(n.textContent.replace("%", "")))
        .filter((n) => !Number.isNaN(n));
      return nums.every((n, i) => i === 0 || nums[i - 1] >= n);
    }));
  // Said once, in the column header — and it says PER RUN, because the
  // difference between one inheritance event and the career's two is a factor
  // of nearly two on every row.
  check("the trainee's table labels the numbers estimates, per run, exactly once",
    (await page.locator(".focus .proc-table thead th").allTextContents()).join(",") ===
      "Spark,Est. Per Run");
  // The number rides on a bar filled in the spark's own colour, and the bar
  // is the chance: 0–100 absolutely, so an unlikely spark reads as a sliver
  // rather than filling because nothing beat it.
  const topRow = page.locator(".focus .proc-table tbody tr").first();
  check("each chance is drawn as a bar in its spark's colour",
    (await page.locator(".focus .proc-table .proc-bar").count()) ===
      (await page.locator(".focus .proc-table tbody tr").count()) &&
    (await topRow.locator(".proc-fill").getAttribute("class"))?.includes("proc-fill-pink"));
  check("the bar's width is the chance itself, not a rank",
    await topRow.locator(".proc-bar").evaluate((el) => {
      const pct = Number(el.querySelector(".proc-pct").textContent.replace("%", ""));
      const bar = el.getBoundingClientRect().width;
      const fill = el.querySelector(".proc-fill").getBoundingClientRect().width;
      // The top row is the highest chance; a table-relative scale would make
      // it full. Within a pixel of its own percentage instead.
      return Math.abs(fill - (bar * pct) / 100) < 1 && fill < bar * 0.9;
    }));
  // The proc table must not answer to the link table's selectors: those
  // checks assert the run decomposes into exactly seven links, and a second
  // table sharing their classes would silently break that claim.
  await openTab("Details");
  check("the affinity tab is unchanged underneath",
    (await page.locator(".focus .aff-links").count()) === 1 &&
    (await page.locator(".focus .proc-table").count()) === 0);
  // The sparks reach the server, or a reload would quietly lower every
  // estimate the design was judged on. Read from the API rather than by
  // reloading: this suite's later sections build on the page state as it is.
  await settled();
  const withSparks = (await (await fetch(`${BASE}/api/blueprints`)).json())
    .find((b) => b.name === bpName);
  // All four at 1★, the level their match buttons were clicked at — the 3★
  // path is covered above by the spare, which was added at 3★ and dropped
  // again so this snapshot stays the four.
  check("typed sparks are persisted with their kind and level on the member carrying them",
    JSON.stringify(withSparks?.slots.named[3]?.factors ?? []) ===
      JSON.stringify(added.map((r) => ({ kind: r.kind, key: r.key, stars: 1 }))));
  check("and land on nobody else",
    [0, 1, 2, 4, 5, 6].every(
      (i) => (withSparks?.slots.named[i]?.factors ?? []).length === 0));

  // A re-pick keeps them. They are plan inputs typed onto the node, not part
  // of the card's identity — rebuilding the slot without them deleted hand
  // entry silently, and the autosave then persisted the loss.
  await selectNode("Grandparent 1-1");
  await pickInto(G11);
  await settled();
  const rePicked = (await (await fetch(`${BASE}/api/blueprints`)).json())
    .find((b) => b.name === bpName);
  check("re-picking a character keeps the sparks typed on that node",
    JSON.stringify(rePicked?.slots.named[3]?.factors ?? []) ===
      JSON.stringify(withSparks?.slots.named[3]?.factors ?? []) &&
    (rePicked?.slots.named[3]?.factors ?? []).length === added.length);

  // Entry is offered on an ancestor with nobody cast and no score to roll
  // against — G2-1 is empty here, so its chances read "—" while its editor
  // works. Gating the tab on a score once put the only editor behind the
  // thing you hadn't decided yet.
  await selectNode("Grandparent 1-2");
  await openTab("Sparks");
  await openChooser("G1-2");
  await page.locator('.spark-popout input[aria-label="G1-2 spark search"]').fill(pickOf("white").name);
  await closeChooser();
  await selectNode("Grandparent 2-1");
  check("an uncast ancestor still offers spark entry",
    (await page.locator(".focus .spark-open").count()) === 1);
  // The chooser is per node, and remounts on every open: an abandoned query
  // must not follow you, or its leftover matches would add the spark to the
  // wrong member.
  await openChooser("G2-1");
  check("and an abandoned search doesn't follow you there",
    (await page.locator('.spark-popout input[aria-label="G2-1 spark search"]').inputValue()) === "" &&
    (await page.locator(".spark-popout .spark-section-head").count()) > 0);
  await closeChooser();
  await selectNode("Trainee");

  // ---------- the trainee's table folds by height ----------
  // A fully bred tree runs to ~34 distinct sparks, which is a panel 1.2x the
  // viewport. The fold is a 24rem CLIP, not a row count: every row is
  // rendered in the sort's own order and the panel shows the top of it, so
  // the fold selects nothing and cannot disagree with the sort. The cast so
  // far is short enough to fit, so this loads P2 up until it doesn't.
  await openTab("Sparks");
  // The clip is measured, so read the geometry rather than counting rows.
  const clipState = () =>
    page.locator(".focus .proc-clip").evaluate((el) => ({
      clipped: el.classList.contains("proc-clipped"),
      shown: Math.round(el.getBoundingClientRect().height),
      full: Math.round(el.querySelector(".proc-table").getBoundingClientRect().height),
      faded: getComputedStyle(el).maskImage !== "none" ||
        getComputedStyle(el).webkitMaskImage !== "none",
      // The clip is specified in rem, so the expected height is too.
      // Read from the same custom property the CSS clips by and the panel
      // measures against, so a change to the height can't leave this suite
      // asserting the old one.
      clip: (() => {
        const raw = getComputedStyle(el).getPropertyValue("--proc-clip").trim();
        const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return raw.endsWith("rem") ? parseFloat(raw) * root : parseFloat(raw);
      })(),
    }));
  const shortList = await page.locator(".focus .proc-row").count();
  const short = await clipState();
  check(`nothing is folded while the table fits (${shortList} rows, ${short.full}px)`,
    !short.clipped && !short.faded &&
    (await page.locator(".focus .proc-more").count()) === 0);
  // Distinct from anything already in the tree — slice past the white G1-1
  // holds, so every one of these adds a row rather than joining one.
  const filler = factorRef.filter((f) => f.kind === "white").slice(1, 10);
  await selectNode("Parent 2");
  await openTab("Sparks");
  for (const f of filler) {
    await addSpark("P2", f);
  }
  await selectNode("Trainee");
  await openTab("Sparks");
  const allRows = shortList + filler.length;
  check(`${allRows} sparks fold to a 24rem clip, with the rest behind a button`,
    await until(async () => {
      const c = await clipState();
      return c.clipped && c.shown < c.full &&
        Math.abs(c.shown - c.clip) <= 1 &&
        (await page.locator(".focus .proc-more").textContent()) === `Show All ${allRows}`;
    }));
  // Nothing is SELECTED — that is the whole point of folding by height. Every
  // row is in the DOM, in the sort's order; the clip only decides how much of
  // it you can see, so what's out of sight is always the bottom of the order
  // you chose rather than a slice taken on a different rule.
  check("every row is rendered, folded or not",
    (await page.locator(".focus .proc-row").count()) === allRows);
  check("and the cut row is faded rather than ending on a clean edge",
    (await clipState()).faded);
  // The trainee's ranking is real — hers is a union across carriers at
  // DIFFERENT affinities, so the ties that flatten an ancestor's table don't
  // happen here — which is why this table alone defaults to it.
  const rankedAll = await rowNames();
  check("the trainee's table defaults to ranking, where the ranking is real",
    (await sortedBy()) === "Est. Per Run:descending" &&
    (await page.locator(".focus .proc-table tbody").evaluate((el) => {
      const nums = [...el.querySelectorAll(".proc-pct")].map((n) =>
        Number(n.textContent.replace("%", ""))
      );
      return nums.every((n, i) => i === 0 || nums[i - 1] >= n);
    })));
  await setSort("kind");
  // The sort and the fold no longer interact: grouping reorders every row and
  // the clip still shows the top of whatever that order is.
  check("grouping reorders the whole table, and the fold still holds",
    (await page.locator(".focus .proc-row").count()) === allRows &&
    (await rowNames()).sort().join(",") === [...rankedAll].sort().join(",") &&
    (await clipState()).clipped &&
    (await page.locator(".focus .proc-more").textContent()) === `Show All ${allRows}` &&
    (await page.locator(".focus .proc-table tbody tr").evaluateAll((rows) => {
      const order = ["pink", "unique", "race", "white", "scenario"];
      const ks = rows.map((r) =>
        order.indexOf([...r.classList].find((c) => c.startsWith("proc-row-")).slice(9))
      );
      return ks.every((k, i) => i === 0 || ks[i - 1] <= k);
    })));
  await setSort("chance");
  await page.locator(".focus .proc-more").click();
  check("the button lifts the clip, and the fade with it",
    await until(async () => {
      const c = await clipState();
      return !c.clipped && !c.faded && c.shown === c.full &&
        (await page.locator(".focus .proc-more").textContent()) === "Show Fewer";
    }));
  await page.locator(".focus .proc-more").click();
  check("and folds it away again",
    await until(async () => {
      const c = await clipState();
      return c.clipped && c.shown < c.full;
    }));
  // Ancestor tables are never folded: a member holds a handful, and hiding
  // rows on the tab where you EDIT them would hide what you just typed.
  await selectNode("Parent 2");
  await openTab("Sparks");
  check("an ancestor's own table shows everything she carries",
    (await page.locator(".focus .proc-row").count()) === filler.length &&
    (await page.locator(".focus .proc-clip").count()) === 0 &&
    (await page.locator(".focus .proc-more").count()) === 0);
  await selectNode("Trainee");
  await openTab("Details");
  const stripMile = mapChip("Trainee").locator('.apt-cell[title^="Mile:"] b');
  check("map chip shows all ten labeled letters",
    (await mapChip("Trainee").locator(".apt-cell").count()) === 10 &&
    (await mapChip("Trainee").locator(".apt-cell-tag").first().textContent()) === "Turf");
  check("map chip groups: 2 track cells in head, 4+4 in rows",
    (await mapChip("Trainee").locator(".head .apt-cell").count()) === 2 &&
    (await mapChip("Trainee").locator(".apt-row").count()) === 2);
  check(`map chip mile = ${tMile}, boosted`,
    (await stripMile.textContent()) === tMile &&
    (await stripMile.getAttribute("class")).includes("boosted"));
  // Connector geometry: each kid's rail must reach its parent's centre, and
  // the parent's descender must come down to the same rail.
  const wires = await page.evaluate(() => {
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.left + r.right) / 2; };
    const parent = document.querySelector('.vped button[aria-label^="Trainee — "]');
    const kidL = document.querySelector('.vped button[aria-label^="Parent 1 — "]').closest(".cell");
    const kidR = document.querySelector('.vped button[aria-label^="Parent 2 — "]').closest(".cell");
    const railL = kidL.getBoundingClientRect();
    const railR = kidR.getBoundingClientRect();
    return {
      // The two half-rails meet where the parent's centre is.
      seam: Math.abs(railL.right - railR.left),
      centre: Math.abs(mid(parent) - (railL.right + railR.left) / 2),
      descender: getComputedStyle(parent, "::after").content !== "none",
      floor: getComputedStyle(
        document.querySelector(".cell.g4 .vnode"), "::after"
      ).content === "none",
    };
  });
  check("kid rails meet under the parent's centre",
    wires.seam <= 3 && wires.centre <= 2, JSON.stringify(wires));
  check("parents drop to the rail, gen 4 doesn't",
    wires.descender && wires.floor, JSON.stringify(wires));
  check("map chip carries the chara icon",
    (await mapChip("Trainee").locator(".head img, .head .lineage-icon-fallback").count()) === 1);
  check("trainee chip has no spark row",
    (await mapChip("Trainee").locator(".spark-row").count()) === 0);
  // Only the undroppable case is worth hovering, so every other row is
  // plain — no hidden text, nothing to hunt for.
  check("an un-flagged spark row carries no tooltip",
    (await mapChip("Parent 2").locator(".spark-row").getAttribute("title")) === null &&
    (await mapChip("Parent 2").locator(".spark-row.warn").count()) === 0);
  check("g11 chip spark row: name + 3/3 filled stars",
    (await mapChip("Grandparent 1-1").locator(".spark-row").textContent()).includes("Mile") &&
    (await mapChip("Grandparent 1-1").locator(".spark-row .star").count()) === 3 &&
    (await mapChip("Grandparent 1-1").locator(".spark-row .star.filled").count()) === 3);

  // ---------- deep spark slots drive P1's brackets to 10★ ----------
  await selectNode("Sparks 3-1");
  check("spark slot panel is name + editor only",
    (await page.locator(".focus-name").textContent()) === "Sparks 3-1" &&
    (await page.locator(".focus .focus-role, .focus .focus-legend").count()) === 0);
  await setSpark("Sparks 3-1", "mile", 3);
  check("spark chip shows the spark",
    (await mapChip("Sparks 3-1").getAttribute("aria-label")) === "Sparks 3-1 — 3★ Mile");
  await selectNode("Sparks 3-3");
  await setSpark("Sparks 3-3", "mile", 1);
  await selectNode("Parent 1");
  check(`p1 mile capped at A (10★ on base ${P1.apt.mile})`,
    (await rowLetter("Mile")) === boost(P1.apt.mile, 10));
  check(`p1 mile From = ${fromText(P1.apt.mile, 10)}`,
    (await rowFrom("Mile")) === fromText(P1.apt.mile, 10), await rowFrom("Mile"));

  // ---------- past the 10★ max: counted, never warned about ----------
  await selectNode("Sparks 3-2");
  await setSpark("Sparks 3-2", "mile", 2);
  check("deep chip stars: 2 of 3 filled",
    (await mapChip("Sparks 3-2").locator(".star").count()) === 3 &&
    (await mapChip("Sparks 3-2").locator(".star.filled").count()) === 2);
  await selectNode("Parent 1");
  check(`p1 mile From shows the raw 12★: ${fromText(P1.apt.mile, 12)}`,
    (await rowFrom("Mile")) === fromText(P1.apt.mile, 12), await rowFrom("Mile"));
  check("no over-10★ warning anywhere",
    !(await rowFrom("Mile")).includes("over 10") &&
    (await page.locator(".apt-over, .node-warn:not(.red)").count()) === 0);

  // ---------- past the A cap: counted, and stated as bought nothing ----------
  // Stars the ceiling cannot absorb are still not warned about — overstacking
  // is usually deliberate, since every matching spark is an independent
  // inspiration ticket toward S. What the row must not do is claim a gain it
  // did not make: 3★ on a base already at A reads +0, not +1 (issue #42).
  await selectNode("Sparks 3-4");
  await setSpark("Sparks 3-4", aptA, 3);
  await selectNode("Parent 1");
  check(`p1 ${aptA} stays A`, (await rowLetter(LABEL[aptA])) === "A");
  check("the row reports the stars behind it and the nothing they bought",
    (await rowFrom(LABEL[aptA])) === "3★ → +0 (at cap)",
    await rowFrom(LABEL[aptA]));
  check("the cap note is a note, not a warning",
    !(await rowFrom(LABEL[aptA])).includes("past A") &&
    (await aptRow(LABEL[aptA]).locator(".apt-cap").count()) === 1 &&
    (await aptRow(LABEL[aptA]).locator(".node-warn, .spark-warn, .apt-over").count()) === 0);
  check("a letter that never moved is not highlighted as boosted",
    (await aptRow(LABEL[aptA]).locator(".apt-final.boosted").count()) === 0);

  // ---------- G11's own window: gen-3/4 sparks only ----------
  await selectNode("Sparks 4-1");
  await setSpark("Sparks 4-1", "long", 2);
  check("gen-4 chip shows the spark",
    (await mapChip("Sparks 4-1").getAttribute("aria-label")) === "Sparks 4-1 — 2★ Long");
  await selectNode("Grandparent 1-1");
  check(`g11 mile from its deep slots (5★)`,
    (await rowLetter("Mile")) === boost(G11.apt.mile, 5));
  check(`g11 mile From = ${fromText(G11.apt.mile, 5)}`,
    (await rowFrom("Mile")) === fromText(G11.apt.mile, 5), await rowFrom("Mile"));
  check(`g11 long from its gen-4 slot`,
    (await rowLetter("Long")) === boost(G11.apt.long, 2));

  // ---------- undroppable typed spark on P2 ----------
  await selectNode("Parent 2");
  await setSpark("Parent 2", aptLow, 3);
  await page.waitForSelector(".spark-warn");
  check("undroppable warning shown",
    (await page.locator(".spark-warn").textContent()).includes("only drop at A"));
  check("p2 map chip carries the red badge",
    (await mapChip("Parent 2").locator(".node-warn.red").count()) === 1);
  check("p2's spark row is flagged and carries the only chip tooltip",
    (await mapChip("Parent 2").locator(".spark-row.warn").count()) === 1 &&
    (await mapChip("Parent 2").locator(".spark-row").getAttribute("title")) ===
      `${LABEL[aptLow]} resolves below A — pinks only drop at A.`);

  // ---------- the map is the only navigation ----------
  await selectNode("Trainee");
  check("panel carries no duplicate lineage list",
    (await page.locator(".focus h4", { hasText: /parents|Feeds into/ }).count()) === 0);
  await mapChip("Parent 1").click();
  check("map chip navigates to P1",
    (await page.locator(".focus-name").textContent()) === P1.entry.name);

  // ---------- autosave: no Save button anywhere ----------
  check("the bar offers no Save button — autosave owns it",
    (await page.locator(".designer-save button", { hasText: /^Save/ }).count()) === 0);
  await selectNode("Sparks 3-8");
  await setSpark("Sparks 3-8", "dirt", 1);
  check("autosave announces itself",
    (await page.locator(".designer-autosave").textContent()) === "Saving…");
  await settled();
  const stored = await (await fetch(`${BASE}/api/blueprints`)).json();
  const mine = stored.find((b) => b.name === bpName);
  check("autosave reached the server without a click",
    mine?.slots?.sparks?.some((s) => s?.aptitude === "dirt" && s?.stars === 1) === true,
    JSON.stringify(mine?.slots?.sparks?.filter(Boolean)));

  // ---------- reload reopens the same blueprint ----------
  await page.reload();
  await page.waitForSelector(".designer-autosave", { timeout: 5000 });
  await page.waitForFunction(
    (name) => document.querySelector('.vped button[aria-label^="Trainee — "]')
      ?.getAttribute("aria-label")?.includes(name) === true,
    T.entry.name,
    { timeout: 5000 }
  );
  check("reload reopens the blueprint that was open",
    (await pickerLabel()) === bpName &&
    (await mapChip("Sparks 3-1").getAttribute("aria-label")) === "Sparks 3-1 — 3★ Mile");

  // Switch away and back, so the design comes from the server rather than
  // from the page's own state.
  await newBlueprint();
  await page.waitForFunction(() => document.querySelectorAll(".vped .vnode.pick").length === 31);
  const scratchName = await pickerLabel();
  check("+ New Blueprint opens a blank, server-backed row",
    scratchName.startsWith("Untitled Blueprint") &&
    (await (await fetch(`${BASE}/api/blueprints`)).json()).some((b) => b.name === scratchName));
  check("the current blueprint isn't repeated in the menu's list",
    await (async () => {
      await openPicker();
      const rows = await page.locator(".bp-menu button.bp-row").allTextContents();
      await closePicker();
      return !rows.includes(scratchName) && rows.filter((r) => r === bpName).length === 1;
    })());
  await switchTo(bpName);
  await page.waitForFunction(
    (want) => document.querySelector(".focus-name")?.textContent !== want,
    "Trainee" // any load flips the trainee panel from its empty state
  );
  check("loaded: trainee restored",
    (await mapChip("Trainee").getAttribute("aria-label")).includes(T.entry.name));
  check("loaded: p1 restored",
    (await mapChip("Parent 1").getAttribute("aria-label")).includes(P1.entry.name));
  check("loaded: deep spark restored",
    (await mapChip("Sparks 3-1").getAttribute("aria-label")) === "Sparks 3-1 — 3★ Mile");
  check("loaded: red badge restored",
    (await mapChip("Parent 2").locator(".node-warn.red").count()) === 1);
  await selectNode("Sparks 3-1");
  check("loaded: spark editor state restored",
    (await page.locator('select[aria-label="Sparks 3-1 pink spark"]').inputValue()) === "mile");
  check("loaded: the picker names it", (await pickerLabel()) === bpName);

  // ---------- duplicate ----------
  await barButton("Duplicate").click();
  await page.waitForFunction(
    (n) => document.querySelector(".bp-field .designer-name")?.value === n,
    `${bpName} (copy)`,
    { timeout: 5000 }
  );
  await settled();
  const afterCopy = await (await fetch(`${BASE}/api/blueprints`)).json();
  const dupe = afterCopy.find((b) => b.name === `${bpName} (copy)`);
  check("duplicate carries the design and leaves the original alone",
    dupe?.slots?.named?.[0]?.chara_id === T.entry.chara_id &&
    dupe?.slots?.sparks?.[0]?.aptitude === "mile" &&
    afterCopy.some((b) => b.name === bpName));
  await barButton("Delete").click();
  await page.waitForFunction(
    (n) => document.querySelector(".bp-field .designer-name")?.value !== n,
    `${bpName} (copy)`,
    { timeout: 5000 }
  );
  check("the duplicate deletes without touching the original",
    (await (await fetch(`${BASE}/api/blueprints`)).json())
      .filter((b) => b.name.startsWith(bpName)).map((b) => b.name).join() === bpName);
  await switchTo(bpName);

  // ---------- route round-trip keeps the working design ----------
  await page.locator(".nav a", { hasText: "Roster" }).click();
  // Wait on having *left* the designer, not on any roster content: the
  // roster's docks are gated on `veterans.length > 0`, so keying off one
  // (`.pill-dock`) only worked against an already-imported roster and hung
  // on an empty database — which is exactly what CI has.
  await page.waitForURL((u) => new URL(u).pathname === "/");
  await page.locator(".designer").waitFor({ state: "detached" });
  await page.locator(".nav a", { hasText: "Designer" }).click();
  await page.waitForSelector(".designer");
  // `.designer` mounts before its blueprint has been fetched, so reading the
  // chip straight away races the hydration — it passed only because waiting
  // on roster content used to spend that time on the way out. Poll instead of
  // sampling once; `until` returns a boolean, so a genuine loss still fails
  // this check by name rather than throwing.
  check("design survives route round-trip",
    await until(async () =>
      ((await mapChip("Parent 1").getAttribute("aria-label")) ?? "").includes(P1.entry.name)
    ),
    await mapChip("Parent 1").getAttribute("aria-label"));
  check("name survives route round-trip",
    await until(async () => (await pickerLabel()) === bpName),
    await pickerLabel());

  // ---------- clear drops only the node itself ----------
  await selectNode("Grandparent 1-2");
  await page.locator('button[aria-label="Clear Grandparent 1-2"]').click();
  check("cleared g12",
    (await mapChip("Grandparent 1-2").getAttribute("aria-label")) === "Grandparent 1-2 — empty");
  // Read in the same breath as the clear, before the debounced re-score can
  // land: an emptied node must drop its affinity immediately rather than keep
  // showing what its previous occupant earned. Gating the tile on the CURRENT
  // design is what makes the assertion above safe too — otherwise the label
  // carries a stale "· affinity N" suffix and that check flakes by machine
  // speed.
  check("and drops its affinity at once, without waiting for the re-score",
    (await mapChip("Grandparent 1-2").locator(".aff-chip b.blank").count()) === 1);
  check("clearing g12 keeps the deep sparks",
    (await mapChip("Sparks 3-1").getAttribute("aria-label")) === "Sparks 3-1 — 3★ Mile");
  await selectNode("Parent 1");
  check(`p1 mile re-brackets to ${fromText(P1.apt.mile, 9)}`,
    (await rowFrom("Mile")) === fromText(P1.apt.mile, 9), await rowFrom("Mile"));

  // ---------- delete, from the bar's icon ----------
  await barButton("Delete").click();
  await page.waitForFunction(
    (n) => document.querySelector(".bp-field .designer-name")?.value !== n,
    bpName,
    { timeout: 5000 }
  );
  const afterDelete = await (await fetch(`${BASE}/api/blueprints`)).json();
  check("deleted: gone from the server, another blueprint opened",
    !afterDelete.some((b) => b.name === bpName) && (await pickerLabel()).length > 0);
  check("deleted: a blueprint is always open", afterDelete.length > 0);

  // ---------- a spark before a character ----------
  // Work in a fresh blueprint so the previous design can't colour these.
  await newBlueprint();
  await rename(`${bpName} sparks-first`);
  // Plan the pink you're hunting first; the cast comes later.
  await selectNode("Parent 1");
  await setSpark("Parent 1", "turf", 2);
  check("spark typed into an empty parent shows on its chip",
    (await mapChip("Parent 1").getAttribute("aria-label")) === "Parent 1 — 2★ Turf" &&
    (await mapChip("Parent 1").locator(".spark-row .star.filled").count()) === 2);
  check("the node is still castable", (await page.locator(".focus-pick").count()) === 1);
  check("Clear offered for a spark with no character",
    (await page.locator('button[aria-label="Clear Parent 1"]').count()) === 1);
  await selectNode("Trainee");
  await pickInto(T);
  check("trainee brackets count the character-less spark",
    (await rowFrom("Turf")) === fromText(T.apt.turf, 2), await rowFrom("Turf"));

  // It has to survive the API, not just the client.
  await settled();
  await page.reload();
  await page.waitForSelector(".designer-autosave", { timeout: 5000 });
  await newBlueprint();
  await page.waitForFunction(() => document.querySelectorAll(".vped .vnode.pick").length === 31);
  await switchTo(`${bpName} sparks-first`);
  const sparkRoundTripped = await page
    .waitForFunction(
      () => document.querySelector('.vped button[aria-label="Parent 1 — 2★ Turf"]') !== null,
      null,
      { timeout: 5000 }
    )
    .then(() => true, () => false);
  check("character-less spark round-trips through the API", sparkRoundTripped);
  // Casting into it keeps the planned spark.
  await selectNode("Parent 1");
  await pickInto(P1);
  check("casting a character keeps the planned spark",
    (await page.locator('select[aria-label="Parent 1 pink spark"]').inputValue()) === "turf");
  // Clear on a deep slot drops its spark (and only its spark).
  await selectNode("Sparks 3-1");
  check("no Clear on an untouched spark slot",
    (await page.locator('button[aria-label="Clear Sparks 3-1"]').count()) === 0);
  await setSpark("Sparks 3-1", "long", 1);
  await page.locator('button[aria-label="Clear Sparks 3-1"]').click();
  check("Clear empties a deep spark slot",
    (await mapChip("Sparks 3-1").getAttribute("aria-label")) === "Sparks 3-1 — empty" &&
    (await mapChip("Parent 1").getAttribute("aria-label")).includes(P1.entry.name));

  // ---------- No Character: the face comes off, the sparks stay ----------
  // The first chip in the picker Replace opens, because taking her off is an
  // answer to the question it asks. Clear can't give you that state — it
  // empties the node, so the pink you were hunting goes with a character you
  // only meant to take out of the plan.
  const openReplace = async () => {
    await page.locator('.focus-actions button[aria-label^="Replace "]').click();
    await page.waitForSelector(".designer-picker");
  };
  const pickNoCharacter = async () => {
    await openReplace();
    await page.locator(".picker-unselect").click();
    await page.waitForSelector(".designer-picker", { state: "detached" });
  };
  await selectNode("Trainee");
  await openReplace();
  check("not offered where the node has nothing to keep — that is just Clear",
    (await page.locator(".picker-unselect").count()) === 0);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".designer-picker", { state: "detached" });
  await selectNode("Parent 1");
  await pickNoCharacter();
  check("No Character drops the character and keeps the pink",
    (await mapChip("Parent 1").getAttribute("aria-label")) === "Parent 1 — 2★ Turf");
  check("leaving the node castable again",
    (await page.locator(".focus-pick").count()) === 1);
  check("with the spark still in its editor",
    (await page.locator('select[aria-label="Parent 1 pink spark"]').inputValue()) === "turf");
  // A deep slot has the same two halves and the same rule.
  await selectNode("Sparks 3-1");
  await setSpark("Sparks 3-1", "long", 1);
  await pickInto(T);
  check("a deep slot takes a face on top of its pink", await hasFace("Sparks 3-1"));
  await pickNoCharacter();
  check("and No Character takes it off, keeping the pink",
    (await mapChip("Sparks 3-1").getAttribute("aria-label")) === "Sparks 3-1 — 1★ Long" &&
    !(await hasFace("Sparks 3-1")));
  // Put P1 back: the sections below still expect her in the node.
  await selectNode("Parent 1");
  await pickInto(P1);
  check("re-casting keeps the spark that was left behind",
    (await page.locator('select[aria-label="Parent 1 pink spark"]').inputValue()) === "turf");

  // ---------- responsive ----------
  await page.setViewportSize({ width: 800, height: 900 });
  const columns = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".designer-combo")).gridTemplateColumns
      .split(" ").length
  );
  check("≤860px: map collapses above the panel", columns === 1, `columns=${columns}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check("390px: no page-level horizontal overflow", overflow <= 1, `overflow=${overflow}px`);

  // Narrow screens show one parent's half at a time: trainee + 15 nodes.
  await page.waitForSelector(".vped.half");
  check("390px: half tree renders 16 nodes",
    (await page.locator(".vped .vnode").count()) === 16);
  check("390px: side toggle offers both parents",
    (await page.locator(".side-toggle .seg").count()) === 2);
  const segs = await page.evaluate(() => {
    const wrap = document.querySelector(".tree-map-wrap").clientWidth;
    const [a, b] = [...document.querySelectorAll(".side-toggle .seg")]
      .map((s) => s.getBoundingClientRect().width);
    return { wrap, a: Math.round(a), b: Math.round(b) };
  });
  check("390px: toggle spans the map, halves equal",
    Math.abs(segs.a + segs.b - segs.wrap) <= 3 && Math.abs(segs.a - segs.b) <= 1,
    JSON.stringify(segs));
  // Scrolled down among the grandparents, the toggle must still say which
  // half is on screen.
  await page.evaluate(() => window.scrollTo(0, 600));
  const stuck = await page.evaluate(() => {
    const t = document.querySelector(".side-toggle").getBoundingClientRect();
    return { top: Math.round(t.top), visible: t.bottom > 0 && t.top < window.innerHeight };
  });
  check("390px: toggle sticks to the top while scrolling",
    stuck.visible && stuck.top <= 1, JSON.stringify(stuck));
  await page.evaluate(() => window.scrollTo(0, 0));

  // A map tap pans to the panel: the detail is otherwise below the fold.
  // (It stops at the document's end when the panel is short — what matters
  // is that the panel ends up on screen, not that it reaches the top.)
  const panelOffscreenBefore = await page.evaluate(() => {
    const r = document.querySelector(".focus").getBoundingClientRect();
    return r.top >= window.innerHeight;
  });
  await mapChip("Grandparent 1-1").click();
  // The wait IS the assertion, so let it resolve to a boolean: throwing here
  // would abort the remaining checks and report a pan regression as a crash,
  // and asserting `panelOffscreenBefore` alone only re-states the precondition.
  const panned = await page
    .waitForFunction(() => {
      const r = document.querySelector(".focus").getBoundingClientRect();
      return window.scrollY > 0 && r.top < window.innerHeight && r.bottom > 0;
    }, null, { timeout: 5000 })
    .then(() => true, () => false);
  check("390px: tapping a node pans the panel into view", panelOffscreenBefore && panned,
    `offscreen-before=${panelOffscreenBefore} panned=${panned}`);
  check("390px: the sticky toggle doesn't cover the panel",
    await page.evaluate(() => {
      const t = document.querySelector(".side-toggle").getBoundingClientRect();
      const f = document.querySelector(".focus").getBoundingClientRect();
      return f.top >= t.bottom - 1;
    }));
  await page.evaluate(() => window.scrollTo(0, 0));
  check("390px: showing the selected node's half",
    (await mapChip("Parent 1").count()) === 1 && (await mapChip("Parent 2").count()) === 0);
  await page.locator(".side-toggle .seg").nth(1).click();
  await page.waitForSelector('.vped button[aria-label^="Parent 2 — "]');
  check("390px: toggle swaps to the other half",
    (await mapChip("Parent 1").count()) === 0 &&
    (await mapChip("Grandparent 2-1").count()) === 1 &&
    (await mapChip("Grandparent 1-1").count()) === 0);
  // The design is empty by this point, so the panel names the slot itself.
  check("390px: toggle focuses that parent in the panel",
    (await page.locator(".focus-name").textContent()) === "Parent 2");
  // Selecting inside the shown half keeps that half up.
  await mapChip("Grandparent 2-1").click();
  check("390px: selecting within the half keeps it shown",
    (await page.locator(".vped .vnode.sel").count()) === 1 &&
    (await mapChip("Parent 2").count()) === 1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForSelector(".vped:not(.half)");
  check("wide again: full 31-node tree, no toggle",
    (await page.locator(".vped .vnode").count()) === 31 &&
    (await page.locator(".side-toggle").count()) === 0);

  // ---------- roster pulls: two generations from one pick ----------
  if (!rosterReady) {
    console.log("  skip: roster pull checks (no usable roster — see the baseline line above)");
  } else {
    const P10 = memberAt(RV1, 10);
    const P20 = memberAt(RV1, 20);
    await newBlueprint();
    await rename(`${bpName} roster`);
    await selectNode("Parent 1");
    // Unlike the trainee's, a parent's picker offers both sources — with
    // catalog selected, so a plan that starts from the pinks you're hunting
    // still works against an empty roster.
    await page.locator(".focus-pick").click();
    await page.waitForSelector(".designer-picker");
    check("a parent's picker offers both sources",
      JSON.stringify(
        await page.locator(".designer-picker .picker-source .seg").allTextContents()
      ) === JSON.stringify(["Catalog", "My Roster"]));
    check("with catalog the default",
      JSON.stringify(
        await page.locator(".designer-picker .picker-source .seg.active").allTextContents()
      ) === JSON.stringify(["Catalog"]));

    // ---------- the picker keeps its filters, under its own key ----------
    // Filling 31 nodes against one criterion is the most repeated work in the
    // designer, and the picker used to reset to the defaults on every open.
    const filterBadge = () => page.locator(".picker-dock .filter-float .filter-count");
    const openPickerFilters = async () => {
      await page.locator(".picker-dock .filter-float").click();
      await page.waitForSelector(".picker-filters .filter-panel");
    };
    // Escape inside the filter panel closes IT, not the picker underneath.
    const closePickerFilters = async () => {
      await page.keyboard.press("Escape");
      await page.waitForSelector(".picker-filters", { state: "detached" });
    };
    const toRosterTab = async () => {
      await page.locator(".picker-source .seg", { hasText: "My Roster" }).click();
      await page.waitForSelector(".picker-dock");
    };
    const pickerSort = () => page.locator('.picker-dock select[aria-label="Sort Roster By"]');
    await toRosterTab();
    check("the picker opens on the roster's own default sort",
      (await pickerSort().inputValue()) === "register_time");
    await pickerSort().selectOption("blue_spark");
    await openPickerFilters();
    // A pink chip, not a roster-derived one: the ten are static, so this
    // doesn't depend on what your dump happens to hold.
    await page.locator(".picker-filters .fchip.pink", { hasText: "Turf" }).first().click();
    await closePickerFilters();
    check("the picker badges the filters it has applied",
      (await filterBadge().textContent()) === "1");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".designer-picker", { state: "detached" });
    await page.locator(".focus-pick").click();
    await page.waitForSelector(".designer-picker");
    await toRosterTab();
    check("and still has them on the next open",
      (await filterBadge().textContent()) === "1");
    check("along with the sort it was left on",
      (await pickerSort().inputValue()) === "blue_spark");
    // The half of the original rule that still holds: the two filter sets are
    // independent in both directions, so narrowing the picker must not reach
    // the roster page you go back to.
    check("without touching the roster page's own filters",
      await page.evaluate(() => {
        const raw = localStorage.getItem("umalab.filters");
        return raw === null || !JSON.parse(raw).pink.names.includes("Turf");
      }));

    // ---------- Legacy Sparks stops at the parents ----------
    if (gpOnlySpark === undefined || reachableSpark === undefined) {
      console.log("  skip: legacy-pool check (no grandparent-only spark in this roster)");
    } else {
      await openPickerFilters();
      await page.locator(".picker-filters .fchip", { hasText: "Choose Sparks" }).click();
      const popout = page.locator('.picker-filters .uma-popout[aria-label="Choose Common Sparks"]');
      await popout.waitFor();
      await popout.locator(".uma-search").fill(reachableSpark);
      check("the spark chooser offers a name the veteran or her parents carry",
        (await popout.locator(`.fchip:text-is(${JSON.stringify(reachableSpark)})`).count()) === 1,
        reachableSpark);
      await popout.locator(".uma-search").fill(gpOnlySpark);
      // By exact chip text, not "the list is empty": the query is a substring
      // match, so a longer name containing this one would leave a row behind
      // and the emptiness check would fail for the wrong reason.
      check("but never one only a grandparent carries — it can't be inherited from her",
        (await popout.locator(`.fchip:text-is(${JSON.stringify(gpOnlySpark)})`).count()) === 0,
        gpOnlySpark);
      await page.keyboard.press("Escape");
      await popout.waitFor({ state: "detached" });
      await closePickerFilters();
    }

    // Put the picker back the way the rest of the section expects it. Nothing
    // leaks past the run — the context is fresh each time, so this storage is
    // the suite's own — but the pulls below pick from this list.
    await openPickerFilters();
    await page.locator(".picker-filters .filter-clear").click();
    await closePickerFilters();
    check("and Reset Filters clears them again", (await filterBadge().count()) === 0);
    await pickerSort().selectOption("register_time");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".designer-picker", { state: "detached" });

    // Into an empty tree: nothing hand-authored is at risk, so the pull must
    // not stop to ask. A dialog on the fast path is how people learn to
    // dismiss the one that matters.
    const quiet = await pullInto(RV1);
    check("a pull into empty nodes fills silently", quiet === null, String(quiet));
    check("the pulled veteran lands in the node you picked",
      (await mapChip("Parent 1").getAttribute("aria-label")) === `Parent 1 — ${RV1.name}`);
    check("the pull brings the veteran's own pink with it",
      (await mapChip("Parent 1").locator(".spark-row").textContent())
        .includes(LABEL[pinkOf(RV1.factors).aptitude]));

    // The generation mapping, which is the one thing easy to get wrong: a
    // blueprint grandparent is the parent veteran's PARENT (succession
    // position 10/20), never its grandparent. 11/12/21/22 go a generation
    // deeper, into the anonymous spark slots.
    check("position 10 becomes Grandparent 1-1",
      (await mapChip("Grandparent 1-1").getAttribute("aria-label")) ===
        `Grandparent 1-1 — ${P10.name}`);
    check("position 20 becomes Grandparent 1-2",
      (await mapChip("Grandparent 1-2").getAttribute("aria-label")) ===
        `Grandparent 1-2 — ${P20.name}`);
    const deep = [
      ["Sparks 3-1", 11], ["Sparks 3-2", 12], ["Sparks 3-3", 21], ["Sparks 3-4", 22],
    ];
    for (const [node, position] of deep) {
      check(`position ${position} becomes ${node}`,
        (await mapChip(node).getAttribute("aria-label")) ===
          `${node} — ${deepLabel(memberAt(RV1, position))}`,
        await mapChip(node).getAttribute("aria-label"));
    }
    // Nothing is invented below what the dump carries: a veteran stores two
    // generations, so generation 4 gets no data from a parent-level pull.
    check("the pull puts nothing in generation 4 — the dump doesn't reach it",
      (await mapChip("Sparks 4-1").getAttribute("aria-label")) === "Sparks 4-1 — empty");
    check("and it touches nothing on the other parent's side",
      (await mapChip("Parent 2").getAttribute("aria-label")) === "Parent 2 — empty" &&
      (await mapChip("Grandparent 2-1").getAttribute("aria-label")) ===
        "Grandparent 2-1 — empty");

    // Generation 3 has no room on the map for a name, so the identity the
    // pull carried is shown here or nowhere.
    await selectNode("Sparks 3-1");
    check("a pulled deep slot names who it is",
      (await page.locator(".focus-role").textContent()).includes(memberAt(RV1, 11).name));

    // It has to survive the API, not just the client. The stored document is
    // checked directly: the map can only show what a slot renders as, not
    // whether the snapshot carried the wins and the backing veteran.
    await settled();
    const storedRoster = (await rows()).find((b) => b.name === `${bpName} roster`);
    const s1 = storedRoster?.slots?.named?.[1];
    const s3 = storedRoster?.slots?.named?.[3];
    check("the roster slot persists its source and backing veteran",
      s1?.source === "roster" && s1?.trained_chara_id === RV1.trained_chara_id &&
      s1?.card_id === RV1.card_id,
      JSON.stringify(s1));
    check("won saddles ride in the snapshot, not re-read from the roster",
      JSON.stringify(s1?.win_saddle_ids) === JSON.stringify(RV1.win_saddles),
      JSON.stringify(s1?.win_saddle_ids));
    check("the lineage slot persists which succession position it came from",
      s3?.source === "lineage" && s3?.position_id === 10 &&
      s3?.trained_chara_id === RV1.trained_chara_id && s3?.card_id === P10.card_id,
      JSON.stringify(s3));
    check("a pulled generation-3 spark keeps the identity it arrived with",
      storedRoster?.slots?.sparks?.[0]?.card_id === memberAt(RV1, 11).card_id,
      JSON.stringify(storedRoster?.slots?.sparks?.[0]));

    // Switch away and back so the design comes from the server, not from the
    // page's own state. Polled, not sampled: `.designer` re-renders before
    // the fetch lands (the PR #20 hydration race).
    await newBlueprint();
    await page.waitForFunction(() => document.querySelectorAll(".vped .vnode.pick").length === 31);
    await switchTo(`${bpName} roster`);
    check("a pulled design round-trips through the API",
      await until(async () =>
        (await mapChip("Grandparent 1-1").getAttribute("aria-label")) ===
          `Grandparent 1-1 — ${P10.name}`),
      await mapChip("Grandparent 1-1").getAttribute("aria-label"));
    check("and the deep slots come back with it",
      (await mapChip("Sparks 3-3").getAttribute("aria-label")) ===
        `Sparks 3-3 — ${deepLabel(memberAt(RV1, 21))}`);

    // ---------- a pulled branch is read-only ----------
    // Everything under a real veteran is her recorded pedigree, so it can't
    // be edited — the controls are gone, not merely ignored.
    await selectNode("Grandparent 1-1");
    check("a pulled branch offers no Replace or Clear",
      (await page.locator(".focus-actions button").count()) === 0 &&
      (await page.locator(".focus-pick").count()) === 0);
    check("and no spark editor — that pink is the horse's own",
      (await page.locator('select[aria-label="Grandparent 1-1 pink spark"]').count()) === 0 &&
      (await page.locator(".spark-static").count()) === 1);
    // Her sparks tab is the same two-column readout it always was: the ★
    // control folded into the row on nodes you BUILD, and a pulled branch
    // builds nothing. No level column, no ✕, no search box.
    await page.locator(".focus-tabs .focus-tab", { hasText: "Sparks" }).click();
    check("her sparks are a readout, with no controls anywhere on the table",
      (await page.locator(".focus .proc-table tbody tr").count()) > 0 &&
      (await page.locator(".focus .proc-level").count()) === 0 &&
      (await page.locator(".focus .proc-drop").count()) === 0 &&
      (await page.locator(".focus .spark-add").count()) === 0 &&
      (await page.locator(".focus .proc-table tbody tr").first().locator("td").count()) === 2);
    // The level still reads on the row, as glyphs in the name cell — the
    // shape this table has always had.
    check("and each row still carries the level it was pulled with",
      (await page.locator(".focus .proc-table tbody .proc-stars").count()) ===
        (await page.locator(".focus .proc-table tbody tr").count()));
    await page.locator(".focus-tabs .focus-tab", { hasText: "Details" }).click();
    check("the panel says whose pedigree it is",
      (await page.locator(".focus-note").textContent()).includes("Parent 1"));
    await selectNode("Parent 1");
    check("the veteran herself keeps Replace and Clear",
      (await page.locator(".focus-actions button").count()) === 2);
    // Her sparks are her own, read off the dump, so taking just her face off
    // would leave someone else's sparks under nobody. Clearing the branch is
    // the way out of a pull.
    await openReplace();
    check("but her picker offers no No Character chip",
      (await page.locator(".picker-unselect").count()) === 0);
    await page.keyboard.press("Escape");
    await page.waitForSelector(".designer-picker", { state: "detached" });
    check("but not her spark editor",
      (await page.locator('select[aria-label="Parent 1 pink spark"]').count()) === 0);

    // ---------- pulling into a grandparent reaches generation 4 ----------
    // On the OTHER parent's side, which nothing has pulled into yet. Deep
    // slots have no room for a name, so the pulled card id is what puts a
    // portrait on them — the only thing that makes one recognisable at a
    // glance. It rides along at every depth the dump reaches.
    await selectNode("Grandparent 2-1");
    const pulledGp = await pullInto(RV1);
    check("a grandparent takes a pull too", pulledGp === null, String(pulledGp));
    check("its generation-3 slots take the veteran's parents",
      (await mapChip("Sparks 3-5").getAttribute("aria-label")) ===
        `Sparks 3-5 — ${deepLabel(memberAt(RV1, 10))}`);
    check("and its generation-4 slots take their parents' sparks",
      (await mapChip("Sparks 4-9").getAttribute("aria-label")) ===
        `Sparks 4-9 — ${deepLabel(memberAt(RV1, 11))}`);
    await selectNode("Sparks 3-5");
    check("generation 3 says who it is",
      (await page.locator(".focus-role").count()) === 1);
    await selectNode("Sparks 4-9");
    check("generation 4 does too",
      (await page.locator(".focus-role").count()) === 1);
    // The portrait is the point of storing the id — a deep slot has no room
    // for a name, so without art it's an anonymous star count again.
    check("both depths show a face on the map",
      (await hasFace("Sparks 3-5")) && (await hasFace("Sparks 4-9")));
    check("and the label names her, so the art itself is decorative",
      (await mapChip("Sparks 4-9").getAttribute("aria-label")) ===
        `Sparks 4-9 — ${deepLabel(memberAt(RV1, 11))}`);
    await settled();
    const gpPull = (await rows()).find((b) => b.name === `${bpName} roster`);
    check("the stored document keeps identity at both depths",
      gpPull?.slots?.sparks?.[4]?.card_id === memberAt(RV1, 10).card_id &&
      gpPull?.slots?.sparks?.[16]?.card_id === memberAt(RV1, 11).card_id,
      JSON.stringify([gpPull?.slots?.sparks?.[4], gpPull?.slots?.sparks?.[16]]));

    // ---------- replacing a populated branch ----------
    // Hand-author inside Parent 2's branch but OUTSIDE the sub-branch just
    // pulled: a catalog pick at the other grandparent, and a spark at
    // generation 4 under it — which no pull can reach from here, and so is
    // the node that proves a pull CLEARS rather than merely overwriting what
    // it has data for. Manual entry is never taken away.
    await selectNode("Grandparent 2-2");
    await pickInto(GX);
    check("manual entry still works alongside the roster",
      (await mapChip("Grandparent 2-2").getAttribute("aria-label")) ===
        `Grandparent 2-2 — ${GX.entry.name}`);
    await selectNode("Sparks 4-13");
    await setSpark("Sparks 4-13", "end", 3);
    await settled();

    // Pulling over all of it must ask — once, naming what it would take, and
    // only what a human authored. The nodes the earlier grandparent pull
    // produced were never authored by hand, so warning about them would be
    // the noise that makes people dismiss blind.
    await selectNode("Parent 2");
    const asked = await pullInto(RV2, "dismiss");
    check("a pull over hand-authored nodes asks first", asked !== null, String(asked));
    check("the prompt names every hand-authored node in the branch",
      (asked ?? "").includes("Grandparent 2-2") && (asked ?? "").includes("Sparks 4-13"),
      String(asked));
    check("the prompt does NOT name what an earlier pull auto-filled",
      !(asked ?? "").includes("Sparks 3-5") && !(asked ?? "").includes("Sparks 4-9"),
      String(asked));

    // Declining has to mean declining. Nothing about this is verified by the
    // accept path — a confirm nobody tests dismissing is a confirm that has
    // silently become an overwrite.
    check("declining leaves the hand-authored node alone",
      (await mapChip("Grandparent 2-2").getAttribute("aria-label")) ===
        `Grandparent 2-2 — ${GX.entry.name}`);
    check("declining leaves the deep branch alone",
      (await mapChip("Sparks 4-13").getAttribute("aria-label")) === "Sparks 4-13 — 3★ End");
    check("declining leaves the earlier pull alone",
      (await mapChip("Grandparent 2-1").getAttribute("aria-label")) ===
        `Grandparent 2-1 — ${RV1.name}`);
    // And it must not have been written either: a dismissed dialog that
    // still autosaved would lose the work one reload later.
    await settled();
    const afterDismiss = (await rows()).find((b) => b.name === `${bpName} roster`);
    check("declining writes nothing to the server",
      afterDismiss?.slots?.named?.[6]?.chara_id === GX.entry.chara_id,
      JSON.stringify(afterDismiss?.slots?.named?.[6]));

    // Accepting replaces the whole branch: what the veteran knows is filled
    // in, and everything else under the node is emptied. Leaving generation
    // 4 behind would feed the NEW grandparents' brackets from the pedigree
    // that was just replaced — a wrong number, not a stale one.
    const accepted = await pullInto(RV2);
    check("accepting the same prompt goes through", accepted !== null, String(accepted));
    check("accepting replaces the picked node",
      (await mapChip("Parent 2").getAttribute("aria-label")) === `Parent 2 — ${RV2.name}`);
    check("accepting replaces the hand-authored node it warned about",
      (await mapChip("Grandparent 2-1").getAttribute("aria-label")) ===
        `Grandparent 2-1 — ${memberAt(RV2, 10).name}`);
    check("accepting re-fills the deep slots from the new veteran",
      (await mapChip("Sparks 3-5").getAttribute("aria-label")) ===
        `Sparks 3-5 — ${deepLabel(memberAt(RV2, 11))}`);
    check("a pull CLEARS the rest of the branch it can't fill",
      (await mapChip("Sparks 4-13").getAttribute("aria-label")) === "Sparks 4-13 — empty");
    check("and clears nothing outside that branch",
      (await mapChip("Grandparent 1-1").getAttribute("aria-label")) ===
        `Grandparent 1-1 — ${P10.name}`);
    await settled();
    const afterPull = (await rows()).find((b) => b.name === `${bpName} roster`);
    check("the cleared branch is cleared on the server too",
      afterPull?.slots?.sparks?.[20] === null,
      JSON.stringify(afterPull?.slots?.sparks));

    // Re-pulling the same node asks nothing: its branch is now entirely the
    // previous pull's work, and the node itself is what you asked to
    // replace. A dialog here would say only "the thing you're replacing will
    // be replaced" — the noise that teaches people to dismiss blind.
    const again = await pullInto(RV2);
    check("re-pulling a pulled node asks nothing", again === null, String(again));

    // Clearing the veteran takes her pedigree with it, rather than leaving it
    // hanging under nobody — and unlocked, since she was the lock.
    await selectNode("Parent 2");
    await page.locator('button[aria-label="Clear Parent 2"]').click();
    check("clearing a pulled veteran empties her whole branch",
      (await mapChip("Parent 2").getAttribute("aria-label")) === "Parent 2 — empty" &&
      (await mapChip("Grandparent 2-1").getAttribute("aria-label")) ===
        "Grandparent 2-1 — empty" &&
      (await mapChip("Sparks 3-5").getAttribute("aria-label")) === "Sparks 3-5 — empty");
    check("and leaves the other parent's branch alone",
      (await mapChip("Parent 1").getAttribute("aria-label")) === `Parent 1 — ${RV1.name}`);
    check("the freed nodes are editable again",
      await until(async () => {
        await selectNode("Grandparent 2-1");
        return (await page.locator(".focus-pick").count()) === 1;
      }));

    // ---------- replacing a pulled node at depth ----------
    // Generations 3 and 4 name characters now, so a deep node can be pulled
    // into directly — and with the branch above it empty, nothing locks it.
    // Replacing that node by hand is the same act as replacing a pulled
    // parent and takes the same cleanup: hers is the pedigree below, and hers
    // is the pink. A face swapped in over the top of them would assert a
    // lineage belonging to nobody, and quietly unlock it too.
    await selectNode("Sparks 3-5");
    await pullInto(RV1);
    check("a generation-3 node can be pulled into directly",
      (await mapChip("Sparks 3-5").getAttribute("aria-label")) ===
        `Sparks 3-5 — ${deepLabel(RV1)}`,
      await mapChip("Sparks 3-5").getAttribute("aria-label"));
    check("and it brings its own generation 4 with it",
      (await mapChip("Sparks 4-9").getAttribute("aria-label")) ===
        `Sparks 4-9 — ${deepLabel(memberAt(RV1, 10))}`);
    await pickInto(GX);
    check("replacing a pulled deep node drops her pink with her",
      (await mapChip("Sparks 3-5").getAttribute("aria-label")) ===
        `Sparks 3-5 — ${GX.entry.name}`,
      await mapChip("Sparks 3-5").getAttribute("aria-label"));
    check("and clears the generation 4 she brought",
      (await mapChip("Sparks 4-9").getAttribute("aria-label")) === "Sparks 4-9 — empty");
    await settled();
    const deepSwap = (await rows()).find((b) => b.name === `${bpName} roster`);
    check("the replaced deep node keeps no trace of the pull on the server",
      // `== null` deliberately: the field is absent on the way up and comes
      // back as an explicit null from BlueprintOut.
      deepSwap?.slots?.sparks?.[4]?.source == null &&
      deepSwap?.slots?.sparks?.[4]?.aptitude == null &&
      deepSwap?.slots?.sparks?.[16] === null,
      JSON.stringify([deepSwap?.slots?.sparks?.[4], deepSwap?.slots?.sparks?.[16]]));
  }

  // ---------- persistence: what the autosave guarantees ----------
  // Two checks below deliberately break the network. Each wraps itself in
  // `breaking()` rather than the whole section running under a blanket
  // exemption, so a real backend failure between them still fails the run.
  // With no Save button these are the only thing between an edit and the
  // floor, so each one is asserted against the API rather than the UI.
  await newBlueprint();
  await rename(`${bpName} A`);
  await newBlueprint();
  await rename(`${bpName} B`);
  const idB = (await rows()).find((b) => b.name === `${bpName} B`).id;

  // Leaving a blueprint must flush the pending write, not cancel it.
  await selectNode("Sparks 3-1");
  await setSpark("Sparks 3-1", "mile", 3);
  await switchTo(`${bpName} A`); // inside the debounce window
  await openedNamed(`${bpName} A`);
  check(
    "switching mid-debounce keeps the edit on the blueprint you left",
    await until(async () => sparkOf(await rowById(idB))?.aptitude === "mile")
  );

  // A blank name must not suspend saving — it saves under the placeholder.
  await settled();
  const idA = (await rows()).find((b) => b.name === `${bpName} A`).id;
  await nameField().fill("");
  await selectNode("Sparks 3-2");
  await setSpark("Sparks 3-2", "dirt", 2);
  check(
    "a blank name still saves, under the placeholder",
    await until(async () => {
      const bp = await rowById(idA);
      return sparkOf(bp, 1)?.aptitude === "dirt" && bp?.name === "Untitled Blueprint";
    })
  );
  await nameField().click();
  await nameField().blur();
  check("the blank name field is normalized on blur",
    (await nameField().inputValue()) === "Untitled Blueprint");

  // A row deleted from under the page is re-created, not PUT into a hole.
  // The 404 that triggers the recovery is the deliberate break here.
  await settled();
  await breaking(async () => {
    await fetch(`${BASE}/api/blueprints/${idA}`, { method: "DELETE" });
    await selectNode("Sparks 3-3");
    await setSpark("Sparks 3-3", "sprint", 1);
    check(
      "a row deleted elsewhere is re-created rather than lost",
      await until(async () =>
        (await rows()).some((b) => b.id !== idA && sparkOf(b, 2)?.aptitude === "sprint")
      )
    );
    // Inside the window: the recovery has to have landed before the window
    // closes, or a straggling 404 would be counted as a real failure.
    await settled();
  });

  // Deleting inside the debounce window must not resurrect the blueprint:
  // the queued body would 404 and the re-create recovery would bring back
  // exactly what the user just threw away.
  await settled();
  await newBlueprint();
  await rename(`${bpName} doomed`);
  const idDoomed = (await rows()).find((b) => b.name === `${bpName} doomed`).id;
  await selectNode("Sparks 3-5");
  await setSpark("Sparks 3-5", "late", 1);
  await barButton("Delete").click();
  await settled();
  // A negative assertion is only as good as the window it watches, and the
  // app's first re-create retry is DesignerPage's RETRY_MS (4 s) after the
  // failure — so the old single read at 1.5 s could pass while the
  // resurrection was still pending. Poll across the whole window instead of
  // sampling once at the end, so a row that comes back and is deleted again
  // can't slip between two reads.
  let resurrected = null;
  for (let waited = 0; waited < 6000; waited += 250) {
    await page.waitForTimeout(250);
    const now = await rows();
    if (now.some((b) => b.id === idDoomed) || now.some((b) => sparkOf(b, 4)?.aptitude === "late")) {
      resurrected = now.map((b) => [b.id, b.name]);
      break;
    }
  }
  check(
    "deleting with an edit still queued doesn't resurrect the blueprint",
    resurrected === null,
    JSON.stringify(resurrected)
  );

  // A failing write says so, and recovers by itself when the backend is back.
  await settled();
  await breaking(async () => {
    await page.route("**/api/blueprints/**", (r) => r.abort());
    await selectNode("Sparks 3-4");
    await setSpark("Sparks 3-4", "end", 1);
    const reported = await page
      .waitForFunction(
        () => document.querySelector(".designer-autosave")?.textContent === "Not Saved",
        null,
        { timeout: 8000 }
      )
      .then(() => true, () => false);
    check("a failing write reports 'Not Saved' instead of a permanent 'Saving…'", reported);
    await page.unroute("**/api/blueprints/**");
    const recovered = await page
      .waitForFunction(
        () => document.querySelector(".designer-autosave")?.textContent === "Saved",
        null,
        { timeout: 20000 }
      )
      .then(() => true, () => false);
    check("and retries to completion with no user action", recovered);
  });

  const realErrors = errors.filter((e) => !/favicon/i.test(e));
  check("no JS errors or failed requests", realErrors.length === 0, realErrors.join(" | "));
  console.log(`  (${expected.length} failures inside the deliberate-break windows, ignored)`);
} catch (e) {
  // A throw (a timed-out locator, say) isn't a failed check(), so nothing
  // above captured it — and a bare stack trace is the least actionable way
  // to learn that a selector never appeared. Record it like a failure, then
  // rethrow so the exit code and the console output are unchanged.
  thrown = String(e && e.stack ? e.stack : e);
  failures.push({ name: "UNCAUGHT", extra: thrown });
  if (onFail) onFail("uncaught");
  throw e;
} finally {
  // Pending screenshots need the browser, so drain them before closing it.
  await shots.catch(() => {});
  if (ART) {
    writeFileSync(
      `${ART}/e2e-results.json`,
      JSON.stringify(
        { suite: "deep-tree", base: BASE, pass, fail, thrown, failures, errors },
        null,
        2
      )
    );
  }
  await browser.close();
  // Restore: delete the rows this run created, even if it died mid-way. Wrapped
  // because an unguarded throw here would replace whatever the try block threw
  // — reporting "fetch failed" instead of the assertion that actually broke.
  try {
    for (const bp of await rows()) {
      if (baselineIds.has(bp.id)) continue;
      if (bp.name.startsWith(bpName) || owned.has(bp.id)) {
        await fetch(`${BASE}/api/blueprints/${bp.id}`, { method: "DELETE" });
        console.log(`  cleanup: deleted blueprint ${bp.id} (${bp.name})`);
      } else {
        // Appeared during the run but isn't ours — almost certainly saved from
        // another tab. Say so rather than deleting it or staying silent.
        console.log(`  cleanup: LEFT blueprint ${bp.id} (${bp.name}) — not created by this run`);
      }
    }
  } catch (e) {
    console.log(`  cleanup: FAILED to restore (${e}) — check for leftover "${bpName}" rows`);
  }
  // The spark lists this run created, by the names it tracked before
  // creating them — never "every list that wasn't there before", which would
  // delete one you made in another tab mid-run. Deleting the list takes its
  // membership with it, so there is nothing else to undo: this run never
  // writes into a list of yours.
  try {
    for (const list of await getJson("/api/spark-lists")) {
      // Tracked names first, then anything else carrying the run prefix. The
      // prefix sweep is what collects ORPHANS: a run killed between the
      // create and the `finally` leaves its list behind, and cleaning only
      // the current run's name meant those accumulated forever against
      // MAX_LISTS_PER_OWNER — on the developer's real account, until creating
      // any list 409'd for a reason unrelated to the code under test.
      //
      // Safe to widen this far because the prefix is this suite's own and no
      // human would type it; every other list is left alone, which is the
      // rule the blueprint sweep above follows too.
      const ours = listsOwned.has(list.name) || list.name.startsWith(E2E_LIST_PREFIX);
      if (!ours) continue;
      await fetch(`${BASE}/api/spark-lists/${list.id}`, { method: "DELETE" });
      const why = listsOwned.has(list.name) ? "" : " (orphan from an earlier run)";
      console.log(`  cleanup: deleted spark list ${list.id} (${list.name})${why}`);
    }
  } catch (e) {
    console.log(
      `  cleanup: FAILED to delete lists (${e}) — check /api/spark-lists for "${E2E_LIST_PREFIX}" rows`
    );
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
