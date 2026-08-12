// Hand-written types mirroring the backend's Pydantic schemas (app/schemas.py).
// OpenAPI codegen is a v2 concern.

export interface Factor {
  factor_id: number;
  kind: "blue" | "pink" | "white" | "unique" | "race" | "scenario" | "other";
  key: number;
  star: number;
  name: string;
}

export interface LineageMember {
  position_id: number;
  relation: "parent" | "grandparent";
  card_id: number;
  chara_id: number;
  name: string;
  outfit: string;
  rarity: number;
  talent_level: number;
  rank: number;
  factors: Factor[];
  win_saddles: number[];
}

export interface Skill {
  skill_id: number;
  level: number;
  // Enriched by the API from the bundled skills reference; null/false when
  // the id is missing from it (e.g. a brand-new skill before a data refresh).
  name: string | null;
  rarity: number | null;
  unique: boolean;
}

export interface Veteran {
  id: number;
  trained_chara_id: number;
  card_id: number;
  chara_id: number;
  name: string;
  outfit: string;
  rarity: number;
  talent_level: number;
  rank: number;
  rank_score: number;
  fans: number;
  wins: number;
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wiz: number;
  proper_distance_short: number;
  proper_distance_mile: number;
  proper_distance_middle: number;
  proper_distance_long: number;
  proper_ground_turf: number;
  proper_ground_dirt: number;
  proper_running_style_nige: number;
  proper_running_style_senko: number;
  proper_running_style_sashi: number;
  proper_running_style_oikomi: number;
  register_time: string;
  win_saddles: number[];
  factors: Factor[];
  skills: Skill[];
  lineage: LineageMember[];
  tags: string[];
  // Card epithet ("[Special Dreamer]"), enriched by the API from the bundled
  // card reference; empty string when unknown.
  title: string;
}

export interface ImportInfo {
  id: number;
  imported_at: string;
  veteran_count: number;
  filename: string;
}

// ---------- designer (catalog / blueprints) ----------

// The ten aptitude keys in the game's display order (track, distance,
// running style) — mirrors the backend's AptitudeKey Literal.
export const APTITUDE_KEYS = [
  "turf", "dirt",
  "sprint", "mile", "medium", "long",
  "front", "pace", "late", "end",
] as const;
export type AptitudeKey = (typeof APTITUDE_KEYS)[number];

// Base career-start letters per card (G..A today; S has a fixed meaning).
export type AptitudeLetters = Record<AptitudeKey, string>;

// One pink (aptitude) spark. Single, not a list — every lineage member
// carries exactly one pink (verified against a real full dump). stars 1–3.
export interface PinkSpark {
  aptitude: AptitudeKey;
  stars: number;
}

// The non-pink spark kinds a designed node can carry (DECISIONS.md #40).
export const SLOT_FACTOR_KINDS = ["blue", "white", "unique", "race", "scenario"] as const;
export type SlotFactorKind = (typeof SLOT_FACTOR_KINDS)[number];

// One non-pink spark on a designed node, keyed by the game's factor key rather
// than the name: names are localized strings we render, the key is the
// identity. `kind` rides along because it decides the base rate, and the key
// ranges separating the kinds are an ingest heuristic, not a guarantee.
export interface SlotFactor {
  kind: SlotFactorKind;
  key: number;
  stars: number;
}

// A pickable spark, from the committed factor reference — what hand entry
// chooses from. Roster and lineage slots get theirs decoded from the dump
// instead.
export interface FactorRef {
  kind: SlotFactorKind;
  key: number;
  name: string;
}

// A generation-3/4 slot: a pink, a character, or both. Flat rather than
// nesting the spark under the identity, so a row written before `card_id`
// existed is already this shape. aptitude/stars travel together — half a spark
// reads as a different one.
export interface DeepSlot {
  aptitude?: AptitudeKey | null;
  stars?: number | null;
  // Who the slot is — decoration for the math, and what puts a portrait on a
  // node too deep to carry a name.
  card_id?: number | null;
  // Set only when a pull placed the character; absent ⇒ hand-picked.
  source?: "roster" | "lineage" | null;
}

export interface CatalogCard {
  card_id: number;
  outfit: string;
  // null when the card is missing from aptitudes.json (a regen gap) —
  // "letters unknown" in the UI.
  aptitudes: AptitudeLetters | null;
}

export interface CatalogEntry {
  chara_id: number;
  name: string;
  // Sorted by card_id; [0] is the base outfit and doubles as the icon key.
  cards: CatalogCard[];
}

