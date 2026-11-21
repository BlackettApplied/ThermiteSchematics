import {
  hasStripApproach,
  inTerminalBody,
  stripBridge,
  stripStub,
  stripTerminalIdentity,
} from "./terminal-strip-landing.mjs";
import { segments, segmentOverlap } from "./tranche3-geometry.mjs";
import { extent } from "./review-geometry.mjs";

const delta = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });
const cross = (a, b) => a.x * b.y - a.y * b.x;
const inSegment = (v) => v >= -1e-7 && v <= 1 + 1e-7;

function intersection([a, b], [c, d]) {
  const ab = delta(a, b),
    cd = delta(c, d),
    ac = delta(a, c);
  const denominator = cross(ab, cd);
  if (Math.abs(denominator) < 1e-7) return null;
  const t = cross(ac, cd) / denominator,
    u = cross(ac, ab) / denominator;
  return inSegment(t) && inSegment(u)
    ? { x: a.x + ab.x * t, y: a.y + ab.y * t }
    : null;
}

function outsideMeeting(a, b, terminal, sharedBridge) {
  for (const x of segments(a.vertices)) {
    for (const y of segments(b.vertices)) {
      // Coincidence within 0.01 mm, independent of nominal stroke width.
      const overlap = segmentOverlap(x, y, 0.02);
      if (overlap?.some((point) => !inTerminalBody(point, terminal.rect)))
        return { overlap, bridgeSegment: x, otherSegment: y };
      if (sharedBridge) continue;
      const point = intersection(x, y);
      if (point && !inTerminalBody(point, terminal.rect))
        return { point, bridgeSegment: x, otherSegment: y };
    }
  }
  return null;
}

function candidates(native, ink, terminal) {
  const bridges = native.bridges.flatMap((b) => {
    const end = b.ends.indexOf(terminal.key);
    const path = end < 0 ? null : stripBridge(ink, terminal, b, end);
    return path ? [{ id: b.uid, endpoints: b.ends, path }] : [];
  });
  const stubs = native.incidences
    .filter((i) => i.at === terminal.key)
    .flatMap((i) => {
      const path = stripStub(ink, terminal, i.id, i.label, i.peer);
      return path ? [{ id: i.id, peer: i.peer, path }] : [];
    });
  return { bridges, stubs };
}

function inspectMeetings(terminal, { bridges, stubs }, counts, findings) {
  for (const [i, bridge] of bridges.entries()) {
    for (const other of [...stubs, ...bridges.slice(i + 1)]) {
      const sharedBridge = other.endpoints !== undefined;
      counts[sharedBridge ? "bridgePairs" : "conductorBridgePairs"]++;
      const hit = outsideMeeting(
        bridge.path,
        other.path,
        terminal,
        sharedBridge,
      );
      if (!hit) continue;
      const box = extent(hit.overlap ?? [hit.point]);
      findings.push({
        kind: sharedBridge
          ? "strip-approach-shared-bridge"
          : "strip-approach-conductor-bridge",
        terminal: terminal.key,
        sourceSheet: terminal.sheet,
        bridge: { id: bridge.id, terminals: bridge.endpoints },
        other: { id: other.id, terminals: other.endpoints, peer: other.peer },
        terminalBody: terminal.rect,
        zone: terminal.zone,
        ...hit,
        bbox: {
          x: box.x - 0.3,
          y: box.y - 0.3,
          w: box.w + 0.6,
          h: box.h + 0.6,
        },
      });
    }
  }
}

function countsForSheet(countsBySheet, sheet) {
  const counts = countsBySheet.get(sheet) ?? {
    terminals: 0,
    conductorBridgePairs: 0,
    bridgePairs: 0,
    unmeasurablePaths: 0,
  };
  countsBySheet.set(sheet, counts);
  return counts;
}

function recordIdentityGaps(uncorroborated, countsBySheet, findings) {
  for (const terminal of uncorroborated) {
    const counts = countsForSheet(countsBySheet, terminal.sheet);
    counts.unmeasurableTerminals = (counts.unmeasurableTerminals ?? 0) + 1;
    findings.push({
      kind: "strip-approach-unmeasurable",
      terminal: terminal.key,
      sourceSheet: terminal.sheet,
      bbox: terminal.rect,
      reason:
        "Drawn terminal lacks a unique body with a corroborated native heading and caption",
    });
  }
}

export const isStripApproachFinding = (f) =>
  f.kind.startsWith("strip-approach-");
export function stripApproachAudit(native, ink) {
  const findings = [];
  const countsBySheet = new Map();
  for (const group of native.groups) {
    for (const t of group.terminals) {
      const { body: terminal, uncorroborated } = stripTerminalIdentity(
        ink,
        t.key,
        t.label,
        group.name,
      );
      if (!terminal) {
        recordIdentityGaps(uncorroborated, countsBySheet, findings);
        continue;
      }
      const counts = countsForSheet(countsBySheet, terminal.sheet);
      counts.terminals++;
      const { bridges, stubs } = candidates(native, ink, terminal);
      for (const candidate of [...bridges, ...stubs]) {
        if (hasStripApproach(candidate.path, terminal)) continue;
        counts.unmeasurablePaths++;
        findings.push({
          kind: "strip-approach-unmeasurable",
          terminal: terminal.key,
          sourceSheet: terminal.sheet,
          id: candidate.id,
          bbox: terminal.rect,
        });
      }
      inspectMeetings(
        terminal,
        {
          bridges: bridges.filter((b) => hasStripApproach(b.path, terminal)),
          stubs: stubs.filter((s) => hasStripApproach(s.path, terminal)),
        },
        counts,
        findings,
      );
    }
  }
  return { findings, countsBySheet };
}
