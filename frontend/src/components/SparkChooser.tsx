import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  APTITUDE_KEYS,
  detailOr,
  LIST_SPARK_KINDS,
  SLOT_FACTOR_KINDS,
  type AptitudeKey,
  type FactorRef,
  type ListSparkKind,
  type PinkSpark,
  type SlotFactor,
  type SlotFactorKind,
  type SparkList,
} from "../api";
import { APTITUDE_LABELS, UNDROPPABLE_TITLE, undroppableMessage } from "../aptitude";
import { ListFilter } from "./ListFilter";
import { refocus } from "./refocus";
import { deriveCharaId, factorsWith } from "../blueprint";
import { SPARK_TYPE_LABELS, SPARK_TYPE_ORDER, sparkId } from "../procs";
import { byQueryRank } from "../rank";
import {
  createListWith,
  favorites as unionOf,
  listById,
  ListGone,
  listsWith,
  syncMembership,
  withMembership,
  withStamp,
  type SparkListStore,
} from "../sparks";

// What the list filter dimension can speak about — every other kind passes
// it untouched, since a list could never name one.
const LISTABLE = new Set<string>(LIST_SPARK_KINDS);

// One list's membership as row ids — what a pressed pill contributes.
const membershipIds = (list: SparkList): Set<string> =>
  new Set(list.sparks.map((s) => sparkId({ type: s.kind, key: s.key })));

// The EDITOR for a member's sparks: a popout that BROWSES the 437
// factors with your favorites on top (DECISIONS.md #35, #41). Adding includes
// the LEVEL — three buttons per row, so a 3★ is one click at the moment you
// are choosing the spark (#34) — and a held row keeps the same three buttons
// live with the current level pressed, plus the ✕ that removes, IN PLACE in
// its own section: held-ness is row STATE, never row position. Filter pills
// in the search band narrow the browse — Current Sparks to what the member
// holds, and one pill per spark list, whose presses persist as the active
// selection the trainee's table also reads (DECISIONS.md #43). The table
// behind it displays and never edits: every act that changes a chance
// happens in here, where nothing can move a row (#41).
//
// FAVOURITING is a different act from adding, deliberately: a filler white you
// type onto every node must not land in the sparks the active lists mark as
// hunted (DECISIONS.md #43), and a row must not move under the pointer that
// just clicked it.
//
// The ★ OPENS A LIST PICKER rather than toggling one flag (DECISIONS.md #37).
// A favorite is a spark in at least one of the user's named lists, so "star
// this" has to say WHICH list — and with several lists active at once, "the
// active one" names nothing unambiguous. The picker doubles as the membership
// editor, and `New List` lives in it so a user with no lists needs no separate
// settings surface.
//
// A roster or lineage pick never needs any of this — hers are decoded from the
// dump — so it only appears on hand-built nodes, and never inside a locked
// branch.

// The FACTOR browse sections, in the order the spark tables group by
// (procs.ts). The pink browses too (#87), but through its own rows below —
// its slot in this order is where the Pink section renders.
const BROWSE_KINDS: SlotFactorKind[] = [...SLOT_FACTOR_KINDS].sort(
  (a, b) => SPARK_TYPE_ORDER[a] - SPARK_TYPE_ORDER[b]
);

// The pink rows: a PARALLEL shape to Option, not a sixth kind of it. The
// document keys a pink by APTITUDE on the slot's own `spark` field — not a
// factor key in `factors` — so these ten come from the client's aptitude
// vocabulary (the Details editor's own), never from `/api/factors`, and none
// of the keyed-factor machinery (refs, orphans, the green possibility rules)
// applies to them.
type PinkOption = { aptitude: AptitudeKey; name: string };

const PINK_OPTIONS: PinkOption[] = APTITUDE_KEYS.map((aptitude) => ({
  aptitude,
  name: APTITUDE_LABELS[aptitude],
}));

// A green spark's factor key IS a card_id — `app/ingest.py` says so in its
// header, the reference agrees (95 of the 97 released cards have a unique
// factor at their own id), and a real roster agrees at n=1372: every veteran
// and lineage member carries at most ONE green, and it is always her own card.
// A uma can LEARN another uma's unique during a run; she can never carry the
// spark for one.
//
// So the green a node can hold is decided by who is cast in it. One rule,
// three tiers (DECISIONS.md #36):
//
//   card known      → her card's unique, which is one row or none
//   chara only      → that character's 1–3 variants
//   neither         → all 137, each named with the uma it belongs to
//
// The middle tier covers a slot carrying `chara_id` without `card_id`: the
// picker always sets both, but the type allows it. Only `unique` is
// card-bound — blue, pink, race, white and scenario belong to anyone.
const greenFilter =
  (cardId: number | null, charaId: number | null) =>
  (option: Option): boolean => {
    if (option.kind !== "unique") return true;
    if (cardId !== null) return option.key === cardId;
    if (charaId !== null) return deriveCharaId(option.key) === charaId;
    return true;
  };

// A row the chooser can offer: a spark from the reference, or one the
// reference doesn't know. List membership is deliberately not validated
// against `app/data` (#37) — the reference is regenerated by hand and can run
// behind a dump — so a favorite may resolve to no name and still be addable.
type Option = { kind: SlotFactorKind; key: number; name: string };

