import { escapeReference } from "./navigation-reference-ink.mjs";
import { device } from "./tranche4-source.mjs";

// Read printed subjects, not the container's claimed target/port metadata.
// A slash list shares a destination only if every named native port has it.
function subjectKeys(text, tag) {
  const subject = text.split(/→|->/u)[0];
  const expression = new RegExp(
    "(?<![\\p{L}\\p{N}_])" +
      escapeReference(tag) +
      "(?:\\.([^\\s,;]+)|\\s+ports?\\s+([^,;]+))",
    "gu",
  );
  return [...subject.matchAll(expression)].flatMap((m) =>
    m[1] ? [m[1]] : m[2].trim().split(/\s*\/\s*/u),
  );
}
export function namedPortSubjects(text, selected, ir, view) {
  const native = selected.filter((p) => p.view === view),
    names = [];
  for (const uid of new Set(native.map((p) => p.deviceUid))) {
    const tag = device(ir, uid)?.designation;
    if (!tag) continue;
    for (const key of subjectKeys(text, tag)) {
      const port = native.find((p) => p.deviceUid === uid && p.portKey === key);
      if (!port) return []; // An unknown printed port cannot be ignored.
      if (!names.includes(port)) names.push(port);
    }
  }
  return names;
}
