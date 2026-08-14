// Backdrop shared by every `.uma-popout` surface (issue #97; `useEscapeClose`
// is its sibling, in its own file for react-refresh). DECISIONS.md #44
// rejects extracting the slot-bound browse layer — these stay dismissal only.

/**
 * Dismisses on mousedown, not click: Chrome freezes the OS cursor when a
 * click unmounts the element under it, which reads as "hover is broken"
 * until the next click.
 */
export function PopoutBackdrop({ onClose }: { onClose: () => void }) {
  return <div className="uma-popout-backdrop" onMouseDown={onClose} />;
}
