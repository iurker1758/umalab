// The #74 fix, both variants. A list write disables the pill that was clicked,
// and a held row's ✕ unmounts itself — a disabled or removed element cannot
// hold focus, so either way the browser drops it to <body> and the next Tab
// restarts from the top of a 447-row popout. The element is captured HERE, in
// the click handler, before any state changes: an effect observing `busy` runs
// after React commits the disabled state, by which point focus is already on
// <body> — that shape shipped as a no-op and was reverted (#74, do not
// re-attempt). Captured at the ROW as well as the control, so one fix covers
// both variants: focus returns to the control where it survived (the pill,
// re-enabled), else to the row ITSELF — never the row's first live button,
// which in a ✕'s row is the 1★ add: Enter auto-repeats, so a held or doubled
// press on the ✕ would remove a 3★ and silently re-add it at 1★. The li is
// inert under Enter, and the next Tab walks into the row's own controls.
export const refocus = (control: HTMLElement | null): (() => void) => {
  const row = control?.closest("li") ?? null;
  // Captured with the element: in browsers that don't focus a button on
  // click (Safari; Firefox on macOS), a mouse user's activeElement is still
  // <body> HERE — there is nothing to restore, and doing so anyway would
  // paint a focus ring on a row that never had focus.
  const hadFocus =
    document.activeElement !== null && document.activeElement !== document.body;
  return () => {
    if (!hadFocus) return;
    // After React commits the state the click caused — restoring synchronously
    // would focus an element the commit is about to disable or remove.
    setTimeout(() => {
      const active = document.activeElement;
      // Only where focus was actually dropped: the user may have moved on.
      if (active !== null && active !== document.body) return;
      if (
        control !== null &&
        control.isConnected &&
        !(control as HTMLButtonElement).disabled
      ) {
        control.focus();
      } else if (row !== null && row.isConnected) {
        // Focusable programmatically only — rows never join the Tab order.
        row.tabIndex = -1;
        row.focus();
      }
    });
  };
};
