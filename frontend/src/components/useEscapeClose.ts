import { useEffect } from "react";

/**
 * Escape closes UNCONDITIONALLY, including mid-write: blocking it while a
 * write is in flight silently swallows the keypress. What that used to leave
 * open — close mid-write, reopen, write again from state the first never
 * updated — stopped mattering with #48's per-spark verbs, which commute.
 *
 * Only for popouts where Escape means "close me, always": a surface whose
 * Escape is layered under another popout's (SlotPicker, FilterPanel) keeps
 * its own guarded handler.
 */
export function useEscapeClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}
