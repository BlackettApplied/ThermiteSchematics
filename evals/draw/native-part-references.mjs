import { nativePartPopulation } from "./native-part-population.mjs";
import {
  compact,
  terminalId,
  terminalName,
  device,
} from "./tranche4-source.mjs";
import { finding, painted } from "./review-geometry.mjs";
import { rowZones } from "./m3-zones.mjs";
const subject = (p, t) =>
  p.kind === "circuit"
    ? terminalId({ deviceUid: t.deviceUid, terminalKey: t.terminal })
    : t.deviceUid;
function appearances(part) {
  const source = part.kind === "circuit" ? part.terminals : part.ports;
  return [...new Map(source.map((t) => [subject(part, t), t])).entries()];
}
function targetZones(part, t) {
  const p = t.point ?? {
    x: t.bbox.x + t.bbox.w / 2,
    y: t.bbox.y + t.bbox.h / 2,
  };
  const bodies = (part.geometry.devices ?? [])
    .filter(
      (d) =>
        d.deviceUid === t.deviceUid &&
        d.bbox.x <= p.x + 0.01 &&
        d.bbox.y <= p.y + 0.01 &&
        d.bbox.x + d.bbox.w >= p.x - 0.01 &&
        d.bbox.y + d.bbox.h >= p.y - 0.01,
    )
    .sort((a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h);
  return rowZones(part.geometry, bodies[0]?.bbox ?? t.bbox);
}
function validatePeers(peers, id, tokens, fail) {
  for (const peer of peers) {
    const matches = tokens.filter(
        (m) => Number(m[1]) === peer.part && Number(m[2]) === peer.sheet,
      ),
      target = appearances(peer).find(([key]) => key === id)?.[1];
    const zones = target && targetZones(peer, target);
    if (matches.length !== 1 || !target)
      fail("native-part-reference-peer-disagrees", {
        targetPart: peer.part,
        targetSheet: peer.sheet,
      });
    else if (!zones?.length)
      fail("native-part-destination-geometry-unavailable", {
        targetPart: peer.part,
        targetSheet: peer.sheet,
      });
    else if (!matches[0][3])
      fail("native-part-reference-zone-missing", {
        targetPart: peer.part,
        targetSheet: peer.sheet,
        allowedZones: zones,
      });
    else if (!zones.includes(matches[0][3]))
      fail("native-part-reference-zone-disagrees", {
        targetPart: peer.part,
        targetSheet: peer.sheet,
        actual: matches[0][3],
        allowedZones: zones,
      });
  }
}
function referenceFindings(part, id, t, peers, ir) {
  const refs = (part.geometry.tranche4?.partRefs ?? []).filter(
    (r) =>
      r.kind === part.kind &&
      r.part === part.part &&
      (part.kind === "circuit"
        ? r.group === part.group && JSON.stringify(r.terminalId) === id
        : r.uid === id && r.view === part.view + 1),
  );
  const note = refs[0],
    out = [],
    fail = (kind, extra = {}) =>
      out.push({
        ...finding(kind, note ?? t, { subject: id, ...extra }),
        sheet: part.sheet,
      });
  if (refs.length !== 1) {
    fail("native-part-reference-missing-or-ambiguous", {
      matches: refs.length,
    });
    return out;
  }
  const text = note.texts
      .filter(painted)
      .map((t) => t.text)
      .join(" "),
    before = text.split(/->|→/u)[0];
  const expected =
    part.kind === "circuit"
      ? terminalName(ir, { deviceUid: t.deviceUid, terminalKey: t.terminal })
      : device(ir, t.deviceUid)?.designation;
  if (compact(before) !== compact(expected))
    fail("native-part-reference-subject-disagrees", {
      actual: before,
      expected,
    });
  const tokens = [
    ...text.matchAll(/P(\d+)\s*\/\s*S(\d+)(?:[. :]([A-Z]+\d+))?/gu),
  ];
  if (tokens.length !== peers.length)
    fail("native-part-reference-peer-count-disagrees", {
      expected: peers.length,
      actual: tokens.length,
    });
  validatePeers(peers, id, tokens, fail);
  const actualPairs = tokens
      .map((m) => JSON.stringify([Number(m[1]), Number(m[2])]))
      .sort(),
    expectedPairs = peers.map((p) => JSON.stringify([p.part, p.sheet])).sort();
  if (
    JSON.stringify(actualPairs) !== JSON.stringify(expectedPairs) ||
    JSON.stringify(note.targetSheets?.slice().sort()) !==
      JSON.stringify(peers.map((p) => p.sheet).sort()) ||
    JSON.stringify(note.targetParts?.slice().sort()) !==
      JSON.stringify(peers.map((p) => p.part).sort())
  )
    fail("native-part-reference-declared-destinations-disagree");
  return out;
}
export function nativePartAudit(packet, geometries, ir, request) {
  const population = nativePartPopulation(packet, geometries, ir, request),
    findings = population.findings.slice();
  const used = new Set(),
    parts = population.parts;
  for (const p of parts)
    for (const [id, t] of appearances(p)) {
      const peers = parts.filter(
        (q) =>
          q !== p &&
          q.kind === p.kind &&
          q.view === p.view &&
          q.group === p.group &&
          appearances(q).some(([key]) => key === id),
      );
      if (!peers.length) continue;
      findings.push(...referenceFindings(p, id, t, peers, ir));
      for (const r of p.geometry.tranche4?.partRefs ?? [])
        if (
          r.kind === p.kind &&
          (p.kind === "circuit"
            ? JSON.stringify(r.terminalId) === id && r.group === p.group
            : r.uid === id)
        )
          used.add(JSON.stringify([p.sheet, r.element]));
    }
  for (const [i, g] of geometries.entries())
    for (const r of g.tranche4?.partRefs ?? [])
      if (!used.has(JSON.stringify([packet.sheets[i].number, r.element])))
        findings.push({
          ...finding("native-part-reference-without-native-peer", r),
          sheet: packet.sheets[i].number,
        });
  return {
    parts,
    findings,
    eligible: parts.length,
    feasibility: parts
      .filter((p) => p.total > 1)
      .map((p) => ({
        kind: p.kind,
        view: p.view,
        group: p.group,
        part: p.part,
        total: p.total,
        sheet: p.sheet,
        assessment:
          "manual-independent-same-paper-feasible-alternative-required",
      })),
  };
}
