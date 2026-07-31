import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  api,
  type AptitudeLetters,
  type Blueprint,
  type CatalogCard,
  type CatalogEntry,
  type PinkSpark,
} from "../api";
import { FocusPanel } from "../components/FocusPanel";
import { SlotPicker, type SlotPick } from "../components/SlotPicker";
import { TreeMap } from "../components/TreeMap";
import {
  NAMED_COUNT,
  UNTITLED,
  copyName,
  emptyDesign,
  fromApi,
  halfOf,
  nextUntitledName,
  nodeLabel,
  readOpenId,
  slotConflicts,
  toApi,
  withNamed,
  withSpark,
  writeOpenId,
  type Design,
} from "../blueprint";

// Matches the styles.css breakpoint where the map drops below the panel.
const HALF_TREE_QUERY = "(max-width: 860px)";
// Long enough that a run of picks collapses into one PUT, short enough that
// the design on the server is never far behind the one on screen.
const AUTOSAVE_MS = 800;

// The trainee is what a blueprint is ABOUT, so it labels the row alongside
// the name. A fixed-size blank holds the space when there's no pick yet (or
// no icon on disk), so names stay on one line down the list.
const traineeCard = (bp: Blueprint): number | null =>
  bp.slots?.named?.[0]?.card_id ?? null;

const TraineeIcon = ({
  card,
  iconIndex,
}: {
  card: number | null;
  iconIndex: Record<string, string>;
}) => {
  const icon = card === null ? undefined : iconIndex[String(card)];
  return icon === undefined ? (
    <span className="bp-icon bp-icon-blank" aria-hidden="true" />
  ) : (
    <img className="bp-icon" src={`/icons/chara/${icon}`} alt="" loading="lazy" />
  );
};

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M5.5 1.5h7A1.5 1.5 0 0 1 14 3v7h-1.5V3h-7V1.5ZM3 4h6.5A1.5 1.5 0 0 1 11 5.5V13a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13V5.5A1.5 1.5 0 0 1 3 4Zm0 1.5V13h6.5V5.5H3Z"
    />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M6 2h4l.5 1H14v1.5H2V3h3.5L6 2Zm-2.5 4h9l-.7 8.1a1 1 0 0 1-1 .9H5.2a1 1 0 0 1-1-.9L3.5 6Zm2.8 1.6.3 6h1.2l-.3-6H6.3Zm3.4 0-.3 6h1.2l.3-6H9.7Z"
    />
  </svg>
);

