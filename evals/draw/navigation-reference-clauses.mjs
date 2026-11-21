// Join visual wraps inside a measured annotation, but stop at a completed
// pointer or a fresh printed subject. A missing pointer must not borrow the
// next element's destination. Semicolons/newlines remain explicit boundaries.
export function referenceClauses(rows, tokens) {
  const clauses = [];
  let pending = [],
    header;
  const flush = () => {
    if (!pending.length) return;
    const sourceText = pending.map((r) => r.text).join(" ");
    const ownHeader = sourceText.match(/^([^:;\n]+):\s/u)?.[1];
    if (ownHeader) header = ownHeader;
    clauses.push({
      element: pending[0].element,
      text: header && !ownHeader ? `${header}: ${sourceText}` : sourceText,
      sourceText,
      groupHeader: header,
    });
    pending = [];
  };
  for (const row of rows) {
    const fragments = row.text.split(/;|\n/u);
    for (const [i, text] of fragments.entries()) {
      if (
        i ||
        (pending.length &&
          ((!rolePrefix(pending) && startsSubject(text)) ||
            (/→|->/u.test(text) && pending.some((r) => /→|->/u.test(r.text)))))
      )
        flush();
      if (!text.trim()) continue;
      pending.push({ ...row, text });
      if (tokens(text).length) flush();
    }
  }
  flush();
  return clauses;
}
function rolePrefix(rows) {
  const text = rows
    .map((r) => r.text)
    .join(" ")
    .replace(/^[^:]+:\s*/u, "")
    .trim();
  return /^(?:(?:NC|NO)(?:\s+contact)?|(?:overload|breaker|fuse)(?:\s+element)?|coil|contact)?$/iu.test(
    text,
  );
}
function startsSubject(text) {
  return (
    /^(?:[^:;]+:\s*)?(?:overload|breaker|fuse|NC|NO|contact|coil)\b/iu.test(
      text,
    ) || /^\S+\.\S+\s*(?:→|->)/u.test(text)
  );
}
