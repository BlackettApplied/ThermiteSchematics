import { fileURLToPath } from "node:url";

/** Resolve the existing render package export in checkouts and staged runtimes. */
const renderFonts = new URL(
  "../assets/fonts/",
  // Bun's explicit resolver parent is a native filename. A file URL forwarded
  // by a module runner misresolves percent escapes and Windows drive letters.
  import.meta.resolve("@thermite/render", fileURLToPath(import.meta.url)),
);
export function bundledFontUrl(name: string): URL {
  return name === "NotoSansMono-Regular"
    ? new URL(`../assets/fonts/${name}.ttf`, import.meta.url)
    : new URL(`${name}.ttf`, renderFonts);
}
