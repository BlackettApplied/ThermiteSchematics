import { namedPortNeeds, portPointerText } from "./assembly-port-pointers.mjs";
import { sufficient, logicalPointerNotes } from "./document-dependencies.mjs";
import { finding, painted } from "./review-geometry.mjs";
export const assemblyTargets = (text) =>
  [...text.matchAll(/\b(?:S)?(\d{1,3})[.]([A-Z]+\d+)\b/gu)].map((m) => ({
    sheet: Number(m[1]),
    zone: m[2],
  }));
export const needKey = (n) =>
  n?.kind === "drawn-port"
    ? "port:" + n.identity
    : "row:" + (n?.row?.key ?? "unavailable");
export const reasonNeed = (row) => ({
  kind: "reason-row",
  identity: row?.key,
  row,
});
export function portSubjects(note, needs) {
  return namedPortNeeds(note, needs);
}
export function assemblyNotes(g, needs) {
  return logicalPointerNotes(g.texts ?? []).filter(
    (t) =>
      !t.row &&
      painted(t) &&
      !t.furniture &&
      (/(?:\bother ports\b|\bauthored (?:cap )?assembl(?:y|ies)\b|\bsee\b.*\b(?:assembly|schedule)\b|\bassembl(?:y|ies)\b.*\bS?\d+[.][A-Z]+\d+\b)/iu.test(
        t.text,
      ) ||
        (/->|→/u.test(t.text) && portSubjects(t, needs).length)),
  );
}
export function portNoteNeeds(note, needs) {
  return /\bother parts\b/iu.test(note.text)
    ? needs
    : /\bother ports\b/iu.test(note.text)
      ? needs.filter((n) => n.uid === note.deviceUid)
      : portSubjects(note, needs);
}
export function assemblyDeliveryFindings(note, needs, rows, sheet) {
  const findings = [];
  for (const need of needs) {
    const drawn = need?.kind === "drawn-port";
    const refs = assemblyTargets(
      drawn ? portPointerText(note, need) : note.text,
    );
    const candidates = drawn
      ? need.targets
      : need?.row && rows.filter((r) => r.visible && sufficient(r, need.row));
    if (
      !candidates?.some((r) =>
        refs.some((p) => p.sheet === r.sheet && r.zones.includes(p.zone)),
      )
    )
      findings.push({
        ...finding(
          drawn
            ? "assembly-note-native-drawn-target-unavailable"
            : "assembly-note-native-row-target-unavailable",
          note,
          drawn
            ? {
                nativePort: need.identity,
                drawnTargets: need.targets,
                printedTargets: refs,
              }
            : { nativeRow: need?.row?.key ?? null, printedTargets: refs },
        ),
        sheet,
      });
  }
  return findings;
}
