import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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
  emptyDesign,
  fromApi,
  nodeLabel,
  slotConflicts,
  toApi,
  withNamed,
  withSpark,
  type Design,
} from "../blueprint";

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

  useEffect(() => {
    // Both fetches are page-scoped (catalog is static reference data, the
    // saved list is small) — refetching per visit keeps the shell out of it.
    let cancelled = false;
    void (async () => {
      const [cat, bps] = await Promise.allSettled([api.catalog(), api.blueprints()]);
      if (cancelled) return;
      if (cat.status === "fulfilled") setCatalog(cat.value);
      if (bps.status === "fulfilled") setSaved(bps.value);
      if (cat.status === "rejected" || bps.status === "rejected") {
        onError("Couldn't load designer data — is uvicorn running?");
      }
    })();
    return () => {
      cancelled = true;
    };
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

  // Clears only the node itself: in a catalog-only designer every pick is
  // independent — nothing below "belongs" to the cleared member (unlike the
  // old roster auto-fill), and the game rules apply between filled slots.
  const clearSlot = (target: number) => {
    setDesign((d) => withNamed(d, target, null));
  };

  const setSpark = (target: number, spark: PinkSpark | null) => {
    setDesign((d) => withSpark(d, target, spark));
  };

  const onSave = async () => {
    const body = toApi(design);
    const priorId = design.id;
    setBusy(true);
    try {
      const bp =
        priorId === null
          ? await api.createBlueprint(body)
          : await api.updateBlueprint(priorId, body);
      setDesign((d) => ({ ...d, id: bp.id, name: bp.name }));
      setSaved((prev) => [bp, ...prev.filter((b) => b.id !== bp.id)]);
      setSavedJson(JSON.stringify({ ...body, name: bp.name }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (priorId !== null && msg.includes("no blueprint with that id")) {
        // Deleted elsewhere (another tab, a DB reset): unbind the id so
        // the work can be re-created instead of every retry re-404ing.
        setDesign((d) => ({ ...d, id: null }));
        setSaved((prev) => prev.filter((b) => b.id !== priorId));
        onError(`"${body.name}" was deleted elsewhere — Save again to re-create it.`);
      } else {
        onError(`Save failed: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onLoad = (id: number) => {
    const bp = saved.find((b) => b.id === id);
    if (bp === undefined) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    try {
      const d = fromApi(bp);
      setDesign(d);
      setSavedJson(JSON.stringify(toApi(d)));
    } catch {
      // A slot shape this client doesn't understand — skip, don't crash.
      onError(`Couldn't load "${bp.name}" — its saved data didn't parse.`);
    }
  };

  const onDelete = async () => {
    if (design.id === null) return;
    if (!window.confirm(`Delete "${design.name}"?`)) return;
    setBusy(true);
    try {
      await api.deleteBlueprint(design.id);
      setSaved((prev) => prev.filter((b) => b.id !== design.id));
      setDesign(emptyDesign());
      setSavedJson(null);
    } catch (e) {
      onError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onNew = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setDesign(emptyDesign());
    setSavedJson(null);
    setSelected(0);
  };

  return (
    <div className="designer">
      <div className="designer-save">
        {/* The whole bar gates on `busy`: loading or renaming while a save
            is in flight would let the save's continuation stamp its id/name
            onto a different design. */}
        <input
          className="designer-name"
          type="text"
          placeholder="Blueprint name…"
          maxLength={80}
          value={design.name}
          disabled={busy}
          onChange={(e) => setDesign((d) => ({ ...d, name: e.target.value }))}
        />
        {dirty && (
          <span className="designer-dirty" title="Unsaved changes" aria-label="Unsaved changes">
            ●
          </span>
        )}
        <button
          onClick={() => void onSave()}
          disabled={busy || design.name.trim().length === 0}
        >
          {design.id === null ? "Save" : "Save changes"}
        </button>
        {saved.length > 0 && (
          <select
            aria-label="Load a saved blueprint"
            value=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value !== "") onLoad(Number(e.target.value));
            }}
          >
            <option value="" disabled>
              Load saved…
            </option>
            {saved.map((bp) => (
              <option key={bp.id} value={bp.id}>
                {bp.name}
              </option>
            ))}
          </select>
        )}
        {design.id !== null && (
          <button className="designer-secondary" onClick={() => void onDelete()} disabled={busy}>
            Delete
          </button>
        )}
        <button className="designer-secondary" onClick={onNew} disabled={busy}>
          New
        </button>
      </div>

      <div className="designer-combo">
        <div className="tree-map-wrap">
          <TreeMap
            design={design}
            selected={selected}
            onSelect={setSelected}
            charaName={charaName}
            aptitudesFor={aptitudesFor}
          />
        </div>
        <FocusPanel
          design={design}
          index={selected}
          iconIndex={iconIndex}
          charaName={charaName}
          outfitFor={outfitFor}
          aptitudesFor={aptitudesFor}
          onSelect={setSelected}
          onOpenPicker={setPickerFor}
          onClear={clearSlot}
          onSetSpark={setSpark}
        />
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
