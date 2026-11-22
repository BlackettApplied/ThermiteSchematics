// Browser-only classification from visible ink. Report columns always retain
// the report obligations, even if somebody forges a strip-kind declaration.
export function classifySheetInk(root) {
  const visible = (e) => {
    for (let p = e; p && p !== root.parentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (
        s.display === "none" ||
        s.visibility === "hidden" ||
        Number(s.opacity) < 0.2
      )
        return false;
    }
    return true;
  };
  const columns = [...root.querySelectorAll("[data-report-column]")];
  if (columns.length) return { kind: "report", issues: [], terminalCount: 0 };
  if (!root.querySelector('[data-sheet-kind="terminal-strip"]'))
    return { kind: "other", issues: [], terminalCount: 0 };
  const terminals = [...root.querySelectorAll("[data-strip-terminal]")];
  const bodies = terminals.filter((t) => {
    const r = t.querySelector("rect");
    return (
      r &&
      visible(r) &&
      r.getBBox().width >= 4 &&
      r.getBBox().height >= 4 &&
      getComputedStyle(r).stroke !== "none"
    );
  });
  const issues = [];
  if (!bodies.length || bodies.length !== terminals.length)
    issues.push({ kind: "strip-sheet-missing-ink", text: "" });
  const matrix = root.getScreenCTM();
  for (const t of root.querySelectorAll("text")) {
    if (!t.textContent.trim()) continue;
    const m = t.getScreenCTM(),
      size =
        (parseFloat(getComputedStyle(t).fontSize) * Math.hypot(m.c, m.d)) /
        Math.hypot(matrix.c, matrix.d);
    if (!visible(t) || size < 2.499)
      issues.push({
        kind: "strip-unprintable-text",
        text: t.textContent,
        size,
      });
  }
  return { kind: "terminal-strip", issues, terminalCount: bodies.length };
}
export const sheetInkKindScript = `Array.from(document.querySelectorAll('svg')).map(${classifySheetInk.toString()})`;
