import {
  chunkKey,
  physicalOrder,
  destination,
  continuationCoverage,
} from "./terminal-strip-continuations.mjs";
import { stripApproachAudit } from "./terminal-strip-approaches.mjs";
// Attributes locate ink. Native IR defines obligations; measured shapes discharge them.
const pointAt = (p, b) =>
  p &&
  p.x >= b.x - 0.3 &&
  p.x <= b.x + b.w + 0.3 &&
  p.y >= b.y - 0.3 &&
  p.y <= b.y + b.h + 0.3;
const compact = (s) => String(s ?? "").replace(/\s+/gu, "");
function terminalCoverage(native, ink, findings) {
  for (const t of native.terminals) {
    const shapes = ink.terminals.filter((x) => x.key === t.key);
    if (
      shapes.length !== 1 ||
      !shapes[0].rect ||
      shapes[0].rect.w < 4 ||
      shapes[0].rect.h < 4 ||
      !shapes[0].texts.some(
        (x) => x.text === t.label && pointAt(x.center, shapes[0].rect),
      )
    )
      findings.push({
        kind: "strip-terminal-coverage",
        terminal: t.key,
        count: shapes.length,
      });
    const row = ink.rows.filter((r) => r.key === t.key);
    if (
      row.length !== 1 ||
      row[0].ref !== t.ref ||
      shapes[0]?.inventory !== t.key ||
      shapes[0]?.ref !== t.ref ||
      !shapes[0]?.texts.some((x) => x.text === t.ref) ||
      !ink.references.some((r) => r.key === t.key && r.text === t.ref)
    )
      findings.push({ kind: "strip-row-reference", terminal: t.key });
  }
  for (const t of ink.terminals)
    if (!native.terminals.some((n) => n.key === t.key))
      findings.push({ kind: "strip-extra-terminal", terminal: t.key });
  for (const group of native.groups) {
    const drawn = group.terminals.map((t) =>
      ink.terminals.find((x) => x.key === t.key),
    );
    if (drawn.some((t) => !t?.rect)) continue;
    if (
      drawn
        .slice()
        .sort(physicalOrder)
        .some((t, i) => t.key !== group.terminals[i].key)
    )
      findings.push({ kind: "strip-wrong-order", device: group.uid });
    const heading = ink.headings
      .filter((h) => h.uid === group.uid)
      .map((h) => h.text)
      .join(" ");
    if (!group.ordered && !heading.includes("order unspecified"))
      findings.push({
        kind: "strip-unspecified-order-hidden",
        device: group.uid,
      });
  }
}
function bridgeCoverage(native, ink, findings) {
  const compact = (s) => String(s ?? "").replace(/\s+/gu, "");
  for (const j of native.bridges) {
    const paths = ink.bridges.filter((b) => b.uid === j.uid),
      ends = j.ends.map((k) => ink.terminals.find((t) => t.key === k));
    const split = chunkKey(ends[0]) !== chunkKey(ends[1]);
    let valid =
      ends.every((e) => e?.rect) &&
      paths.every((p) => p.painted && p.length >= 3 && p.points.length >= 3);
    if (split)
      valid =
        valid &&
        paths.length === 2 &&
        [0, 1].every((end) => {
          const p = paths.find((p) => p.end === String(end)),
            target = ends[1 - end];
          return (
            p &&
            p.at === j.ends[end] &&
            p.peer === j.ends[1 - end] &&
            pointAt(p.points[0], ends[end].rect) &&
            destination(target) &&
            compact(p.text).includes(
              compact(`continued on sheet ${destination(target)}`),
            )
          );
        });
    else
      valid =
        valid &&
        paths.length === 1 &&
        pointAt(paths[0].points[0], ends[0].rect) &&
        pointAt(paths[0].points.at(-1), ends[1].rect);
    if (!valid) findings.push({ kind: "strip-bridge-geometry", uid: j.uid });
    for (const [end, key] of j.ends.entries()) {
      const labels = (ink.bridgeLabels ?? []).filter(
        (l) => l.uid === j.uid && l.at === key,
      );
      if (
        labels.length !== 1 ||
        !compact(labels[0].text).includes(compact(j.name)) ||
        !compact(labels[0].text).includes(compact(j.peers[1 - end]))
      )
        findings.push({
          kind: "strip-bridge-label",
          uid: j.uid,
          terminal: key,
        });
    }
  }
  for (const p of ink.bridges)
    if (!native.bridges.some((j) => j.uid === p.uid))
      findings.push({ kind: "strip-extra-bridge", uid: p.uid });
}
function incidenceCoverage(native, ink, findings) {
  const expected = new Map();
  for (const i of native.incidences) {
    const key = JSON.stringify([i.id, i.at]);
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  for (const i of native.incidences) {
    const key = JSON.stringify([i.id, i.at]);
    const rows = ink.incidences.filter((x) => x.id === i.id && x.at === i.at);
    const terminal = ink.terminals.find((t) => t.key === i.at)?.rect;
    if (
      rows.length !== expected.get(key) ||
      !terminal ||
      rows.some(
        (r) =>
          !r.painted ||
          r.length < 3 ||
          !pointAt(r.points[0], terminal) ||
          !compact(r.text).includes(compact(i.label)) ||
          !compact(r.text).includes(compact(i.peer)),
      )
    )
      findings.push({
        kind: "strip-conductor-incidence",
        id: i.id,
        terminal: i.at,
      });
  }
  for (const i of ink.incidences)
    if (!expected.has(JSON.stringify([i.id, i.at])))
      findings.push({
        kind: "strip-extra-conductor",
        id: i.id,
        terminal: i.at,
      });
}
export function checkTerminalStrip(native, ink) {
  const findings = [];
  terminalCoverage(native, ink, findings);
  bridgeCoverage(native, ink, findings);
  incidenceCoverage(native, ink, findings);
  continuationCoverage(native, ink, findings);
  for (const s of ink.unclaimed)
    findings.push({ kind: "strip-invented-hardware-or-bridge", shape: s });
  if (!ink.notes.some((t) => t.includes("hardware unspecified")))
    findings.push({ kind: "strip-hardware-facts-unqualified" });
  for (const t of ink.texts)
    if (t.size < 2.499 || !t.painted)
      findings.push({ kind: "strip-unprintable-text", text: t.text });
  const approach = stripApproachAudit(native, ink);
  findings.push(...approach.findings);
  return {
    dq: "DQ-23",
    approachCounts: Object.fromEntries(approach.countsBySheet),
    owner: "#336",
    strict: false,
    repinNow: false,
    assessment: findings.length ? "fail" : "pass",
    findings,
    obligations: {
      terminals: native.terminals.length,
      bridges: native.bridges.length,
      incidences: native.incidences.length,
    },
  };
}
