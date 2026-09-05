export function androidDialogBodyHeight(availableHeight: number, desiredHeight: number, fontScale: number): number {
  // Leave room for the title, buttons, padding, and system bars in landscape
  // and when the keyboard takes most of a compact display.
  const chromeHeight = 176 + Math.max(0, fontScale - 1) * 48;
  return Math.max(72, Math.min(desiredHeight, 440, availableHeight - chromeHeight));
}
