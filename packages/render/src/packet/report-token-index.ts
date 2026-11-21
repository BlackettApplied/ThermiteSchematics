import type { ReportName } from "./report-column-widths.js";

interface NameNode {
  next: Map<string, NameNode>;
  names: { name: ReportName; order: number }[];
}

/** Match the same literal UTF-16 substrings without scanning every name per cell. */
export function reportNameIndex(names: readonly ReportName[]) {
  const root: NameNode = { next: new Map(), names: [] };
  for (const [order, name] of names.entries()) {
    let node = root;
    for (let i = 0; i < name.value.length; i++) {
      const char = name.value.charAt(i);
      let next = node.next.get(char);
      if (!next) {
        next = { next: new Map(), names: [] };
        node.next.set(char, next);
      }
      node = next;
    }
    node.names.push({ name, order });
  }
  return (value: string) => {
    const hits = [];
    for (let start = 0; start < value.length; start++) {
      if (/[\p{L}\p{N}]$/u.test(value.slice(Math.max(0, start - 2), start)))
        continue;
      let node = root;
      for (let i = start; i < value.length; i++) {
        const next = node.next.get(value.charAt(i));
        if (!next) break;
        node = next;
        const end = i + 1;
        if (/^[\p{L}\p{N}]/u.test(value.slice(end, end + 2))) continue;
        for (const { name, order } of node.names)
          hits.push({ ...name, start, end, authoredName: name.value, order });
      }
    }
    // Equal-span hits retain the authored names' order, including kind ties.
    return hits
      .sort((a, b) => a.start - b.start || b.end - a.end || a.order - b.order)
      .map(({ order, ...hit }) => hit);
  };
}
