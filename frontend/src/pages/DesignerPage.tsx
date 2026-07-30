import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  api,
  type AffinityResult,
  type Blueprint,
  type CatalogEntry,
  type Veteran,
} from "../api";
import { AffinityPanel } from "../components/AffinityPanel";
import { BlueprintTree } from "../components/BlueprintTree";
import { SlotPicker, type SlotPick } from "../components/SlotPicker";
import { SparkTotals } from "../components/SparkTotals";
import {
  SLOT_LABELS,
  aggregateSparks,
  catalogSlot,
  emptyDesign,
  fromApi,
  rosterSlot,
  setParentSlot,
  slotConflicts,
  toAffinityRequest,
  toApi,
  type Design,
  type SlotId,
  type SlotValue,
} from "../blueprint";

const AFFINITY_DEBOUNCE_MS = 250;

export function DesignerPage({
  veterans,
  loaded,
  iconIndex,
  design,
  setDesign,
  savedJson,
  setSavedJson,
  onError,
}: {
  veterans: Veteran[];
  loaded: boolean;
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
  const [affinity, setAffinity] = useState<AffinityResult | null>(null);
  const [scoreFailed, setScoreFailed] = useState(false);
  const [pickerFor, setPickerFor] = useState<"trainee" | SlotId | null>(null);
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

  // Scoring threshold: a trainee plus at least one parent. Keyed on the
  // request JSON so renaming the design doesn't re-score.
  const affinityKey = useMemo(() => {
    const belowThreshold =
      design.trainee === null || (design.slots.p1 === null && design.slots.p2 === null);
    return belowThreshold ? null : JSON.stringify(toAffinityRequest(design));
  }, [design]);

  useEffect(() => {
    if (affinityKey === null) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api
        .scoreAffinity(JSON.parse(affinityKey), ctrl.signal)
        .then((result) => {
          if (!ctrl.signal.aborted) {
            setAffinity(result);
            setScoreFailed(false);
          }
        })
        .catch(() => {
          // Aborts are ours (a newer edit superseded this request). Real
          // failures clear the result — the old design's numbers must not
          // keep masquerading as current — and report inline in the panel
          // rather than toasting once per edit while the backend is down.
          if (!ctrl.signal.aborted) {
            setAffinity(null);
            setScoreFailed(true);
          }
        });
    }, AFFINITY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [affinityKey]);

  // Below the threshold the last result is simply not shown — gating at
  // render time avoids a synchronous setState-in-effect just to clear it.
  const shownAffinity = affinityKey === null ? null : affinity;

  const charaById = useMemo(
    () => new Map(catalog.map((e) => [e.chara_id, e])),
    [catalog]
  );
  // null when the catalog is unavailable — BlueprintTree then falls back
  // to the slot's backing veteran before resorting to a numeric id.
  const charaName = (charaId: number) => charaById.get(charaId)?.name ?? null;
  const traineeEntry = design.trainee === null ? undefined : charaById.get(design.trainee);
  const traineeIcon = traineeEntry
    ? iconIndex[String(traineeEntry.card_ids[0])]
    : undefined;

  const sparkTotals = useMemo(
    () => aggregateSparks(design, veterans),
    [design, veterans]
  );

  const dirty = savedJson === null
    ? JSON.stringify(toApi(design)) !== JSON.stringify(toApi(emptyDesign()))
    : savedJson !== JSON.stringify(toApi(design));

  const applyPick = (pick: SlotPick) => {
    const target = pickerFor;
    setPickerFor(null);
    if (target === null) return;
    if (target === "trainee") {
      setDesign((d) => ({ ...d, trainee: pick.chara_id }));
      return;
    }
    const value: SlotValue = pick.veteran
      ? rosterSlot(pick.veteran)
      : catalogSlot(pick.chara_id, pick.card_id);
    setDesign((d) =>
      target === "p1" || target === "p2"
        ? setParentSlot(d, target, value, pick.veteran)
        : { ...d, slots: { ...d.slots, [target]: value } }
    );
  };

  const clearSlot = (target: "trainee" | SlotId) => {
    setDesign((d) => {
      if (target === "trainee") return { ...d, trainee: null };
      if (target === "p1" || target === "p2") return setParentSlot(d, target, null);
      return { ...d, slots: { ...d.slots, [target]: null } };
    });
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

      <BlueprintTree
        design={design}
        veterans={veterans}
        loaded={loaded}
        charaName={charaName}
        traineeIcon={traineeIcon}
        iconIndex={iconIndex}
        affinity={shownAffinity}
        onOpen={setPickerFor}
        onClear={clearSlot}
      />

      <div className="designer-panels">
        <AffinityPanel affinity={shownAffinity} failed={affinityKey !== null && scoreFailed} />
        <SparkTotals totals={sparkTotals} />
      </div>

      {pickerFor !== null && (
        <SlotPicker
          title={pickerFor === "trainee" ? "Choose Trainee" : `Choose ${SLOT_LABELS[pickerFor]}`}
          catalog={catalog}
          veterans={pickerFor === "trainee" ? null : veterans}
          iconIndex={iconIndex}
          conflict={(charaId) => slotConflicts(design, pickerFor, charaId)}
          onPick={applyPick}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}
