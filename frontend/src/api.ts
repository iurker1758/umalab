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
// card_id is optional identity for the generation-3 slots, filled by a
// roster pull from the picked veteran's own grandparents. Decorative only:
// the bracket math reads aptitude/stars. Generation 4 stays anonymous —
// the game stores two generations per veteran, so no real data exists.
export interface PinkSpark {
  aptitude: AptitudeKey;
  stars: number;
  card_id?: number | null;
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
}

// Blueprint document v2 (DECISIONS.md #25): `named` is the identity triangle
// breadth-first — [0] trainee, [1–2] parents, [3–6] grandparents; `sparks`
// covers tree indices 7–30 (generations 3–4) as bare pinks. Both exact-length.
export interface BlueprintSlots {
  named: (BlueprintSlot | null)[];
  sparks: (PinkSpark | null)[];
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
  // /api/affinity exists but the designer doesn't call it yet — run affinity
  // needs per-grandparent attribution, which lands in the next PR.
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
};
