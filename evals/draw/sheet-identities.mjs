import { attachIdentities } from "./locators.mjs";

// DOM ordinals belong to the measured document. Standalone font delivery can
// insert a style node that is absent from the SVG inside packet HTML.
export function attachSheetIdentities(rows, indexes, view, ir, family) {
  for (const row of rows) {
    const medium = row.medium ?? (row.id.includes("/html-") ? "html" : "svg");
    attachIdentities(
      [row],
      indexes[medium === "html" ? "html" : "svg"],
      view,
      ir,
      family,
    );
  }
}
