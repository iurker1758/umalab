// Inline SVG icons for the app's icon buttons. A 16px box rendered at 14px,
// filled with `currentColor` so the button's own colour (and its hover and
// disabled states) carries them.

export const CopyIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M5.5 1.5h7A1.5 1.5 0 0 1 14 3v7h-1.5V3h-7V1.5ZM3 4h6.5A1.5 1.5 0 0 1 11 5.5V13a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13V5.5A1.5 1.5 0 0 1 3 4Zm0 1.5V13h6.5V5.5H3Z"
    />
  </svg>
);

// Deliberately NOT an ✕: the app uses that mark for close/dismiss, and reusing
// it for "erase this data" puts a destructive control in the shape and the
// corner where people expect one that only shuts a panel.
export const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M6 2h4l.5 1H14v1.5H2V3h3.5L6 2Zm-2.5 4h9l-.7 8.1a1 1 0 0 1-1 .9H5.2a1 1 0 0 1-1-.9L3.5 6Zm2.8 1.6.3 6h1.2l-.3-6H6.3Zm3.4 0-.3 6h1.2l.3-6H9.7Z"
    />
  </svg>
);

// Two arrows swapping places — put someone else in this node.
export const ReplaceIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M2 5.25h9.5V3l3.2 3-3.2 3V6.75H2V5.25ZM14 9.25H4.5V7L1.3 10l3.2 3v-2.25H14V9.25Z"
    />
  </svg>
);
