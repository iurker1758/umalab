// One writer for the app's persisted preferences — the roster's filters and
// sort, the picker's own pair, and which blueprint was open.
//
// Shared because the body is the interesting part: storage can be full,
// blocked by the browser, or absent in a private window, and every one of
// these is a preference rather than data — losing the write costs the choice
// for the next session and nothing else. Four copies of that judgement is
// four places to get it wrong once one of them needs a migration or a quota
// message.
//
// `null` removes the key rather than storing "null", so a caller can express
// "forget this" without a second helper.
export function writeStore(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full/blocked — the choice still applies for this session
  }
}