// A row that can be in a list. Blues and greens can't: a list is a hunt, and
// neither is hunted — every parent carries her blue and her own green
// regardless. Their rows render no ★, and the narrowed kind is what lets the
// write path refuse them at compile time, matching the server's refusal.
type ListableSpark = { kind: ListSparkKind; key: number };

const listableOf = (o: Option): ListableSpark | null =>
  (LIST_SPARK_KINDS as readonly string[]).includes(o.kind)
    ? { kind: o.kind as ListSparkKind, key: o.key }
    : null;

const optionOf = (ref: FactorRef): Option => ref;

const unknownOption = (spark: { kind: SlotFactorKind; key: number }): Option => ({
  kind: spark.kind,
  key: spark.key,
  // The same degradation ProcPanel uses for a stored spark the reference
  // can't name, rather than a blank row.
  name: `Unknown (${spark.key})`,
});

/**
 * The membership editor for one spark: every list, checked where it holds it,
 * plus a field that makes a new one.
 *
 * Rendered UNDER the row rather than as a nested dialog — the popout is 358px
 * on a 390px phone, the row already carries a ★, a kind tag, a name and three
 * add buttons, and a dialog inside a dialog is a focus-trap problem for a
 * control this small.
 *
 * With no lists at all this is just the field, which is the zero-list first
 * run and the only place `New List` needs to exist.
 */
function ListPicker({
  lists,
  kind,
  factorKey,
  name,
  busy,
  listsFailed,
  onToggleList,
  onCreateList,
}: {
  lists: SparkList[];
  kind: ListSparkKind;
  factorKey: number;
  name: string;
  busy: boolean;
  // The ★ that discloses this picker is disabled when the lists failed to
  // load; without the same guard here, an ALREADY-OPEN picker stays writable
  // after the app has proven its copy stale — and a pill click would compute
  // its verb from that stale copy, flipping one spark the wrong way.
  listsFailed: boolean;
  // Fire-and-forget: the flip is optimistic (issue #69), so the pill never
  // disables and never loses focus — #74's restore dance is only for the
  // awaited create below.
  onToggleList: (listId: number) => void;
  // Resolves false when the server refused the name, which is when the field
  // must keep it.
  onCreateList: (listName: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  // The field, not the event target: Enter and the Add button both land here,
  // and after a successful create the button disables with the emptied draft
  // while the field is where the next name gets typed (#74).
  const inputRef = useRef<HTMLInputElement>(null);
  // Cleared only once the list exists, so correcting a name collision doesn't
  // mean retyping it from scratch.
  const submit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") return;
    const restore = refocus(inputRef.current);
    void onCreateList(trimmed)
      .then((made) => {
        if (made) setDraft("");
      })
      .finally(restore);
  };
  return (
    <div className="spark-lists" role="group" aria-label={`Lists for ${name}`}>
      {lists.map((list) => {
        const holds = list.sparks.some(
          (s) => s.kind === kind && s.key === factorKey
        );
        return (
          <button
            key={list.id}
            className={holds ? "spark-list-pill active" : "spark-list-pill"}
            aria-pressed={holds}
            // Both identities on the control: anything driving this by
            // displayed name would have to disambiguate two lists whose names
            // differ only in case, and two whites both called "Pressure".
            data-list={list.id}
            data-spark={sparkId({ type: kind, key: factorKey })}
            // Names the OUTCOME, not the list: a chip labelled with a name
            // alone reads as a tag rather than a control.
            aria-label={
              holds
                ? `Remove ${name} from ${list.name}`
                : `Add ${name} to ${list.name}`
            }
            title={holds ? `Remove from ${list.name}` : `Add to ${list.name}`}
            disabled={listsFailed}
            onClick={() => onToggleList(list.id)}
          >
            {list.name}
            {/* A glyph inside the button, never a nested one — a button in a
                button is invalid, and two hit targets for one action is a miss
                waiting to happen at 358px. */}
            <span className="spark-list-mark" aria-hidden="true">
              {holds ? "✕" : "+"}
            </span>
          </button>
        );
      })}
      <span className="spark-list-new">
        <input
          ref={inputRef}
          className="uma-search"
          type="text"
          aria-label={`New list for ${name}`}
          placeholder="New List…"
          // Matches `SparkListName`'s bound, so the limit is felt as the field
          // refusing a 41st character rather than as a save that fails after.
          // The server still enforces it.
          maxLength={40}
          value={draft}
          disabled={busy || listsFailed}
          onChange={(e) => setDraft(e.target.value)}
          // `isComposing` guards the IME: confirming a candidate in Japanese
          // input is an Enter keydown too, and acting on it would create a list
          // named with the pre-conversion kana — permanently, since nothing
          // renames or deletes one yet.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="spark-list-add"
          aria-label={`Create list for ${name}`}
          disabled={busy || listsFailed || draft.trim() === ""}
          onClick={submit}
        >
          Add
        </button>
      </span>
    </div>
  );
}

// One row's whole anatomy, shared by every section: the held-row rules
// (#86), the reserved ✕ slot (#41) and the focus capture (#74) live once,
// so the Pink section cannot drift from the factor sections.
function SparkRow({
  id,
  kind,
  name,
  owner,
  heldAt,
  replaces,
  disabled,
  leading,
  onSet,
  onDrop,
  children,
}: {
  id: string;
  kind: SlotFactorKind | "pink";
  name: string;
  // Whose green this is — 137 anonymous greens is a list you cannot
  // navigate. null for every other kind, and for the 42 uniques whose card
  // has not reached Global.
  owner: string | null;
  heldAt: number | undefined;
  // What an add on this row silently REPLACES, where the section is
  // one-per-member (blue, pink). The label must name the displacement: the
  // held row's change happens off-focus, where nothing announces it, and
  // "Add" promises a second spark the member won't have.
  replaces: string | undefined;
  disabled: boolean;
  // The ★, or the gap that holds its 26px so the kind tags stay one column
  // across sections.
  leading: ReactNode;
  onSet: (stars: number) => void;
  onDrop: () => void;
  children?: ReactNode;
}) {
  return (
    <li>
      {leading}
      <span className="spark-hit">
        {/* The kind is part of the identity here — you are picking
            BETWEEN kinds, and several race and scenario sparks share
            wording with skills. */}
        <span className={`proc-kind proc-kind-${kind}`}>
          {SPARK_TYPE_LABELS[kind]}
        </span>
        {name}
        {owner !== null && <span className="spark-owner">{owner}</span>}
      </span>
      {/* One control shape for every row, held or not (#41). Held, the
          current level is pressed and a mis-level is one click to fix;
          clicking the pressed star is a NO-OP, never a toggle-off — the
          most common idle click must not be destructive. The three
          buttons persist across an add, so the one under the pointer
          (and under focus) survives its own click. Not a `radiogroup`
          on an unheld row: there these are three different add actions,
          each naming its own outcome, because "3★" alone is meaningless
          read out of the row it sits in. `aria-pressed` is present in
          BOTH states — absent-when-unheld makes the add flip the
          control's role from button to toggle button as a side effect
          of its own click; false keeps the role while the state and
          label carry the change. */}
      <span className="seg-group" role="group">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            className={heldAt === n ? "seg active" : "seg"}
            data-spark={id}
            data-stars={n}
            disabled={disabled}
            aria-pressed={heldAt === n}
            aria-label={
              heldAt !== undefined
                ? `Set ${name} to ${n}★`
                : replaces === undefined
                  ? `Add ${name} at ${n}★`
                  : `Replace ${replaces} with ${name} at ${n}★`
            }
            onClick={(e) => {
              if (heldAt === n) return;
              // Captured ONLY for a displacing click (#74): it unmounts the
              // held row's ✕, which may hold focus. A plain add or re-level
              // unmounts nothing, and capturing there arms a stale restore
              // that can answer a LATER action's focus drop by grabbing a
              // live star button — the Enter-auto-repeat hazard the row
              // restore target exists to avoid.
              const restore = replaces === undefined ? null : refocus(e.currentTarget);
              onSet(n);
              restore?.();
            }}
          >
            {n}★
          </button>
        ))}
      </span>
      {/* Focus is captured before the click unmounts this button
          (#74). The slot is held on EVERY row, blank where there is
          nothing to remove: a ✕ that materialized with the add
          measured a 27px leftward shove of the stars under the
          pointer that had just clicked them (#41). */}
      {heldAt !== undefined ? (
        <button
          className="spark-drop"
          data-spark={id}
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            const restore = refocus(e.currentTarget);
            onDrop();
            restore();
          }}
        >
          ✕
        </button>
      ) : (
        <span className="spark-drop-blank" aria-hidden="true" />
      )}
      {children}
    </li>
  );
}

