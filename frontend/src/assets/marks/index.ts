// The committed, original mark art (DECISIONS.md #22) — replaces the
// game-asset extraction for marks. Bundled by Vite, so every clone and
// deployment ships them with no fetch step. Ids must stay in sync with
// backend/app/data/tag_icons.json (and MARK_IDS in ../../domain.ts).
import mark01 from "./mark_01.svg";
import mark02 from "./mark_02.svg";
import mark03 from "./mark_03.svg";
import mark04 from "./mark_04.svg";
import mark05 from "./mark_05.svg";
import mark06 from "./mark_06.svg";
import mark07 from "./mark_07.svg";
import mark08 from "./mark_08.svg";
import mark09 from "./mark_09.svg";
import mark10 from "./mark_10.svg";
import mark11 from "./mark_11.svg";
import mark12 from "./mark_12.svg";
import mark13 from "./mark_13.svg";
import mark14 from "./mark_14.svg";
import mark15 from "./mark_15.svg";

export const MARK_ART: Record<string, string> = {
  mark_01: mark01,
  mark_02: mark02,
  mark_03: mark03,
  mark_04: mark04,
  mark_05: mark05,
  mark_06: mark06,
  mark_07: mark07,
  mark_08: mark08,
  mark_09: mark09,
  mark_10: mark10,
  mark_11: mark11,
  mark_12: mark12,
  mark_13: mark13,
  mark_14: mark14,
  mark_15: mark15,
};
