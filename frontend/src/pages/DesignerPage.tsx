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
  ApiError,
  api,
  type AffinityRequest,
  type AffinityResult,
  type AptitudeLetters,
  type Blueprint,
  type BlueprintIn,
  type CatalogCard,
  type CatalogEntry,
  type FactorRef,
  type PinkSpark,
  type SlotFactor,
  type Veteran,
} from "../api";
import { FocusPanel } from "../components/FocusPanel";
import { SlotPicker, type SlotPick } from "../components/SlotPicker";
import { TreeMap } from "../components/TreeMap";
import {
  NAMED_COUNT,
  UNTITLED,
  applyPull,
  canPullInto,
  catalogSlot,
  clearNodes,
  copyName,
  emptyDesign,
  fromApi,
  halfOf,
  lockedBy,
  nextUntitledName,
  nodeLabel,
  ownedBranch,
  planPull,
  readOpenId,
  slotConflicts,
  sourceAt,
  sparkLocked,
  toAffinityRequest,
  toApi,
  withDeep,
  withDeepCard,
  withNamed,
  withFactors,
  withSpark,
  writeOpenId,
  type Design,
} from "../blueprint";
import { charaPlaceholder } from "../domain";

// Matches the styles.css breakpoint where the map drops below the panel.
const HALF_TREE_QUERY = "(max-width: 860px)";
// Long enough that a run of picks collapses into one PUT, short enough that
// the design on the server is never far behind the one on screen.
const AUTOSAVE_MS = 800;
// Failed writes stay queued and retry on a widening delay, capped so a
// backend that comes back after lunch is still picked up promptly.
const RETRY_MS = 4000;
const RETRY_MAX_MS = 30000;
// Scoring is a POST per edit, so it waits out a burst of picks. Shorter than
// the autosave: this one has a number on screen waiting on it.
const AFFINITY_DEBOUNCE_MS = 250;