// ---------- run affinity ----------
// The six lineage slots the game scores affinity over: the parents and their
// parents. Everything deeper in the 31-node tree exists for the bracket math
// and never reaches this request.
export const AFFINITY_SLOTS = ["p1", "p2", "g11", "g12", "g21", "g22"] as const;
export type AffinitySlotId = (typeof AFFINITY_SLOTS)[number];

// A filled slot in the stateless scoring request: the chara plus its raw
// won-saddle ids, which the server expands to G1 race sets. Catalog picks
// legitimately send an empty array — no wins is not the same as no slot.
export interface AffinitySlotRequest {
  chara_id: number;
  win_saddle_ids: number[];
}

export type AffinityRequest = {
  trainee_chara_id: number | null;
} & Partial<Record<AffinitySlotId, AffinitySlotRequest | null>>;

export interface AffinityLink {
  link: string;
  relation_points: number;
  win_points: number;
}

// Per-slot attribution: what one ancestor contributes on the links it
// appears in. Null while that slot is empty — which the panel shows as no
// row at all, not as a zero.
export type AffinityShares = Record<`${AffinitySlotId}_affinity`, number | null>;

export type AffinityResult = {
  total: number;
  symbol: string;
  relation_total: number;
  win_total: number;
  links: AffinityLink[];
} & AffinityShares;

export interface BlueprintSlot {
  source: "catalog" | "roster" | "lineage";
  // Null together on a spark-only slot — a node whose pink is planned but
  // whose character isn't chosen yet.
  chara_id: number | null;
  card_id: number | null;
  win_saddle_ids: number[];
  trained_chara_id?: number | null;
  position_id?: number | null;
  spark?: PinkSpark | null;
  // A roster pick's own aptitude letters, as trained — snapshotted like the
  // won saddles. Absent on catalog and lineage slots.
  aptitudes?: AptitudeLetters | null;
  // The member's non-pink sparks, for the inspiration-proc estimates. Absent
  // reads as "carries none" — the only way this document is allowed to grow.
  factors?: SlotFactor[];
}

// Blueprint document v2 (DECISIONS.md #25): `named` is the identity triangle
// breadth-first — [0] trainee, [1–2] parents, [3–6] grandparents; `sparks`
// covers tree indices 7–30 (generations 3–4) as bare pinks. Both exact-length.
export interface BlueprintSlots {
  named: (BlueprintSlot | null)[];
  sparks: (DeepSlot | null)[];
}

export interface BlueprintIn {
  name: string;
  slots: BlueprintSlots;
}

export interface Blueprint extends BlueprintIn {
  id: number;
  created_at: string;
  updated_at: string;
}

// ---------- spark lists ----------

// What a list may hold: what a hunt can be FOR. Narrower than the slot kinds
// — every parent carries her blue and her own green regardless, so a list
// naming one selects nothing. Mirrors the server's ListSparkKind, and spelled
// out rather than derived from SLOT_FACTOR_KINDS: an Exclude<> would silently
// widen when a slot kind is added, offering a ★ the server then refuses —
// a new kind stays unlistable until both ends admit it.
export const LIST_SPARK_KINDS = ["white", "race", "scenario"] as const;
export type ListSparkKind = (typeof LIST_SPARK_KINDS)[number];

// One membership entry. No `stars`: a list records WHICH sparks you want, not
// what level you last typed — the level belongs to the slot document
// (DECISIONS.md #37).
export interface SparkRef {
  kind: ListSparkKind;
  key: number;
}

export interface SparkList {
  id: number;
  // The user's own build name, unique per user.
  name: string;
  // What the management page's "Last Edited" sort reads; `id` carries
  // creation order (DECISIONS.md #44). ISO timestamp, compared as a string.
  updated_at: string;
  // Membership, in the order it was added. Deduped server-side.
  sparks: SparkRef[];
}

// What a write SENDS, which is not what a list HOLDS: rename-only, since
// membership has its own per-spark verbs (issue #66, DECISIONS.md #48) —
// a whole `sparks` array in this body is a stale client and the server
// 422s it. Partial rather than nullable — `undefined` is unsendable in
// JSON, which is exactly the "absent" the route wants.
export type SparkListPatch = Partial<Pick<SparkList, "name">>;

