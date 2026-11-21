import { classifySheetInk } from "./sheet-ink-kind.mjs";
// The existing report header and symmetric shaping checks, plus independently
// classified strip ink. Real report sheets keep their no-report-text failure.
function reportScaleIssues(classify) {
  const roots = [...document.querySelectorAll("svg")],
    classified = roots.map(classify);
  const missing = roots.flatMap((root, i) =>
    classified[i].kind === "terminal-strip"
      ? []
      : [...root.querySelectorAll("[data-report-column] text")].some((t) =>
            t.textContent.trim(),
          )
        ? []
        : [{ text: "", kind: "no-report-text" }],
  );
  if (!roots.length) missing.push({ text: "", kind: "no-report-text" });
  const headerIssues = [...document.querySelectorAll("[data-report-column]")]
    .filter((cell) => !cell.closest("[data-report-row]"))
    .flatMap((cell) => {
      const expected = (cell.getAttribute("data-column-name") ?? "")
        .replace(/\s+/gu, " ")
        .trim();
      const pieces = [...cell.querySelectorAll("text")].map(
        (t) => t.textContent ?? "",
      );
      const hyphenated = pieces.some((t) => t.endsWith("-"));
      const actual = pieces
        .join(" ")
        .replace(/- (?=\S)/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
      return expected === actual &&
        (!hyphenated ||
          !!cell.closest("svg")?.querySelector("[data-report-header-note]"))
        ? []
        : [{ text: actual, kind: "header-word-split" }];
    });
  const glyphIssues = [...document.querySelectorAll("svg text")].flatMap(
    (text) => {
      const value = text.textContent ?? "";
      if (!value.trim()) return [];
      const issues = [];
      if (text.closest("[data-report-column]") && value !== value.trim())
        issues.push({ text: value, kind: "cell-wrap-space" });
      const reference = text.cloneNode(true);
      for (const element of [reference, ...reference.querySelectorAll("*")]) {
        element.removeAttribute("textLength");
        element.removeAttribute("lengthAdjust");
      }
      text.parentElement.appendChild(reference);
      const natural = reference.getComputedTextLength();
      reference.remove();
      const matrix = text.getScreenCTM(),
        scale = natural
          ? (((text.hasAttribute("textLength")
              ? Number(text.getAttribute("textLength"))
              : text.getComputedTextLength()) /
              natural) *
              Math.hypot(matrix.a, matrix.b)) /
            Math.hypot(matrix.c, matrix.d)
          : 1;
      if (Math.max(scale, 1 / scale) > 1.1 + 1e-9 || scale > 1 + 1e-9)
        issues.push({ text: value, kind: "glyph-scale", scale });
      return issues;
    },
  );
  return [
    ...missing,
    ...headerIssues,
    ...glyphIssues,
    ...classified.flatMap((c) => c.issues),
  ];
}
export const reportScaleScript = `(${reportScaleIssues.toString()})(${classifySheetInk.toString()})`;