function SparkRows({
  options,
  heldStars,
  heldBlueName,
  addable,
  lists,
  listsFailed,
  busy,
  openPicker,
  cardOwner,
  onAdd,
  onRemove,
  onOpenPicker,
  onToggleList,
  onCreateList,
}: {
  options: Option[];
  // What the member holds RIGHT NOW, by spark id, with its level — live, not
  // snapshotted. Which SECTION a row sits in is frozen per open; what its
  // controls show is the document as it stands.
  heldStars: Map<string, number>;
  // The held blue, by name — an add on any other blue row replaces her
  // (`factorsWith`), and the row's label says so. Resolved by the caller:
  // these rows only see the query's hits, which need not include her.
  heldBlueName: string | undefined;
  // Whether a row's star buttons are live, held or not. False only for a
  // green the cast can't take: re-levelling her writes the document just
  // like adding her, and the server refuses both — only her ✕ helps.
  addable: (option: Option) => boolean;
  lists: SparkList[];
  listsFailed: boolean;
  busy: boolean;
  // Which row's list picker is open, by spark id, or null. One at a time:
  // two open pickers on a 358px popout is most of the surface, and the
  // question each answers is about its own row.
  openPicker: string | null;
  // Names the uma a green belongs to. Only meaningful where the green list
  // is NOT already narrowed to one card — on a cast node the panel above
  // says whose sparks these are.
  cardOwner: (cardId: number) => string | null;
  onAdd: (option: Option, stars: number) => void;
  onRemove: (option: Option) => void;
  onOpenPicker: (id: string | null) => void;
  onToggleList: (spark: ListableSpark, listId: number) => void;
  onCreateList: (spark: ListableSpark, listName: string) => Promise<boolean>;
}) {
  return (
    <ul className="spark-matches">
      {options.map((o) => {
        const id = sparkId({ type: o.kind, key: o.key });
        const listable = listableOf(o);
        // Only where a ★ can render it: the popout shows all 447 rows and
        // re-renders on every keystroke, so a scan over every list for the
        // 142 starless factor rows is pure waste.
        const holders = listable === null ? [] : listsWith(lists, o.kind, o.key);
        const fav = holders.length > 0;
        const picking = listable !== null && openPicker === id;
        const heldAt = heldStars.get(id);
        return (
          <SparkRow
            key={id}
            id={id}
            kind={o.kind}
            name={o.name}
            owner={o.kind === "unique" ? cardOwner(o.key) : null}
            heldAt={heldAt}
            replaces={
              o.kind === "blue" && heldAt === undefined ? heldBlueName : undefined
            }
            disabled={!addable(o)}
            leading={
              /* Disabled rather than hidden when the lists didn't load, so the
                 chooser doesn't silently change shape on a fetch failure. It
                 DISCLOSES the picker rather than writing anything: filled means
                 "in at least one list", and which list is the question the
                 picker below exists to ask. */
              listable === null ? (
                <span className="spark-fav-gap" aria-hidden="true" />
              ) : (
                <button
                  className={fav ? "spark-fav active" : "spark-fav"}
                  aria-expanded={picking}
                  // The identity on the control: the reference holds two
                  // distinct whites both called "Pressure", so anything
                  // driving this list by displayed name can hit the wrong
                  // (kind, key).
                  data-spark={id}
                  // Names the STATE as well as the control: `aria-expanded`
                  // describes the picker below, not membership, so without the
                  // count every row announces identically whether or not the
                  // spark is in a list.
                  aria-label={
                    fav
                      ? `Lists for ${o.name} — in ${holders.length} of ${lists.length}`
                      : `Lists for ${o.name} — in none`
                  }
                  disabled={listsFailed || busy}
                  onClick={() => onOpenPicker(picking ? null : id)}
                >
                  {fav ? "★" : "☆"}
                </button>
              )
            }
            onSet={(n) => onAdd(o, n)}
            onDrop={() => onRemove(o)}
          >
            {/* Only for the row whose ★ is open, and on its own line: at 358px
                a fifth control on the line takes the name's width. */}
            {picking && listable !== null && (
              <ListPicker
                lists={lists}
                kind={listable.kind}
                factorKey={listable.key}
                name={o.name}
                busy={busy}
                listsFailed={listsFailed}
                onToggleList={(listId) => onToggleList(listable, listId)}
                onCreateList={(listName) => onCreateList(listable, listName)}
              />
            )}
          </SparkRow>
        );
      })}
    </ul>
  );
}

