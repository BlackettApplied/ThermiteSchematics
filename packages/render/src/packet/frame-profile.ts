import type { PaperPage } from "./types.js";

// Presentation 0.3 selects compact geometry through the packet entry.
// Page identity survives draft cloning; legacy pages never register.
const compactPages = new WeakSet<PaperPage>();
export function useCompactFrame(page: PaperPage): void {
  compactPages.add(page);
}
export const hasCompactFrame = (page: PaperPage): boolean =>
  compactPages.has(page);