export function DesignerPage({
  iconIndex,
  design,
  setDesign,
  savedJson,
  setSavedJson,
  onError,
}: {
  iconIndex: Record<string, string>;
  // design + savedJson live in the App shell so a route change can't
  // discard an unsaved design (see App.tsx). savedJson is the toApi()
  // JSON at the last save/load — the unsaved-changes hint compares
  // against it; null ⇒ nothing saved/loaded yet.
  design: Design;
  setDesign: Dispatch<SetStateAction<Design>>;
  savedJson: string | null;
  setSavedJson: (json: string | null) => void;
  onError: (msg: string) => void;
}) {
  const [saved, setSaved] = useState<Blueprint[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  // Which tree node the focus panel shows. Ephemeral by design — a route
  // round-trip resets to the trainee, the design itself survives.
  const [selected, setSelected] = useState(0);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // One bootstrap per mount, whatever StrictMode does with the effect —
  // creating a blueprint is not a repeatable side effect.
  const bootstrapped = useRef(false);

  // Adopt a server blueprint as the working design: parse it, remember it as
  // the one to reopen, and mark it clean so the autosave stays quiet.
  const adopt = useCallback(
    (bp: Blueprint) => {
      try {
        const d = fromApi(bp);
        setDesign(d);
        setSavedJson(JSON.stringify(toApi(d)));
        writeOpenId(bp.id);
        setSelected(0);
      } catch {
        onError(`Couldn't open "${bp.name}" — its saved data didn't parse.`);
      }
    },
    [setDesign, setSavedJson, onError]
  );
  // Below the layout breakpoint the map shows one parent's half at a time
  // (see TreeMap): sixteen gen-4 columns are unreadable on a phone.
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(HALF_TREE_QUERY).matches
  );
  const [side, setSide] = useState(1);

  useEffect(() => {
    const mq = window.matchMedia(HALF_TREE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Derived, not synced: whatever is selected decides which half shows, so
  // panel navigation (kid rows) can never land on an off-screen node. The
  // toggle only matters while the trainee — which belongs to both halves —
  // is the selection.
  const shownSide = narrow ? (selected === 0 ? side : halfOf(selected)) : null;

  // Phone layout stacks the panel below a tree that's taller than the
  // screen, so a tap on the map would otherwise update something you can't
  // see. Only map taps pan — the toggle and the picker set the selection
  // too, and yanking the view from under those would be motion for its own
  // sake.
  const panelRef = useRef<HTMLDivElement>(null);
  const selectFromMap = (i: number) => {
    setSelected(i);
    if (!narrow) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // After paint: the panel changes height with the node it shows.
    requestAnimationFrame(() =>
      panelRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    );
  };

  useEffect(() => {
    // Both fetches are page-scoped (catalog is static reference data, the
    // saved list is small) — refetching per visit keeps the shell out of it.
    let cancelled = false;
    void (async () => {
      const [cat, bps] = await Promise.allSettled([api.catalog(), api.blueprints()]);
      if (cancelled) return;
      if (cat.status === "fulfilled") setCatalog(cat.value);
      if (cat.status === "rejected" || bps.status === "rejected") {
        onError("Couldn't load designer data — is uvicorn running?");
      }
      if (bps.status !== "fulfilled") return;
      setSaved(bps.value);

      // Open something, always: the design the shell already holds (a route
      // round-trip), else the one last open here, else the most recently
      // touched, else a fresh row created on the spot. There is no
      // "unsaved" state in this designer — a blueprint exists or you're
      // not editing one.
      if (bootstrapped.current) return;
      bootstrapped.current = true;
      const held = design.id === null ? null : bps.value.find((b) => b.id === design.id);
      if (held !== undefined && held !== null) return;
      const openId = readOpenId();
      const target =
        bps.value.find((b) => b.id === openId) ??
        [...bps.value].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (target !== undefined) {
        adopt(target);
        return;
      }
      try {
        const bp = await api.createBlueprint({
          name: nextUntitledName([]),
          slots: toApi(emptyDesign()).slots,
        });
        if (cancelled) return;
        setSaved([bp]);
        adopt(bp);
      } catch {
        onError("Couldn't create a blueprint — is uvicorn running?");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once: `design` is read only to notice a shell-held blueprint, and
    // re-running on every edit would fight the autosave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError]);

  const charaById = useMemo(
    () => new Map(catalog.map((e) => [e.chara_id, e])),
    [catalog]
  );
  const cardById = useMemo(
    () => new Map<number, CatalogCard>(catalog.flatMap((e) => e.cards.map((c) => [c.card_id, c]))),
    [catalog]
  );
  // null when the catalog is unavailable — consumers fall back to ids/"?".
  const charaName = useCallback(
    (charaId: number) => charaById.get(charaId)?.name ?? null,
    [charaById]
  );
  const aptitudesFor = useCallback(
    (cardId: number): AptitudeLetters | null => cardById.get(cardId)?.aptitudes ?? null,
    [cardById]
  );
  const outfitFor = useCallback(
    (cardId: number) => cardById.get(cardId)?.outfit ?? null,
    [cardById]
  );

  const dirty = savedJson === null
    ? JSON.stringify(toApi(design)) !== JSON.stringify(toApi(emptyDesign()))
    : savedJson !== JSON.stringify(toApi(design));

  const applyPick = (pick: SlotPick) => {
    const target = pickerFor;
    setPickerFor(null);
    if (target === null) return;
    // A re-pick keeps the slot's typed spark: the pink is a plan input for
    // the bracket math, not part of the card's identity, and re-typing it
    // after every swap would be pure friction.
    setDesign((d) =>
      withNamed(d, target, {
        chara_id: pick.chara_id,
        card_id: pick.card_id,
        spark: d.named[target]?.spark ?? null,
      })
    );
    setSelected(target);
  };

  // Clears only the node itself — character and planned spark together: in a
  // catalog-only designer every pick is independent, nothing below "belongs"
  // to the cleared member (unlike the old roster auto-fill), and the game
  // rules apply between filled slots.
  const clearSlot = (target: number) => {
    setDesign((d) =>
      target < NAMED_COUNT ? withNamed(d, target, null) : withSpark(d, target, null)
    );
  };

  const setSpark = (target: number, spark: PinkSpark | null) => {
    setDesign((d) => withSpark(d, target, spark));
  };

  // Every edit autosaves. Debounced so a burst of picks is one request, and
  // skipped while a create/delete is in flight so the two can't race for the
  // same row. A blank name is skipped rather than sent: the server rejects
  // it, and mid-rename the field is legitimately empty for a keystroke.
  useEffect(() => {
    if (design.id === null || !dirty || busy || design.name.trim().length === 0) return;
    const id = design.id;
    const body = toApi(design);
    const timer = setTimeout(() => {
      setAutosaving(true);
      void (async () => {
        try {
          const bp = await api.updateBlueprint(id, body);
          setSaved((prev) => prev.map((b) => (b.id === bp.id ? bp : b)));
          setSavedJson(JSON.stringify(body));
        } catch {
          // Left dirty on purpose: the next edit retries, and the status
          // keeps reading "Saving…". A background retry loop that toasted
          // every failure would be unusable with the backend down.
        } finally {
          setAutosaving(false);
        }
      })();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [design, dirty, busy, setSavedJson]);

  const onLoad = (id: number) => {
    const bp = saved.find((b) => b.id === id);
    if (bp !== undefined) adopt(bp);
  };

  // A blank row, created straight away: the design you're editing is always
  // a real blueprint, so there's nothing to "save" later.
  const onNew = async () => {
    setBusy(true);
    try {
      const bp = await api.createBlueprint({
        name: nextUntitledName(saved),
        slots: toApi(emptyDesign()).slots,
      });
      setSaved((prev) => [bp, ...prev]);
      adopt(bp);
    } catch (e) {
      onError(`Couldn't create a blueprint: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Duplicate: the usual way to try a variant without risking the plan you
  // already like. Copies the design as it stands on screen, not the last
  // autosaved body, so an in-flight edit is included.
  const onCopy = async () => {
    setBusy(true);
    try {
      const body = toApi(design);
      const bp = await api.createBlueprint({ ...body, name: copyName(design.name, saved) });
      setSaved((prev) => [bp, ...prev]);
      adopt(bp);
    } catch (e) {
      onError(`Couldn't duplicate: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Deleting the last one leaves you on a fresh blank rather than on
  // nothing — the designer has no empty state to fall back to.
  const onDelete = async () => {
    const id = design.id;
    if (id === null) return;
    if (!window.confirm(`Delete "${design.name}"?`)) return;
    setBusy(true);
    try {
      await api.deleteBlueprint(id);
      const rest = saved.filter((b) => b.id !== id);
      setSaved(rest);
      if (rest.length > 0) {
        adopt([...rest].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]);
      } else {
        const bp = await api.createBlueprint({
          name: nextUntitledName([]),
          slots: toApi(emptyDesign()).slots,
        });
        setSaved([bp]);
        adopt(bp);
      }
    } catch (e) {
      onError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  // Click-outside / Escape close, registered only while open.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className="designer">
      <div className="designer-save">
        {/* The bar gates on `busy`: switching blueprints while a save is in
            flight would let the save's continuation stamp its id/name onto a
            different design. A custom menu rather than a <select> — the
            current row is an editable name with its own delete. */}
        <div className={`bp-picker${menuOpen ? " open" : ""}`} ref={menuRef}>
          {/* The field itself is the name: renaming is typing where the name
              already is, and the edit rides out on the normal autosave. The
              caret only opens the list of OTHER blueprints — the one you're
              in is already in front of you. */}
          <div className="bp-field">
            <TraineeIcon card={design.named[0]?.card_id ?? null} iconIndex={iconIndex} />
            <input
              className="designer-name"
              type="text"
              aria-label="Blueprint name"
              placeholder={UNTITLED}
              maxLength={80}
              value={design.name}
              disabled={busy}
              // Focusing the field opens the list: reaching for the name and
              // reaching for another blueprint start the same way, so the
              // caret is a shortcut rather than the only door.
              onFocus={() => setMenuOpen(true)}
              onChange={(e) => setDesign((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setMenuOpen(false);
              }}
            />
            <button
              className="bp-caret"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Switch blueprint"
              disabled={busy}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ▾
            </button>
          </div>
          {menuOpen && (
            <div className="bp-menu" role="menu">
              {saved
                .filter((bp) => bp.id !== design.id)
                .map((bp) => (
                  <button
                    key={bp.id}
                    className="bp-row"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onLoad(bp.id);
                    }}
                  >
                    <TraineeIcon card={traineeCard(bp)} iconIndex={iconIndex} />
                    {bp.name}
                  </button>
                ))}
              <button
                className="bp-row bp-row-new"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  void onNew();
                }}
              >
                + New Blueprint
              </button>
            </div>
          )}
        </div>
        {/* There is no Save: the row exists from the moment you start, and
            every edit autosaves. The status is the whole story. */}
        {design.id !== null && (
          <>
            {/* Whole-blueprint actions, out of the menu: they act on the one
                you're in, which is what the bar is about. The status trails
                them — it changes width as it flips, and between the picker
                and the buttons that would shove the buttons around. */}
            <button
              className="bar-icon"
              aria-label={`Duplicate ${design.name}`}
              title="Duplicate this blueprint"
              disabled={busy}
              onClick={() => void onCopy()}
            >
              <CopyIcon />
            </button>
            <button
              className="bar-icon bar-icon-danger"
              aria-label={`Delete ${design.name}`}
              title="Delete this blueprint"
              disabled={busy}
              onClick={() => void onDelete()}
            >
              <TrashIcon />
            </button>
            <span className="designer-autosave" role="status">
              {autosaving || dirty ? "Saving…" : "Saved"}
            </span>
          </>
        )}
      </div>

      <div className="designer-combo">
        {/* Outside .tree-map-wrap on purpose: that element scrolls
            horizontally, which would trap a sticky child in its own
            scrollport instead of the page's. */}
        {shownSide !== null && (
          <div className="side-toggle seg-group" role="radiogroup" aria-label="Tree half">
            {[1, 2].map((s) => {
              const slot = design.named[s];
              const name = slot?.chara_id == null ? null : charaName(slot.chara_id);
              return (
                <button
                  key={s}
                  className={shownSide === s ? "seg active" : "seg"}
                  aria-pressed={shownSide === s}
                  onClick={() => {
                    setSide(s);
                    // Follow the switch: the panel opens that parent, and
                    // the derived half can't disagree with the selection.
                    setSelected(s);
                  }}
                >
                  {/* The role tag rides along with the name: two unfamiliar
                      character names are hard to tell apart at a glance. */}
                  <span className="seg-tag">P{s}</span>
                  {name ?? nodeLabel(s)}
                </button>
              );
            })}
          </div>
        )}
        <div className="tree-map-wrap">
          <TreeMap
            design={design}
            selected={selected}
            onSelect={selectFromMap}
            charaName={charaName}
            aptitudesFor={aptitudesFor}
            iconIndex={iconIndex}
            side={shownSide}
          />
        </div>
        <div ref={panelRef} className="focus-dock">
          <FocusPanel
            design={design}
            index={selected}
            iconIndex={iconIndex}
            charaName={charaName}
            outfitFor={outfitFor}
            aptitudesFor={aptitudesFor}
            onOpenPicker={setPickerFor}
            onClear={clearSlot}
            onSetSpark={setSpark}
          />
        </div>
      </div>

      {pickerFor !== null && (
        <SlotPicker
          title={`Choose ${nodeLabel(pickerFor)}`}
          catalog={catalog}
          iconIndex={iconIndex}
          conflict={(charaId) => slotConflicts(design, pickerFor, charaId)}
          onPick={applyPick}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}
