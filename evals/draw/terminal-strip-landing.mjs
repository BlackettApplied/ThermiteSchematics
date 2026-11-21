// Attributes select a candidate. The visible native caption, terminal body
// and conductor path must each corroborate the selected identity.
const compact = (text) =>
  String(text ?? "")
    .normalize("NFC")
    .replace(/\s+/gu, "");
const tolerance = 0.01; // Measurement precision in sheet mm.
export const inTerminalBody = (point, rect) =>
  point &&
  point.x >= rect.x - tolerance &&
  point.x <= rect.x + rect.w + tolerance &&
  point.y >= rect.y - tolerance &&
  point.y <= rect.y + rect.h + tolerance;

export function stripTerminalIdentity(ink, key, label, device) {
  const candidates = ink.terminals.filter((t) => t.key === key);
  const [t] = candidates;
  const body =
    candidates.length === 1 &&
    t.rect &&
    t.deviceHeading === device &&
    t.texts.some(
      (text) =>
        text.inkVisible &&
        compact(text.text) === compact(label) &&
        inTerminalBody(text.center, t.rect),
    )
      ? t
      : null;
  return {
    body,
    uncorroborated: body
      ? []
      : candidates.filter((candidate) => candidate.rect),
  };
}

export function stripTerminalBody(ink, key, label, device) {
  return stripTerminalIdentity(ink, key, label, device).body;
}

export function stripStub(ink, terminal, id, label, peer) {
  const candidates = ink.incidences.filter(
    (p) => p.id === id && p.at === terminal.key && p.sheet === terminal.sheet,
  );
  if (candidates.length !== 1) return null;
  const p = candidates[0];
  return p.painted &&
    inTerminalBody(p.points[0], terminal.rect) &&
    compact(p.visibleText) === compact(`${label} → ${peer}`)
    ? p
    : null;
}

export function stripBridge(ink, terminal, native, end) {
  const other = 1 - end;
  const paths = ink.bridges.filter(
    (p) =>
      p.uid === native.uid &&
      p.sheet === terminal.sheet &&
      (p.end === null ||
        (p.end === String(end) &&
          p.at === native.ends[end] &&
          p.peer === native.ends[other])),
  );
  if (paths.length !== 1) return null;
  const p = paths[0];
  const anchor = end === 0 || p.end !== null ? p.points[0] : p.points.at(-1);
  const labels = ink.bridgeLabels.filter(
    (b) =>
      b.uid === native.uid &&
      b.at === terminal.key &&
      b.sheet === terminal.sheet,
  );
  return p.painted &&
    inTerminalBody(anchor, terminal.rect) &&
    labels.length === 1 &&
    compact(
      labels[0].visibleText
        .replace(/^B\d+\s+/u, "")
        .split("; continued on sheet ")[0],
    ) === compact(`${native.name} → ${native.peers[other]}`)
    ? p
    : null;
}

export function hasStripApproach(path, terminal) {
  // An endpoint-only dot or a path painted entirely within the body's outline
  // cannot prove a conductor arrives from the outside.
  return (
    path?.length >= 3 &&
    path.vertices?.some((point) => !inTerminalBody(point, terminal.rect))
  );
}