// The Pink section's rows (#87): the shared row shape, but REPLACE across
// the whole section, blue's rule held one shape further (DECISIONS.md #40):
// a member holds exactly one pink, so the ten rows are one radio and
// clicking any star moves it. Row existence is trivially frozen: all ten
// aptitudes, always. No ★ ever — pinks aren't listable (the server refuses
// them), a hunted build being named by its skills, not its aptitude.
function PinkRows({
  options,
  spark,
  onSet,
}: {
  options: PinkOption[];
  // Live off the document, like heldStars: the held row's controls track
  // every write, wherever it came from — Details' select included.
  spark: PinkSpark | null;
  onSet: (spark: PinkSpark | null) => void;
}) {
  return (
    <ul className="spark-matches">
      {options.map((o) => {
        const id = sparkId({ type: "pink", aptitude: o.aptitude });
        const heldAt = spark?.aptitude === o.aptitude ? spark.stars : undefined;
        return (
          <SparkRow
            key={id}
            id={id}
            kind="pink"
            name={o.name}
            owner={null}
            heldAt={heldAt}
            replaces={
              spark !== null && heldAt === undefined
                ? APTITUDE_LABELS[spark.aptitude]
                : undefined
            }
            disabled={false}
            leading={<span className="spark-fav-gap" aria-hidden="true" />}
            onSet={(n) => onSet({ aptitude: o.aptitude, stars: n })}
            onDrop={() => onSet(null)}
          />
        );
      })}
    </ul>
  );
}