// One bootstrap create per page load, shared across mounts. The page
// unmounts on every route change, so a quick Designer → Roster → Designer
// can otherwise have the second mount's GET race the first mount's POST,
// see an empty list, and create a second blank blueprint. Cleared on settle,
// so this only ever collapses genuinely concurrent attempts.
let inflightBootstrap: Promise<Blueprint> | null = null;
function bootstrapBlueprint(): Promise<Blueprint> {
  inflightBootstrap ??= api
    .createBlueprint({ name: nextUntitledName([]), slots: toApi(emptyDesign()).slots })
    .finally(() => {
      inflightBootstrap = null;
    });
  return inflightBootstrap;
}

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
  veterans,
  iconIndex,
  design,
  setDesign,
  savedJson,
  setSavedJson,
  onError,
}: {
  // The shell's roster, not a copy: it already fetches this list for the
  // roster page and replaces it after every import, and the import button
  // sits in the header on this route too. Fetching our own would both
  // duplicate the largest response the app makes and freeze it at mount, so
  // a pull after an import would snapshot a veteran the full-replace just
  // deleted. Optional throughout — an empty roster (or a failed fetch) costs
  // you the shortcut, never the designer.
  veterans: Veteran[];
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
  // Whether the catalog fetch has SETTLED, which is not the same as whether
  // it returned anything: a failed fetch leaves the list empty forever, and
  // names have to degrade to ids then rather than staying blank.
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  // The pickable sparks. Static reference data like the catalog, and fetched
  // beside it: a failure costs the hand-entry search its results and shows
  // stored sparks as "Unknown (key)", but every proc estimate reads the
  // design and keeps working.
  const [factorRefs, setFactorRefs] = useState<FactorRef[]>([]);
  // Which tree node the focus panel shows. Ephemeral by design — a route
  // round-trip resets to the trainee, the design itself survives.
  const [selected, setSelected] = useState(0);
  const [affinity, setAffinity] = useState<AffinityResult | null>(null);
  const [scoreFailed, setScoreFailed] = useState(false);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  // Set while a write has failed and not yet succeeded. Counted, not just
  // flagged, so a repeat of the same message still re-arms the retry — and
  // so the status can say "not saved" instead of reading "Saving…" forever.
  // There is no Save button to fall back on, so a silent failure is an
  // afternoon of lost work.
  const [saveFail, setSaveFail] = useState<{ n: number; message: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // One bootstrap per mount, whatever StrictMode does with the effect —
  // creating a blueprint is not a repeatable side effect.
  const bootstrapped = useRef(false);

  // ---------- the write queue ----------
  // The bodies the server still needs, keyed by the row each belongs to
  // (null = a design with no row yet). A ref rather than effect-closure
  // state: switching blueprints re-renders, and an edit that lived only in
  // the old effect's closure would die with it. A leftover entry for the
  // blueprint you just left is precisely what makes switching lossless.
  const pending = useRef(new Map<number | null, BlueprintIn>());
  // Writes run one behind another, so a slow PUT can never land after a
  // newer one and restore an older document under a "Saved" label.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside async continuations to answer "is this still the blueprint
  // on screen?": a write that lands after a switch belongs to the design
  // you left and must not mark the newly opened one clean.
  const openRow = useRef<number | null>(design.id);
  const dirtyRef = useRef(false);
  // Rows this page deleted. A delete races the edit that was still queued
  // for the row: without this the queued body PUTs into the hole, 404s, and
  // the re-create recovery below resurrects the blueprint the user just
  // threw away.
  const deleted = useRef(new Set<number>());

  // A blank name field saves as the placeholder rather than not saving at
  // all — the server rejects an empty name, and "we'll save it later" is how
  // an afternoon disappears. The dirty check normalizes the same way, so a
  // stray space can't read as a permanent unsaved edit.
  const bodyOf = useCallback((d: Design): BlueprintIn => {
    const body = toApi(d);
    const name = body.name.trim();
    return { ...body, name: name === "" ? UNTITLED : name };
  }, []);

  const dirty =
    savedJson === null
      ? JSON.stringify(bodyOf(design)) !== JSON.stringify(bodyOf(emptyDesign()))
      : savedJson !== JSON.stringify(bodyOf(design));

  useEffect(() => {
    openRow.current = design.id;
    dirtyRef.current = dirty;
  }, [design.id, dirty]);

  // One queued write. Creates when the design has no row — a failed
  // bootstrap, a failed post-delete create, a blueprint deleted out from
  // under us — so "nowhere to save" is a state the page recovers from
  // rather than a dead end where every later edit is silently discarded.
  const writeOne = useCallback(
    async (id: number | null, body: BlueprintIn): Promise<void> => {
      const land = (bp: Blueprint) => {
        setSaved((prev) =>
          prev.some((b) => b.id === bp.id)
            ? prev.map((b) => (b.id === bp.id ? bp : b))
            : [bp, ...prev]
        );
        if (bp.id !== id) {
          // The job was filed under a key that no longer exists. Anything
          // queued behind it moves onto the new row, or the next drain would
          // create a second copy instead of updating this one.
          const queued = pending.current.get(id);
          if (queued !== undefined) {
            pending.current.delete(id);
            pending.current.set(bp.id, queued);
          }
        }
        if (openRow.current === id) {
          if (bp.id !== id) {
            setDesign((d) => ({ ...d, id: bp.id }));
            writeOpenId(bp.id);
          }
          setSavedJson(JSON.stringify(body));
        }
        setSaveFail(null);
      };
      try {
        land(id === null ? await api.createBlueprint(body) : await api.updateBlueprint(id, body));
      } catch (e) {
        // Deleted elsewhere: re-create rather than keep PUTting into a hole.
        // Not for a row we deleted ourselves — that 404 means the delete won
        // a race with an already-drained write, and re-creating would undo it.
        if (
          id !== null &&
          !deleted.current.has(id) &&
          e instanceof ApiError &&
          e.status === 404
        ) {
          try {
            land(await api.createBlueprint(body));
            onError(`"${body.name}" had been deleted — your edits were saved as a new blueprint.`);
            return;
          } catch {
            // fall through to the retry path
          }
        }
        // Back on the queue: the retry timer (or the next edit) carries it.
        if (!pending.current.has(id)) pending.current.set(id, body);
        const message = e instanceof Error ? e.message : String(e);
        setSaveFail((f) => ({ n: (f?.n ?? 0) + 1, message }));
      }
    },
    [onError, setDesign, setSavedJson]
  );

  // Drains the queue, oldest row first, behind whatever is already running.
  const write = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current.size === 0) {
      await chain.current;
      return;
    }
    const jobs = [...pending.current].filter(
      ([id]) => id === null || !deleted.current.has(id)
    );
    pending.current.clear();
    if (jobs.length === 0) {
      await chain.current;
      return;
    }
    const run = chain.current.then(async () => {
      setAutosaving(true);
      try {
        for (const [id, body] of jobs) await writeOne(id, body);
      } finally {
        setAutosaving(false);
      }
    });
    chain.current = run;
    await run;
  }, [writeOne]);

  // Adopt a server blueprint as the working design: parse it, remember it as
  // the one to reopen, and mark it clean so the autosave stays quiet.
  // Callers flush first — adopting is what makes the previous design
  // unreachable, so anything still queued for it has to be on the wire.
  const adopt = useCallback(
    (bp: Blueprint) => {
      try {
        const d = fromApi(bp);
        setDesign(d);
        setSavedJson(JSON.stringify(bodyOf(d)));
        writeOpenId(bp.id);
        setSelected(0);
        // The score belongs to the blueprint you just left. Keyed on the
        // request payload alone it would survive the switch — the new design
        // is scorable too — and the incoming blueprint would wear the old
        // one's total, band and six per-node numbers until the debounce and
        // round trip finished. Cleared here rather than in the scoring
        // effect: this is the one place a design's IDENTITY changes.
        setAffinity(null);
        setScoreFailed(false);
      } catch {
        // Left alone rather than opened half-parsed: editing it here would
        // overwrite whatever the row actually holds. The design on screen
        // keeps its null id, which the autosave turns into a new row.
        onError(
          `Couldn't open "${bp.name}" — its saved data didn't parse. Your next edit starts a new blueprint.`
        );
      }
    },
    [setDesign, setSavedJson, onError, bodyOf]
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
  // Every selection remembers which half it was in, so the toggle and the
  // selection can't disagree: without this, selecting the trainee (which
  // belongs to both halves) falls back to whatever the toggle was last set
  // to and yanks the view to the other parent's branch.
  const select = (i: number) => {
    setSelected(i);
    if (i !== 0) setSide(halfOf(i));
  };
  const selectFromMap = (i: number) => {
    select(i);
    if (!narrow) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // After paint: the panel changes height with the node it shows.
    requestAnimationFrame(() =>
      panelRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
    );
  };

  useEffect(() => {
    // All three fetches are page-scoped (catalog and the factor reference are
    // static, the saved list is small) — refetching per visit keeps the shell
    // out of it.
    let cancelled = false;
    void (async () => {
      const [cat, bps, factors] = await Promise.allSettled([
        api.catalog(),
        api.blueprints(),
        api.factors(),
      ]);
      if (cancelled) return;
      if (cat.status === "fulfilled") setCatalog(cat.value);
      if (factors.status === "fulfilled") setFactorRefs(factors.value);
      setCatalogLoaded(true);
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
      // Never adopt over work in progress. The map and the spark editor are
      // usable before this fetch lands, and on a slow link people do start
      // designing — a dirty design is one the autosave already owns, whether
      // it has a row yet or not.
      if (dirtyRef.current) return;
      const held = design.id === null ? null : bps.value.find((b) => b.id === design.id);
      if (held !== undefined && held !== null) return;
      const lastOpen = readOpenId();
      const target =
        bps.value.find((b) => b.id === lastOpen) ??
        [...bps.value].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (target !== undefined) {
        adopt(target);
        return;
      }
      try {
        const bp = await bootstrapBlueprint();
        // Remembered even if we've already unmounted: the row exists, so the
        // next visit must reopen it rather than create a second blank one.
        writeOpenId(bp.id);
        if (cancelled) return;
        setSaved([bp]);
        adopt(bp);
      } catch {
        // Recoverable: with no row, the first edit creates one.
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
  // "Not known yet" and "not known" are different answers, and only the
  // second deserves a numeric placeholder. The blueprint fetch regularly
  // lands before the catalog, so a shared null made every reload flash
  // "Chara 1006" across the map for a frame. Null here means "no name to
  // show yet"; consumers hold the space instead of inventing one.
  const charaName = useCallback(
    (charaId: number): string | null =>
      charaById.get(charaId)?.name ?? (catalogLoaded ? charaPlaceholder(charaId) : null),
    [charaById, catalogLoaded]
  );
  const aptitudesFor = useCallback(
    (cardId: number): AptitudeLetters | null => cardById.get(cardId)?.aptitudes ?? null,
    [cardById]
  );
  const outfitFor = useCallback(
    (cardId: number) => cardById.get(cardId)?.outfit ?? null,
    [cardById]
  );

  // ---------- run affinity ----------
  // Scoring threshold: a trainee plus at least one parent. Below that there
  // is no pairing to score, and an empty request would come back as a
  // confident zero. Keyed on the request JSON, so renaming the blueprint or
  // typing a spark four generations down doesn't re-score — only the six
  // slots and the trainee are in it.
  const affinityKey = useMemo(() => {
    const request = toAffinityRequest(design);
    const scorable =
      request.trainee_chara_id !== null && (request.p1 != null || request.p2 != null);
    return scorable ? JSON.stringify(request) : null;
  }, [design]);

  useEffect(() => {
    if (affinityKey === null) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api
        .scoreAffinity(JSON.parse(affinityKey) as AffinityRequest, ctrl.signal)
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
  // The failure goes with it: emptying the tree after a failed score should
  // leave the "pick a trainee" hint, not an error about a request that is no
  // longer being made.
  const shownAffinity = affinityKey === null ? null : affinity;
  const shownScoreFailed = affinityKey !== null && scoreFailed;
  // Scorable, but no answer yet — the debounce, the request, or a blueprint
  // switch that just cleared the previous one. Distinguishes "waiting" from
  // "you haven't picked enough yet", which look identical from `affinity`.
  const affinityPending = shownAffinity === null && !shownScoreFailed && affinityKey !== null;

  const applyPick = (pick: SlotPick) => {
    const target = pickerFor;
    // NOT closed yet: the roster branch below may still ask for confirmation,
    // and cancelling that has to leave the picker exactly as it was — closing
    // first would throw away the search and filters on the way to a dialog
    // the user then declined.
    if (target === null || lockedBy(design, target) !== null) {
      setPickerFor(null);
      return;
    }
    // A deep slot holds a bare spark, so a pick there is a face on the pink
    // that's already in it — the character it came from, annotated by hand
    // instead of by a pull. Nothing else about the node changes...
    if (pick.kind === "catalog" && target >= NAMED_COUNT) {
      setPickerFor(null);
      setDesign((d) => {
        // ...unless the node was itself pulled, in which case this is the
        // same replace the named path does below and it takes the same
        // cleanup: her gen-4 parents and her own pink go with her. Leaving
        // them would hang her real ancestry under a hand-picked character
        // who doesn't have it, unlocked because `lockedBy` no longer finds a
        // roster node above it.
        if (sourceAt(d, target) !== "roster") return withDeepCard(d, target, pick.card_id);
        return withDeep(clearNodes(d, ownedBranch(d, target)), target, {
          card_id: pick.card_id,
        });
      });
      select(target);
      return;
    }
    if (pick.kind === "catalog") {
      setPickerFor(null);
      setDesign((d) => {
        // Replacing a roster pick drops its branch, exactly as clearing it
        // would — otherwise that veteran's ancestry would hang under a
        // hand-picked character who doesn't have it, unlocked and unowned.
        // Her pink goes with it: it was hers, not a plan for this slot.
        const owned = ownedBranch(d, target);
        const spark = sourceAt(d, target) === "roster" ? null : (d.named[target]?.spark ?? null);
        // A re-pick otherwise keeps the slot's typed spark: the pink is a
        // plan input for the bracket math, not part of the card's identity,
        // and re-typing it after every swap would be pure friction.
        return withNamed(
          clearNodes(d, owned),
          target,
          catalogSlot(pick.chara_id, pick.card_id, spark)
        );
      });
      select(target);
      return;
    }
    // A roster pull replaces the node's whole branch, so unlike a catalog
    // pick it can destroy work you didn't click on. Ask once, listing
    // everything hand-authored that would go — never once per node, which
    // would be a dialog per generation for one pick and teach people to
    // dismiss blind. Empty and already-pulled nodes go in silence: neither
    // was ever authored by hand, so there is nothing to lose.
    //
    // Planned against the design as it stands on screen rather than inside
    // the setDesign updater: window.confirm blocks, and blocking inside a
    // state updater (which React may run twice) would prompt twice.
    const plan = planPull(design, target, pick.veteran);
    if (plan.clobbers.length > 0) {
      const what = plan.clobbers.map(nodeLabel).join(", ");
      // "Your own picks", not "what you entered by hand": the list covers
      // catalog picks, earlier roster picks and typed sparks alike, and the
      // last two aren't typed at all.
      const ok = window.confirm(
        `Pulling ${pick.veteran.name} replaces ${nodeLabel(target)} and everything ` +
          `below it with its own pedigree.\n\nYour own picks at ${what} will be lost.` +
          `\n\nContinue?`
      );
      // Cancel leaves the picker open on the list you were already looking
      // at, so declining costs nothing but the click.
      if (!ok) return;
    }
    setPickerFor(null);
    setDesign((d) => applyPull(d, plan));
    select(target);
  };

  // A hand-placed node clears alone — nothing below it belongs to it. A
  // roster pick takes its whole branch: those nodes ARE that veteran's
  // ancestry, so leaving them would hang a pedigree under nobody, and leave
  // it unlocked now that the veteran enforcing the lock is gone. No confirm,
  // because nothing hand-authored can be down there — the branch has been
  // read-only since the pull.
  //
  // The lock is re-checked inside the updater, not just in the panel that
  // hides the controls: it's a rule about the design, and a stale render or
  // a keyboard path shouldn't be able to slip an edit past it.
  const clearSlot = (target: number) => {
    setDesign((d) =>
      lockedBy(d, target) !== null ? d : clearNodes(d, [target, ...ownedBranch(d, target)])
    );
  };

  const setSpark = (target: number, spark: PinkSpark | null) => {
    setDesign((d) => (sparkLocked(d, target) ? d : withSpark(d, target, spark)));
  };

  // Same lock as the pink: inside a pulled branch (and on the roster pick
  // herself) these sparks are the horse's own, read off her dump.
  const setFactors = (target: number, factors: SlotFactor[]) => {
    setDesign((d) => (sparkLocked(d, target) ? d : withFactors(d, target, factors)));
  };

  // Every edit autosaves. Queued immediately (so nothing depends on this
  // effect surviving), then debounced so a burst of picks is one request.
  // While a create/delete is in flight the edit stays queued rather than
  // racing it for the same row — the next drain carries it.
  useEffect(() => {
    if (!dirty) return;
    // A delete in flight has already disowned this row; queueing for it
    // would only re-create what the user just deleted.
    if (design.id !== null && deleted.current.has(design.id)) return;
    pending.current.set(design.id, bodyOf(design));
    if (busy) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void write();
    }, AUTOSAVE_MS);
    // No cleanup: re-arming is what replaces the old timer, and unmounting
    // must flush the queue (below) rather than cancel it.
  }, [design, dirty, busy, bodyOf, write]);

  // A failed write stays queued and retries quietly on a widening delay.
  // The backend being down for a minute shouldn't cost anything, and a toast
  // per attempt would make the page unusable.
  useEffect(() => {
    if (saveFail === null || pending.current.size === 0) return;
    const t = setTimeout(
      () => void write(),
      Math.min(RETRY_MAX_MS, RETRY_MS * saveFail.n)
    );
    return () => clearTimeout(t);
  }, [saveFail, write]);

  // Leaving the page is a route change, which unmounts this component —
  // that must not eat the last debounce window.
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);
  useEffect(() => () => void writeRef.current(), []);

  const onLoad = async (id: number) => {
    const bp = saved.find((b) => b.id === id);
    if (bp === undefined) return;
    // The blueprint you're leaving keeps the last thing you did to it.
    await write();
    adopt(bp);
  };

  // A blank row, created straight away: the design you're editing is always
  // a real blueprint, so there's nothing to "save" later.
  const onNew = async () => {
    await write();
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
    await write();
    setBusy(true);
    try {
      const body = bodyOf(design);
      const bp = await api.createBlueprint({ ...body, name: copyName(body.name, saved) });
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
    if (!window.confirm(`Delete "${bodyOf(design).name}"?`)) return;
    setBusy(true);
    // Whatever is queued for this row dies with it — including anything the
    // still-dirty design queues while the DELETE is in flight.
    deleted.current.add(id);
    pending.current.delete(id);
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    try {
      await api.deleteBlueprint(id);
    } catch (e) {
      // Still very much alive: let it save again, or the rest of the session
      // would edit a blueprint nothing writes.
      deleted.current.delete(id);
      onError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
      return;
    }
    // Past here the row is gone, so a later failure is never reported as a
    // failed delete — and never leaves the page bound to a dead id.
    const rest = saved.filter((b) => b.id !== id);
    setSaved(rest);
    if (rest.length > 0) {
      adopt([...rest].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]);
      setBusy(false);
      return;
    }
    setDesign(emptyDesign());
    setSavedJson(null);
    writeOpenId(null);
    setSelected(0);
    try {
      const bp = await api.createBlueprint({
        name: nextUntitledName([]),
        slots: toApi(emptyDesign()).slots,
      });
      setSaved([bp]);
      adopt(bp);
    } catch (e) {
      // The blank stays on screen with no row; the first edit creates one.
      onError(
        `Couldn't open a replacement blueprint: ${
          e instanceof Error ? e.message : String(e)
        }. Your next edit starts one.`
      );
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
              // Blank saves as the placeholder, so the field is made to
              // agree once you're done typing rather than showing an empty
              // name for a blueprint the server calls "Untitled Blueprint".
              onBlur={() =>
                setDesign((d) => (d.name.trim() === "" ? { ...d, name: UNTITLED } : d))
              }
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
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      void onLoad(bp.id);
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
            every edit autosaves. The status is the whole story — including
            when it has nothing good to report, which is why the bar renders
            even before a row exists rather than leaving a design that can't
            say whether it's being kept. */}
        {/* Whole-blueprint actions, out of the menu: they act on the one
            you're in, which is what the bar is about. The status trails
            them — it changes width as it flips, and between the picker
            and the buttons that would shove the buttons around. */}
        <button
          className="bar-icon"
          aria-label={`Duplicate ${design.name}`}
          title="Duplicate this blueprint"
          disabled={busy || design.id === null}
          onClick={() => void onCopy()}
        >
          <CopyIcon />
        </button>
        <button
          className="bar-icon bar-icon-danger"
          aria-label={`Delete ${design.name}`}
          title="Delete this blueprint"
          disabled={busy || design.id === null}
          onClick={() => void onDelete()}
        >
          <TrashIcon />
        </button>
        <span
          className={`designer-autosave${saveFail !== null ? " failed" : ""}`}
          role="status"
          title={saveFail?.message}
        >
          {saveFail !== null ? "Not saved" : autosaving || dirty ? "Saving…" : "Saved"}
        </span>
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
            affinity={shownAffinity}
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
            affinity={shownAffinity}
            affinityFailed={shownScoreFailed}
            affinityPending={affinityPending}
            factorRefs={factorRefs}
            onOpenPicker={setPickerFor}
            onClear={clearSlot}
            onSetSpark={setSpark}
            onSetFactors={setFactors}
          />
        </div>
      </div>

      {pickerFor !== null && (
        <SlotPicker
          title={`Choose ${nodeLabel(pickerFor)}`}
          catalog={catalog}
          veterans={veterans}
          rosterBlocked={!canPullInto(pickerFor)}
          iconIndex={iconIndex}
          conflict={(charaId, kind) =>
            slotConflicts(design, pickerFor, charaId, kind === "roster")
          }
          onPick={applyPick}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}
