// Hand-written types mirroring the backend's Pydantic schemas (app/main.py).
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

// ---------- designer (catalog / affinity / blueprints) ----------

export interface CatalogEntry {
  chara_id: number;
  name: string;
  // Sorted; [0] is the base outfit and doubles as the icon key.
  card_ids: number[];
}

// A slot in the stateless scoring request: chara plus its raw won-saddle ids
// (empty for catalog/theoretical picks). The trainee sends no wins.
export interface AffinitySlotRequest {
  chara_id: number;
  win_saddle_ids: number[];
}

export interface AffinityRequest {
  trainee_chara_id: number | null;
  p1?: AffinitySlotRequest | null;
  p2?: AffinitySlotRequest | null;
  g11?: AffinitySlotRequest | null;
  g12?: AffinitySlotRequest | null;
  g21?: AffinitySlotRequest | null;
  g22?: AffinitySlotRequest | null;
}

export interface AffinityLink {
  link: string;
  relation_points: number;
  win_points: number;
}

export interface AffinityResult {
  total: number;
  symbol: string;
  relation_total: number;
  win_total: number;
  links: AffinityLink[];
  p1_affinity: number | null;
  p2_affinity: number | null;
}

export interface BlueprintSlot {
  source: "catalog" | "roster" | "lineage";
  chara_id: number;
  card_id: number;
  win_saddle_ids: number[];
  trained_chara_id?: number | null;
  position_id?: number | null;
}

export interface BlueprintSlots {
  p1: BlueprintSlot | null;
  p2: BlueprintSlot | null;
  g11: BlueprintSlot | null;
  g12: BlueprintSlot | null;
  g21: BlueprintSlot | null;
  g22: BlueprintSlot | null;
}

export interface BlueprintIn {
  name: string;
  trainee_chara_id: number | null;
  slots: BlueprintSlots;
}

export interface Blueprint extends BlueprintIn {
  id: number;
  created_at: string;
  updated_at: string;
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
    throw new Error(detail || `${res.status} ${res.statusText}`);
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
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    }),
};
