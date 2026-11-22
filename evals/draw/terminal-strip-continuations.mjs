const compact = (s) => String(s ?? "").replace(/\s+/gu, "");
export const chunkKey = (t) =>
  JSON.stringify([t?.sheet, t?.chunk?.x, t?.chunk?.y]);
export const physicalOrder = (a, b) =>
  a.sheet - b.sheet ||
  (a.chunk?.x ?? a.rect.x) - (b.chunk?.x ?? b.rect.x) ||
  (a.chunk?.y ?? a.rect.y) - (b.chunk?.y ?? b.rect.y) ||
  a.rect.y - b.rect.y;
export const destination = (t) =>
  t?.zone ? `${String(t.sheet).padStart(2, "0")}.${t.zone}` : null;
export function continuationCoverage(native, ink, findings) {
  const expected = [];
  for (const group of native.groups) {
    for (let i = 1; i < group.terminals.length; i++) {
      const a = ink.terminals.find((t) => t.key === group.terminals[i - 1].key),
        b = ink.terminals.find((t) => t.key === group.terminals[i].key);
      if (!a || !b || chunkKey(a) === chunkKey(b)) continue;
      for (const [at, target, direction] of [
        [a, b, "on"],
        [b, a, "from"],
      ]) {
        expected.push(JSON.stringify([at.key, target.key, direction]));
        const markers = (ink.continuations ?? []).filter(
          (m) =>
            m.at === at.key &&
            m.target === target.key &&
            m.direction === direction,
        );
        const label = `${group.name} continued ${direction} sheet ${destination(target)} at terminal ${JSON.parse(target.key)[1]}`;
        if (
          markers.length !== 1 ||
          !markers[0].painted ||
          compact(markers[0].text) !== compact(label) ||
          !destination(target) ||
          chunkKey(markers[0]) !== chunkKey(at)
        )
          findings.push({
            kind: "strip-order-continuation",
            at: at.key,
            target: target.key,
            direction,
          });
      }
    }
  }
  for (const m of ink.continuations ?? [])
    if (!expected.includes(JSON.stringify([m.at, m.target, m.direction])))
      findings.push({
        kind: "strip-extra-continuation",
        at: m.at,
        target: m.target,
        direction: m.direction,
      });
}
