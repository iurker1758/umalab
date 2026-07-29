// Hand-written types mirroring the backend's Pydantic schemas (app/main.py).
// OpenAPI codegen is a v2 concern.

export interface Factor {
  factor_id: number;
  kind: "blue" | "pink" | "white" | "unique";
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
}

export interface Skill {
  skill_id: number;
  level: number;
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
  factors: Factor[];
  skills: Skill[];
  lineage: LineageMember[];
}

export interface ImportInfo {
  id: number;
  imported_at: string;
  veteran_count: number;
  filename: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
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
};
