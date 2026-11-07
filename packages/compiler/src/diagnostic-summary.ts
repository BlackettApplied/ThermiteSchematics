/** Numeric-aware ordering using only code points, independent of locale/TZ. */
export function compareNatural(left: string, right: string): number {
  const a = left.match(/\d+|\D+/gu) ?? [];
  const b = right.match(/\d+|\D+/gu) ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    if (/^\d+$/u.test(x) && /^\d+$/u.test(y)) {
      const nx = x.replace(/^0+(?=\d)/u, "");
      const ny = y.replace(/^0+(?=\d)/u, "");
      if (nx.length !== ny.length) return nx.length - ny.length;
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else return x < y ? -1 : 1;
  }
  return a.length - b.length || (left < right ? -1 : left > right ? 1 : 0);
}

/** Like T2's message lists: ten entries, followed by the full omitted count. */
export function summarizeAffected(
  values: readonly string[],
  noun = "item",
): string {
  const ordered = [...new Set(values)].sort(compareNatural);
  const shown = ordered
    .slice(0, 10)
    .map((value) => JSON.stringify(value))
    .join(", ");
  return `${ordered.length} ${noun}${ordered.length === 1 ? "" : "s"}: [${shown}]${ordered.length > 10 ? ` and ${ordered.length - 10} more` : ""}`;
}
