import { useState } from "react";
import type { SparkList } from "../api";

// The active-list multi-select (#67, DECISIONS.md #43): one "Lists" button
// disclosing a wrapping panel of aria-pressed pills, one per list — a
// DISCLOSURE, not a flat row, because lists cap at 50 per owner and this
// control sits on every Sparks panel and in the chooser's sticky band, where
// 50 always-visible pills would eat the surface. Toggle buttons rather than
// checkboxes — the app's multi-select idiom throughout (the ★ picker, the
// filter panel's chips).
//
// A FRAGMENT, not a wrapper: both call sites are flex-wrap rows, and the
// menu takes `flex-basis: 100%` to land on its own full-width line below
// whatever shares the row — the ★ picker's `.spark-lists` layout, for the
// same reason.
//
// State wiring stays the CALLER's: the chooser presses its snapshot map,
// the panels press the live store — one control, two lifetimes (DECISIONS.md
// #43), so pressed-ness and the toggle are props rather than a store read.
export function ListFilter({
  lists,
  isPressed,
  disabled = false,
  onToggle,
}: {
  lists: SparkList[];
  isPressed: (id: number) => boolean;
  disabled?: boolean;
  onToggle: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = lists.filter((list) => isPressed(list.id)).length;
  if (lists.length === 0) return null;
  return (
    <>
      {/* Active while any list is pressed, open or not: the filter keeps
          narrowing after the menu closes, and a plain button in front of a
          filtered table would read as off. The count says how many without
          the menu; which ones needs the menu open. */}
      <button
        className={count > 0 ? "spark-list-disclose active" : "spark-list-disclose"}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {count > 0 ? `Lists · ${count}` : "Lists"}
        <span className="spark-list-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="spark-list-menu" role="group" aria-label="Filter by list">
          {lists.map((list) => (
            <button
              key={list.id}
              className={isPressed(list.id) ? "spark-list-filter active" : "spark-list-filter"}
              aria-pressed={isPressed(list.id)}
              data-list={list.id}
              disabled={disabled}
              onClick={() => onToggle(list.id)}
            >
              {list.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
