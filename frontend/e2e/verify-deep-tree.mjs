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
const KEYS = ["turf", "dirt", "sprint", "mile", "medium", "long", "front", "pace", "late", "end"];
const LABEL = {
  turf: "Turf", dirt: "Dirt", sprint: "Sprint", mile: "Mile", medium: "Medium",
  long: "Long", front: "Front", pace: "Pace", late: "Late", end: "End",
};

// ---------- baseline from the API ----------
const catalog = await (await fetch(`${BASE}/api/catalog`)).json();
const baselineIds = new Set(
  (await (await fetch(`${BASE}/api/blueprints`)).json()).map((b) => b.id)
);
const owned = new Set();

// Cast: base cards only (picked by exact chip label), chosen so every
// assertion is reachable regardless of which dump/reference is loaded.
const used = new Set();
const pickCard = (what, pred) => {
  for (const e of catalog) {
    if (used.has(e.chara_id)) continue;
    const c = e.cards[0];
    if (c.aptitudes !== null && pred(c.aptitudes)) {
      used.add(e.chara_id);
      return { entry: e, card: c, apt: c.aptitudes };
    }
  }
  console.log(`no catalog card fits the ${what} constraints — cannot run`);
  process.exit(1);
};
// Trainee + G11: a visible mile boost needs base mile ≤ C (C+2 < A).
const T = pickCard("trainee", (a) => idx(a.mile) >= 0 && idx(a.mile) <= idx("C"));
const G11 = pickCard("g11", (a) => idx(a.mile) >= 0 && idx(a.mile) <= idx("C"));
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
console.log(
  `baseline: ${catalog.length} catalog charas, ${baselineIds.size} blueprints; ` +
  `T=${T.entry.name} (mile ${T.apt.mile}), P1=${P1.entry.name} (mile ${P1.apt.mile}, ` +
  `${aptA} A), P2=${P2.entry.name} (${aptLow} ${P2.apt[aptLow]}), ` +
  `G11=${G11.entry.name}, G12=${G12.entry.name}`
);