function ChooserPopout({
  label,
  factors,
  spark,
  refs,
  sparkLists,
  cardId,
  charaId,
  cardOwner,
  undroppable,
  onAdd,
  onRemove,
  onSetSpark,
  onError,
  onClose,
}: {
  label: string;
  factors: readonly SlotFactor[];
  spark: PinkSpark | null;
  // Whether the held pink resolves below A (the panel's own `undroppableSpark`
  // verdict): this popout covers the panel's alert, so a bar pinned to the
  // popout's bottom edge echoes it — the second writer must carry the warning
  // at the moment of the write.
  undroppable: boolean;
  refs: readonly FactorRef[];
  sparkLists: SparkListStore;
  cardId: number | null;
  charaId: number | null;
  cardOwner: (cardId: number) => string | null;
  onAdd: (option: Option, stars: number) => void;
  onRemove: (option: Option) => void;
  onSetSpark: (spark: PinkSpark | null) => void;
  onError: (message: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const names = new Map(
    refs.map((r) => [sparkId({ type: r.kind, key: r.key }), r.name])
  );
  // Resolves a stored (kind, key) against the committed reference, degrading
  // the way the tables do for a key it doesn't know.
  const optionFor = (w: { kind: SlotFactorKind; key: number }): Option => {
    const name = names.get(sparkId({ type: w.kind, key: w.key }));
    return name === undefined ? unknownOption(w) : { kind: w.kind, key: w.key, name };
  };
  // WHICH sparks sit in the Favorites section, snapshotted for the life of
  // this open. MEMBERSHIP is frozen; the ★ and the picker's pills stay live off
  // the lists. Without the freeze, favoriting a row lifts it out of its kind
  // section and the add buttons you were reaching for move away under the
  // pointer. It has to be MEMBERSHIP rather than `favorited ∩ snapshot`
  // (DECISIONS.md #36): under the intersection, un-starring dropped a row out
  // of Favorites while the frozen set still hid it from its kind section, so
  // the spark left the popout entirely and could not be added until you closed
  // and reopened. Frozen membership makes un-starring empty the star and move
  // nothing.
  //
  // Taken once per mount, and the caller REMOUNTS this popout when the lists
  // settle (see the `key` below) — which keeps the snapshot from freezing an
  // empty union mid-fetch without needing an effect or a ref read at render.
  const [pinnedRows] = useState(() => unionOf(sparkLists.lists));
  const pinned = new Set(pinnedRows.map((w) => sparkId({ type: w.kind, key: w.key })));
  // Held sparks the reference can't name, frozen per open like everything
  // else that decides which rows EXIST. Each gets a degraded row in its kind
  // section: this popout is the only remove surface, so a held spark with no
  // row is stuck on the member — counted by every estimate — until the whole
  // node is cleared. The pinned ones already surface through Favorites via
  // `optionFor`.
  const [orphanRows] = useState(() =>
    factors
      .filter((f) => {
        const id = sparkId({ type: f.kind, key: f.key });
        return !names.has(id) && !pinned.has(id);
      })
      .map((f) => ({ kind: f.kind, key: f.key }))
  );
  // The FILTER pills: which are pressed, each with the row-id snapshot it
  // contributed at press — or at open, for lists the persisted selection
  // pre-presses. How the snapshots compose is `inFilter`'s business below;
  // empty browses everything. A filter, not sections: frozen at open a
  // section is stale
  // (an add only surfaces on the next open), and live it tears the row out
  // of the section under the pointer. Membership snapshots when a pill is
  // PRESSED, so it is fresh at the moment you ask — the spark added seconds
  // ago is in it — while a ✕ under it leaves its row in place, add buttons
  // back, rather than vanishing the list out from under the pointer.
  // Pressing again takes a fresh cut.
  //
  // Keyed by source — "current" or a list id — because the two differ in
  // LIFETIME: list presses persist through `onToggleActive` (the active
  // selection, DECISIONS.md #43) and are re-pressed here at the next open,
  // while Current Sparks is per-member and dies with the popout. The lazy
  // initializer IS the snapshot-at-open — the popout mounts fresh per open
  // (and per `epoch`), and `onToggleActive` never bumps `epoch`, so the map,
  // not the live `active` prop, is this popout's single source of truth.
  // Stale active ids name no list and contribute no entry, so an all-stale
  // selection degrades to browsing everything.
  const [filters, setFilters] = useState<Map<"current" | number, Set<string>>>(() => {
    const init = new Map<"current" | number, Set<string>>();
    for (const id of sparkLists.active) {
      const list = listById(sparkLists.lists, id);
      if (list !== undefined) init.set(id, membershipIds(list));
    }
    return init;
  });
  const toggleListFilter = (id: number) => {
    setFilters((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const list = listById(sparkLists.lists, id);
        next.set(id, list === undefined ? new Set() : membershipIds(list));
      }
      return next;
    });
    sparkLists.onToggleActive(id);
  };

  // Escape closes UNCONDITIONALLY, including mid-write: blocking it while
  // `busy` silently swallows the keypress. What that used to leave open —
  // close mid-write, reopen, write again from state the first never
  // updated — stopped mattering with #48's per-spark verbs, which commute.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // What she holds RIGHT NOW, with levels — live, so a row's controls track
  // the document while the section it sits in stays frozen. The pink joins
  // the map for the Current Sparks pill — counted when the pill asks whether
  // she holds anything, snapshotted with the rest when it is pressed — while
  // her row reads the `spark` prop directly; no factor row ever carries a
  // pink id.
  const heldStars = new Map(
    factors.map((f) => [sparkId({ type: f.kind, key: f.key }), f.stars])
  );
  if (spark !== null) {
    heldStars.set(sparkId({ type: "pink", aptitude: spark.aptitude }), spark.stars);
  }
  // The blue an add in the Blue section would displace — live like the map
  // above, resolved here because the reference is in scope.
  const heldBlue = factors.find((f) => f.kind === "blue");
  const heldBlueName = heldBlue === undefined ? undefined : optionFor(heldBlue).name;
  // What she held when the popout OPENED. Row existence keys off this, never
  // the live map: exempted live, a foreign green's row unmounts with its own
  // ✕ click — gone from under the pointer, and gone from under the focus the
  // ✕ was about to hand back (#74).
  const [heldAtOpen] = useState(() => new Set(heldStars.keys()));
  const q = query.trim().toLowerCase();
  // Applied to the favorites too, though a list can no longer hold a green:
  // one section exempt from the rule would be the one place it leaks. Rows
  // held AT OPEN are exempt instead: this popout is the only place a spark
  // can be removed, and an old document can hold a green the current cast
  // couldn't take (reads stay permissive, DECISIONS.md #39) — filtered out,
  // she'd be invisible and unremovable while the server refuses every save
  // that carries her. Once removed she stays for the life of the open, adds
  // dead (`addable`): she can't legally come back, and her row can't vanish
  // mid-interaction either.
  const greenPossible = greenFilter(cardId, charaId);
  const possible = (o: Option): boolean =>
    heldAtOpen.has(sparkId({ type: o.kind, key: o.key })) || greenPossible(o);
  // Live, unlike `possible`: a foreign green's stars are dead whether she
  // is held or already removed — a re-level writes the document just like
  // an add, and the server refuses every save carrying either (DECISIONS.md
  // #39). Only her ✕ helps.
  const addable = greenPossible;
  // One rule for every section: the query and the filter pills narrow, and
  // hits rank by where the query lands in the name then alphabetically — a
  // no-op with no query, the reference arriving sorted by (kind, name)
  // already.
  //
  // Pressed sources UNION — whatever is selected, all of it shows. The
  // pills are sources, not dimensions: pressing Current Sparks beside a
  // list ADDS her held rows to the view and takes nothing another pressed
  // pill was showing. Alone, Current Sparks keeps its original meaning —
  // an exact snapshot of what she holds, the query narrowing WITHIN it.
  //
  // Blue, pink and green narrow only when Current Sparks is the SOLE
  // active source: a list cannot name those kinds, so a pressed list has
  // no verdict on them — filtered by one, a pink would be unaddable — and
  // under union a second press must never remove the rows that verdictless
  // pass was showing.
  //
  // A list whose flattened union is EMPTY imposes no filter — the
  // corrupt-key rule again: a selection that would show nothing (every
  // pressed list emptied on another device or surface) degrades to showing
  // more than asked, never to "No sparks match." over an untouched node.
  //
  // While lists are active, the QUERY bypasses their terms — this popout
  // is the only place a spark can be ADDED, so a persisted selection that
  // made an unlisted spark unfindable by its exact name would let a view
  // control on a read surface silently disable the one write path — and
  // rows held now OR at open are exempt: held-at-open so a remove doesn't
  // tear the row out from under the pointer, held-now so a spark added
  // through the query bypass stays reachable when the query clears (its ✕
  // lives here and nowhere else).
  const listIds = (() => {
    const flat = new Set(
      [...filters].flatMap(([key, set]) => (key === "current" ? [] : [...set]))
    );
    return flat.size === 0 ? null : flat;
  })();
  const currentIds = filters.get("current") ?? null;
  const inCurrent = (id: string) => currentIds !== null && currentIds.has(id);
  const heldEver = (id: string) => heldAtOpen.has(id) || heldStars.has(id);
  const inFilter = (id: string, kind: string) => {
    if (!LISTABLE.has(kind)) {
      return currentIds === null || listIds !== null || inCurrent(id);
    }
    if (listIds === null) return currentIds === null || inCurrent(id);
    return q !== "" || listIds.has(id) || heldEver(id) || inCurrent(id);
  };
  const byQuery = byQueryRank(q);
  const matching = (options: Option[]): Option[] => {
    const hits = options.filter(
      (o) =>
        possible(o) &&
        o.name.toLowerCase().includes(q) &&
        inFilter(sparkId({ type: o.kind, key: o.key }), o.kind)
    );
    if (q === "") return hits;
    return hits.sort(byQuery);
  };
  // The pink rows under the same narrowing, over the parallel shape. No
  // possibility rule rides along: any node this chooser renders on can hold
  // any pink.
  const pinkHits = PINK_OPTIONS.filter(
    (o) =>
      o.name.toLowerCase().includes(q) &&
      inFilter(sparkId({ type: "pink", aptitude: o.aptitude }), "pink")
  );
  if (q !== "") pinkHits.sort(byQuery);

  // Built from the frozen snapshot, so a row stays put when you un-star it.
  const favorites = matching(pinnedRows.map(optionFor));
  // A favorite is in the Favorites section and NOWHERE ELSE — the same spark
  // twice on one surface reads as "which of these two rows did I already
  // star". The snapshot decides, so nothing disappears from under the pointer.
  const sections = BROWSE_KINDS.map((kind) => ({
    kind,
    options: matching([
      // Orphans first: the unknown spark is what the open is FOR when one
      // exists, and "Unknown (key)" belongs nowhere in the alphabet —
      // appended, it sat ~300 rows below where anyone would look for it.
      ...orphanRows.filter((f) => f.kind === kind).map(unknownOption),
      ...refs
        .filter(
          (r) => r.kind === kind && !pinned.has(sparkId({ type: r.kind, key: r.key }))
        )
        .map(optionOf),
    ]),
  })).filter((s) => s.options.length > 0);

  // The AWAITED write — only `New List` takes this path now; membership
  // toggles are optimistic and live in `onToggleList` below (issue #69,
  // DECISIONS.md #49). A created chip needs the server's id, so the create
  // still holds `busy` for its round trip.
  //
  // Failures go to the PAGE toast, not a note inside this popout: dismissing
  // the popout mid-write is one keystroke, and a note that unmounts with its
  // surface reports nothing at all. The message takes the error because a
  // 409 from the create is either a name collision or the 50-list cap.
  //
  // Returns whether it wrote, so the new-list field knows to keep the name it
  // was given when the server refused it.
  const write = async (
    op: () => Promise<SparkList[]>,
    failure: (error: unknown) => string
  ): Promise<boolean> => {
    setBusy(true);
    try {
      sparkLists.onChange(await op());
      return true;
    } catch (error) {
      onError(failure(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rowProps = {
    heldStars,
    heldBlueName,
    addable,
    lists: sparkLists.lists,
    listsFailed: sparkLists.failed,
    busy,
    openPicker,
    // Only worth printing where the green list is still ambiguous — narrowed
    // to one card, the panel above already names her.
    cardOwner: cardId === null ? cardOwner : () => null,
    onAdd,
    onRemove,
    onOpenPicker: setOpenPicker,
    // The optimistic path (issue #69, DECISIONS.md #49): the pill flips
    // before the request leaves, the request chains per pill in the
    // background, and the server's answer only stamps `updated_at` — the
    // flip is the record. A failure re-states the opposite membership
    // against CURRENT state, so it cannot clobber another pill's in-flight
    // flip; a `ListGone` drops the dead list in place — no reload and no
    // `epoch` bump, which would remount the popout and discard the user's
    // search and open picker.
    onToggleList: (s: ListableSpark, listId: number) => {
      const list = listById(sparkLists.lists, listId);
      if (list === undefined) return;
      const desired = !list.sparks.some(
        (m) => m.kind === s.kind && m.key === s.key
      );
      sparkLists.onChange((prev) =>
        withMembership(prev, listId, s.kind, s.key, desired)
      );
      void syncMembership(listId, s.kind, s.key, desired).then(
        (saved) =>
          sparkLists.onChange((prev) =>
            withStamp(prev, listId, saved.updated_at)
          ),
        (error: unknown) => {
          if (error instanceof ListGone) {
            sparkLists.onChange((prev) => prev.filter((l) => l.id !== listId));
            onError("That list was deleted somewhere else.");
          } else {
            sparkLists.onChange((prev) =>
              withMembership(prev, listId, s.kind, s.key, !desired)
            );
            onError("Couldn't save that list change — try again.");
          }
        }
      );
    },
    // The field keeps the typed name until this resolves true, so a name the
    // server refused can be corrected rather than retyped. One request now:
    // "did it write" and "is the name spent" are the same question.
    onCreateList: (s: ListableSpark, listName: string) =>
      write(
        () => createListWith(sparkLists.lists, listName, s.kind, s.key),
        (error) => detailOr(error, "Couldn't make that list — try again.")
      ),
  };

  const factorSection = (s: { kind: SlotFactorKind; options: Option[] }) => (
    <div key={s.kind} className="spark-section">
      <div className="spark-section-head">{SPARK_TYPE_LABELS[s.kind]}</div>
      <SparkRows options={s.options} {...rowProps} />
    </div>
  );

  // Pink takes its slot in the game's grouping order — between Blue and
  // Green, where SPARK_TYPE_ORDER already places it — rendered from its own
  // rows rather than through the factor sections. One ordered walk emits
  // every block, so the order lives in SPARK_TYPE_ORDER alone.
  const pinkBlock = pinkHits.length > 0 && (
    <div key="pink" className="spark-section">
      <div className="spark-section-head">{SPARK_TYPE_LABELS.pink}</div>
      <PinkRows options={pinkHits} spark={spark} onSet={onSetSpark} />
    </div>
  );
  const blocks: ReactNode[] = [];
  let pinkPlaced = false;
  for (const s of sections) {
    if (!pinkPlaced && SPARK_TYPE_ORDER[s.kind] > SPARK_TYPE_ORDER.pink) {
      blocks.push(pinkBlock);
      pinkPlaced = true;
    }
    blocks.push(factorSection(s));
  }
  if (!pinkPlaced) blocks.push(pinkBlock);

  return (
    <>
      {/* Dismisses on mousedown, not click: Chrome freezes the OS cursor when
          a click unmounts the element under it, which reads as "hover is
          broken" until the next click. The filter panel's popouts do the
          same. */}
      <div className="uma-popout-backdrop" onMouseDown={onClose} />
      <div className="uma-popout spark-popout" role="dialog" aria-label="Edit Sparks">
        {/* Sticky, so the query stays reachable while you scroll 447 rows past
            it. */}
        <div className="spark-search-band">
          <input
            className="uma-search"
            type="search"
            aria-label={`${label} spark search`}
            placeholder="Search Sparks…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          {/* Sticky with the search they compose with, so every narrowing
              control stays reachable while you scroll. */}
          <div className="spark-filter-row">
            <button
              className={filters.has("current") ? "spark-current active" : "spark-current"}
              aria-pressed={filters.has("current")}
              // On a member holding nothing the press empties the popout to
              // the same "No sparks match." a typo produces, with nothing on
              // screen naming the cause. Only while INACTIVE: removing the
              // last spark under the filter must leave the pill able to
              // toggle off.
              disabled={!filters.has("current") && heldStars.size === 0}
              onClick={() =>
                setFilters((prev) => {
                  const next = new Map(prev);
                  if (next.has("current")) next.delete("current");
                  else next.set("current", new Set(heldStars.keys()));
                  return next;
                })
              }
            >
              Current Sparks
            </button>
            {/* Disabled with the ★, and for its reasons: a snapshot cut from
                lists the app has proven stale would filter against ghosts,
                and one cut mid-write would omit the spark just starred —
                a row vanishing under the pointer the moment the pill lands. */}
            <ListFilter
              lists={sparkLists.lists}
              isPressed={(id) => filters.has(id)}
              disabled={busy || sparkLists.failed}
              onToggle={toggleListFilter}
            />
          </div>
        </div>
        {/* The reference is committed and works offline; the favorites are
            server state behind Access. Said separately so a failed list fetch
            never costs you the browse. */}
        {sparkLists.failed && (
          <p className="spark-note">
            Couldn't load your lists — browsing still works.
          </p>
        )}
        {/* The sections share a WRAPPER so "the first heading hugs the band
            above it" can be written as `:first-child` against the wrapper
            alone. Positional selectors against the popout itself get defeated
            by the failure note above, which slides in between exactly when the
            fetch has failed. */}
        <div className="spark-sections">
          {favorites.length > 0 && (
            <div className="spark-section">
              <div className="spark-section-head">Favorites</div>
              <SparkRows options={favorites} {...rowProps} />
            </div>
          )}
          {blocks}
        </div>
        {sections.length === 0 && favorites.length === 0 && pinkHits.length === 0 && (
          <span className="empty">No sparks match.</span>
        )}
        {/* Pinned to the popout's bottom edge rather than in the Pink
            section: the verdict is about the document, not the rows, so a
            query that empties the section must not hide it — and mounting
            at the content's end moves no row under the pointer (#41's rule,
            vertical). No role="alert": the panel's copy is the live region,
            and a second one would announce every write twice. */}
        {undroppable && spark !== null && (
          <p className="spark-warn spark-warn-pinned" title={UNDROPPABLE_TITLE}>
            {undroppableMessage(spark.aptitude)}
          </p>
        )}
      </div>
    </>
  );
}

export function SparkChooser({
  label,
  factors,
  spark,
  undroppable,
  refs,
  sparkLists,
  cardId,
  charaId,
  cardOwner,
  onChange,
  onSetSpark,
  onError,
}: {
  // Distinguishes the choosers on one page for aria/testing.
  label: string;
  factors: readonly SlotFactor[];
  // The member's pink, which lives on the slot's own `spark` field rather
  // than in `factors`. The popout is a second writer of it (#87) — Details
  // stays the causal display, letters beside the pink that bumps them.
  spark: PinkSpark | null;
  // The focus panel's below-A verdict on that pink, echoed inside the popout
  // (see ChooserPopout).
  undroppable: boolean;
  refs: readonly FactorRef[];
  sparkLists: SparkListStore;
  // Who is cast in this node. A green's key IS a card_id, so these decide
  // which greens the node can hold at all — see greenFilter.
  cardId: number | null;
  charaId: number | null;
  cardOwner: (cardId: number) => string | null;
  onChange: (update: (current: readonly SlotFactor[]) => SlotFactor[]) => void;
  // A VALUE, unlike onChange's updater: the pink is one field, so every
  // write carries its whole state and two clicks can't drop each other.
  onSetSpark: (spark: PinkSpark | null) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // UPDATERS, not arrays: the popout stays open across edits, so two clicks
  // resolved against the same render would each compute their list from one
  // base and the second would drop the first.
  const add = (option: Option, stars: number) =>
    onChange((current) =>
      factorsWith(current, { kind: option.kind, key: option.key, stars })
    );
  const remove = (option: Option) =>
    onChange((current) =>
      current.filter((f) => !(f.kind === option.kind && f.key === option.key))
    );
  return (
    <div className="spark-add">
      {/* No ellipsis: a button that opens a dialog doesn't take one, so the
          mark keeps meaning "in flight" or "unresolved". */}
      <button
        className="spark-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          // Only when the last attempt failed: the lists are page-scoped
          // reference-ish state, and re-fetching them on every open would be a
          // request per click for something that rarely changes.
          if (sparkLists.failed) sparkLists.onReload();
          setOpen(true);
        }}
      >
        Edit Sparks
      </button>
      {open && (
        <ChooserPopout
          // Remounts per open (re-snapshotting the favorites and clearing an
          // abandoned query) and whenever a fetch of the lists LANDS, so a
          // popout opened mid-fetch re-snapshots instead of showing no
          // Favorites section at all.
          //
          // The generation, not a loaded/loading flag: the retry above fires
          // precisely when loading is already over, so a boolean key would
          // never change and the popout that triggered the retry would keep
          // the empty snapshot it opened with.
          key={sparkLists.epoch}
          label={label}
          factors={factors}
          spark={spark}
          refs={refs}
          sparkLists={sparkLists}
          cardId={cardId}
          charaId={charaId}
          cardOwner={cardOwner}
          undroppable={undroppable}
          onAdd={add}
          onRemove={remove}
          onSetSpark={onSetSpark}
          onError={onError}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
