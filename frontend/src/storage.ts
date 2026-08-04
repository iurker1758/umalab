// One writer for the app's persisted preferences. Storage can be full,
// blocked, or absent in a private window, and all of these are preferences
// rather than data — losing the write costs the choice for the next session
// and nothing else.
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