const bpName = `verify-deep-tree ${Date.now()}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// "Failed to load resource" carries no URL, which makes a failure here
// impossible to act on — the response hook below reports the same thing with
// the method and URL attached.
page.on("console", (m) => {
  if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
});
// Accept every confirm (delete + discard-unsaved prompts).
page.on("dialog", (d) => d.accept());

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
  const open = page.locator(".focus-pick, .focus-actions button", { hasText: /Choose|Replace/ });
  await open.first().click();
  await page.waitForSelector(".designer-picker");
  await page.locator(".uma-search").fill(who.entry.name);
  await page.locator(`.designer-picker .card-chip[aria-label="${chipLabel(who)}"]`).click();
  await page.waitForSelector(".designer-picker", { state: "detached" });
};
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
  check("picker is catalog-only (no tabs)",
    (await page.locator(".designer-picker .seg").count()) === 0);
  await page.locator(".uma-search").fill(T.entry.name);
  await page.locator(`.designer-picker .card-chip[aria-label="${chipLabel(T)}"]`).click();
  await page.waitForSelector(".designer-picker", { state: "detached" });
  check("trainee panel shows the pick",
    (await page.locator(".focus-name").textContent()) === T.entry.name);
  check("trainee turf = card base", (await rowLetter("Turf")) === T.apt.turf);
  check("trainee mile = card base", (await rowLetter("Mile")) === T.apt.mile);
  check("trainee has no spark editor",
    (await page.locator('select[aria-label="Trainee pink spark"]').count()) === 0);
  check("trainee v2 note shown",
    (await page.locator(".focus-note", { hasText: "Run affinity" }).count()) === 1);

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
  await page.locator(".focus-actions button", { hasText: "Replace" }).click();
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
  check("trainee mile From = 6★ → +2", (await rowFrom("Mile")).startsWith("6★ → +2"));
  check("boosted letter highlighted",
    (await aptRow("Mile").locator(".apt-final.boosted").count()) === 1);
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
  check("p1 mile From = 10★ → +4", (await rowFrom("Mile")).startsWith("10★ → +4"));

  // ---------- past the 10★ max: counted, never warned about ----------
  await selectNode("Sparks 3-2");
  await setSpark("Sparks 3-2", "mile", 2);
  check("deep chip stars: 2 of 3 filled",
    (await mapChip("Sparks 3-2").locator(".star").count()) === 3 &&
    (await mapChip("Sparks 3-2").locator(".star.filled").count()) === 2);
  await selectNode("Parent 1");
  check("p1 mile From shows the raw 12★ → +4", (await rowFrom("Mile")).startsWith("12★ → +4"));
  check("no over-10★ warning anywhere",
    !(await rowFrom("Mile")).includes("over 10") &&
    (await page.locator(".apt-over, .node-warn:not(.red)").count()) === 0);

  // ---------- past-cap excess: soft info ----------
  await selectNode("Sparks 3-4");
  await setSpark("Sparks 3-4", aptA, 3);
  await selectNode("Parent 1");
  check(`p1 ${aptA} stays A`, (await rowLetter(LABEL[aptA])) === "A");
  check("past-cap note still shown",
    (await rowFrom(LABEL[aptA])).includes("past A") &&
    (await aptRow(LABEL[aptA]).locator(".apt-cap").count()) === 1);

  // ---------- G11's own window: gen-3/4 sparks only ----------
  await selectNode("Sparks 4-1");
  await setSpark("Sparks 4-1", "long", 2);
  check("gen-4 chip shows the spark",
    (await mapChip("Sparks 4-1").getAttribute("aria-label")) === "Sparks 4-1 — 2★ Long");
  await selectNode("Grandparent 1-1");
  check(`g11 mile from its deep slots (5★)`,
    (await rowLetter("Mile")) === boost(G11.apt.mile, 5));
  check("g11 mile From = 5★ → +2", (await rowFrom("Mile")).startsWith("5★ → +2"));
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
  check("design survives route round-trip",
    (await mapChip("Parent 1").getAttribute("aria-label")).includes(P1.entry.name));
  check("name survives route round-trip",
    (await pickerLabel()) === bpName);

  // ---------- clear drops only the node itself ----------
  await selectNode("Grandparent 1-2");
  await page.locator('button[aria-label="Clear Grandparent 1-2"]').click();
  check("cleared g12",
    (await mapChip("Grandparent 1-2").getAttribute("aria-label")) === "Grandparent 1-2 — empty");
  check("clearing g12 keeps the deep sparks",
    (await mapChip("Sparks 3-1").getAttribute("aria-label")) === "Sparks 3-1 — 3★ Mile");
  await selectNode("Parent 1");
  check("p1 mile re-brackets to 9★ → +3", (await rowFrom("Mile")).startsWith("9★ → +3"));

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
    (await rowFrom("Turf")).startsWith("2★ → +1"));

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

  // ---------- persistence: what the autosave guarantees ----------
  // From here on the run deliberately breaks the network (a row deleted from
  // under the page, then aborted requests), so failed-request noise is
  // expected past this point — and only past it.
  const noiseFrom = errors.length;
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
  await settled();
  await fetch(`${BASE}/api/blueprints/${idA}`, { method: "DELETE" });
  await selectNode("Sparks 3-3");
  await setSpark("Sparks 3-3", "sprint", 1);
  check(
    "a row deleted elsewhere is re-created rather than lost",
    await until(async () =>
      (await rows()).some((b) => b.id !== idA && sparkOf(b, 2)?.aptitude === "sprint")
    )
  );

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
  await page.route("**/api/blueprints/**", (r) => r.abort());
  await selectNode("Sparks 3-4");
  await setSpark("Sparks 3-4", "end", 1);
  const reported = await page
    .waitForFunction(
      () => document.querySelector(".designer-autosave")?.textContent === "Not saved",
      null,
      { timeout: 8000 }
    )
    .then(() => true, () => false);
  check("a failing write reports 'Not saved' instead of a permanent 'Saving…'", reported);
  await page.unroute("**/api/blueprints/**");
  const recovered = await page
    .waitForFunction(
      () => document.querySelector(".designer-autosave")?.textContent === "Saved",
      null,
      { timeout: 20000 }
    )
    .then(() => true, () => false);
  check("and retries to completion with no user action", recovered);

  const realErrors = errors.filter(
    (e, i) =>
      !/favicon/i.test(e) &&
      !(i >= noiseFrom && /^HTTP \d+ |net::ERR_FAILED/.test(e))
  );
  check("no JS errors or failed requests", realErrors.length === 0, realErrors.join(" | "));
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
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