// Carries the status so a caller can tell "this row is gone" (404) from
// "the backend is down" — the designer's autosave recovers from the first
// by re-creating the row and only retries on the second.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The server's own words for a refusal it can explain — 409 for the name
// rules, 422 for everything `app/schemas.py` validates. 422 matters as much
// as 409: without it an over-long name reports "try again" forever, a
// permanent refusal phrased as a transient one. Anything else is a blip.
export const detailOr = (error: unknown, fallback: string): string =>
  error instanceof ApiError &&
  (error.status === 409 || error.status === 422) &&
  error.message !== ""
    ? `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.`
    : fallback;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const raw = ((await res.json()) as { detail?: unknown }).detail;
      // 422s carry a list of {msg, ...} entries (FastAPI validation);
      // everything else is a plain string.
      detail = Array.isArray(raw)
        ? raw
            .map((e: { msg?: string }) => e.msg ?? "")
            .filter(Boolean)
            .join("; ")
        : typeof raw === "string"
          ? raw
          : "";
    } catch {
      // body wasn't JSON; fall through to the status line
    }
    throw new ApiError(res.status, detail || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  veterans: () => fetch("/api/veterans").then((r) => json<Veteran[]>(r)),
  latestImport: () => fetch("/api/imports/latest").then((r) => json<ImportInfo | null>(r)),
  importDump: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch("/api/imports", { method: "POST", body }).then((r) => json<ImportInfo>(r));
  },
  addTag: (trainedCharaId: number, tag: string) =>
    fetch(`/api/veterans/${trainedCharaId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    }).then((r) => json<{ trained_chara_id: number; tag: string }>(r)),
  // tag null = clear the selection's marks. All-or-nothing on the backend
  // (DECISIONS.md #20): a stale selection 404s instead of half-applying.
  bulkTag: (trainedCharaIds: number[], tag: string | null) =>
    fetch("/api/veterans/tags/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trained_chara_ids: trainedCharaIds, tag }),
    }).then((r) => json<{ updated: number; tag: string | null }>(r)),
  removeTag: (trainedCharaId: number, tag: string) =>
    fetch(`/api/veterans/${trainedCharaId}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    }).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    }),
  catalog: () => fetch("/api/catalog").then((r) => json<CatalogEntry[]>(r)),
  factors: () => fetch("/api/factors").then((r) => json<FactorRef[]>(r)),
  // Takes a signal so the designer's debounced effect can abort a stale
  // request instead of racing it against the newer one.
  scoreAffinity: (body: AffinityRequest, signal?: AbortSignal) =>
    fetch("/api/affinity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }).then((r) => json<AffinityResult>(r)),
  blueprints: () => fetch("/api/blueprints").then((r) => json<Blueprint[]>(r)),
  createBlueprint: (body: BlueprintIn) =>
    fetch("/api/blueprints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Blueprint>(r)),
  updateBlueprint: (id: number, body: BlueprintIn) =>
    fetch(`/api/blueprints/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<Blueprint>(r)),
  deleteBlueprint: (id: number) =>
    fetch(`/api/blueprints/${id}`, { method: "DELETE" }).then((r) => {
      // Already gone is the outcome the caller wanted.
      if (!r.ok && r.status !== 404) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
    }),
  sparkLists: () => fetch("/api/spark-lists").then((r) => json<SparkList[]>(r)),
  // 409 if the name is taken — surfaced rather than swallowed, because the
  // picker's `New List` has a field the user can correct.
  createSparkList: (name: string) =>
    fetch("/api/spark-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => json<SparkList>(r)),
  // Rename. Membership never travels through this — see the verbs below.
  updateSparkList: (id: number, body: SparkListPatch) =>
    fetch(`/api/spark-lists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<SparkList>(r)),
  // One membership each, idempotent, answering the list's current state —
  // single-row writes commute, so two devices editing one list converge
  // instead of overwriting each other (issue #66, DECISIONS.md #48). A 404
  // means the LIST is gone and does throw, unlike deleteSparkList's: the
  // caller needs it to drop the dead list in place.
  addListSpark: (id: number, kind: ListSparkKind, key: number) =>
    fetch(`/api/spark-lists/${id}/sparks/${kind}/${key}`, {
      method: "PUT",
    }).then((r) => json<SparkList>(r)),
  removeListSpark: (id: number, kind: ListSparkKind, key: number) =>
    fetch(`/api/spark-lists/${id}/sparks/${kind}/${key}`, {
      method: "DELETE",
    }).then((r) => json<SparkList>(r)),
  deleteSparkList: (id: number) =>
    fetch(`/api/spark-lists/${id}`, { method: "DELETE" }).then((r) => {
      // Already gone is the outcome the caller wanted.
      if (!r.ok && r.status !== 404) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
    }),
};
