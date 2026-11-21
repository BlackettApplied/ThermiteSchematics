import { compact } from "./tranche4-source.mjs";
// Separate multiple subjects by semicolons; a single subject retains its full target list.
function segments(note) {
  const parts =
    note.text.split(/->|→/u).length === 2
      ? [note.text] // One subject retains all of its destinations, including semicolons.
      : note.text.split(/[;\n]/u);
  return parts.map((text) => ({
    ...note,
    text: text.replace(/^.*?\bother (?:ports|parts)\s*:\s*/iu, "").trim(),
  }));
}
function subjects(note, needs) {
  if (note.text.split(/->|→/u).length !== 2) return [];
  const prefix = compact(note.text.split(/->|→/u)[0].replace(/^Port\s+/iu, ""));
  return needs.filter((n) => {
    const qualified = [
      compact(n.owner + "." + n.key),
      compact(n.owner + ":" + n.key),
    ];
    return note.deviceUid === undefined
      ? qualified.includes(prefix)
      : n.uid === note.deviceUid &&
          [compact(n.key), ...qualified].includes(prefix);
  });
}
export const namedPortNeeds = (note, needs) => [
  ...new Set(segments(note).flatMap((s) => subjects(s, needs))),
];
export const portPointerText = (note, need) =>
  segments(note)
    .filter((s) => subjects(s, [need]).length)
    .map((s) => s.text)
    .join(";");
