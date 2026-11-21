import { sha } from "./m3-native.mjs";
const physical = (id, need, owner) =>
  JSON.stringify([id, need, owner?.sheet, owner?.viewKey, owner?.noteId]);
export function autoOriginLineage(doc, dependencies, allNeeds) {
  const ids = doc.autoOrigin.dependencyIds ?? [],
    records = dependencies.filter((d) => ids.includes(d.id)),
    native = allNeeds.filter(
      (n) =>
        n.viewKey && ids.includes(`dependency/1/${sha([n.viewKey, n.noteId])}`),
    ),
    expected = native.map((n) =>
      physical(`dependency/1/${sha([n.viewKey, n.noteId])}`, n.need, {
        sheet: n.sheet,
        viewKey: n.viewKey,
        noteId: n.noteId,
      }),
    ),
    actual = records.map((d) => physical(d.id, d.need, d.owner)),
    nativeIds = new Set(
      native.map((n) => `dependency/1/${sha([n.viewKey, n.noteId])}`),
    );
  return {
    native,
    valid:
      ids.length > 0 &&
      new Set(ids).size === ids.length &&
      nativeIds.size === ids.length &&
      ids.every((id) => nativeIds.has(id)) &&
      JSON.stringify(expected.sort()) === JSON.stringify(actual.sort()),
  };
}
