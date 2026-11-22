import {
  elementPopulation,
  existingActuationPair,
} from "./element-navigation-source.mjs";
import {
  referenceInk,
  referenceTokens,
  hasReferenceName,
} from "./navigation-reference-ink.mjs";
import { rowZones } from "./m3-zones.mjs";
import { nearestOwner, anchorDistance } from "./navigation-geometry.mjs";
import { finding } from "./review-geometry.mjs";
import { nativeContactRole } from "./contact-role-oracle.mjs";
function namesFunction(text, fn, ir) {
  const tag = ir.devices.find((d) => d.uid === fn.id.deviceUid)?.designation;
  const role = nativeContactRole(ir, fn).role;
  const states = [...text.matchAll(/\b(NC|NO)\b/gu)].map((m) => m[1]);
  if (states.some((state) => state !== nativeContactRole(ir, fn).state))
    return false;
  const claims = [
    ...text.matchAll(/\b(coil|contact|overload|breaker|fuse)\b/giu),
  ].map((m) => m[1].toLowerCase());
  if (claims.some((c) => c !== role)) return false;
  return (
    !!tag &&
    hasReferenceName(text, tag) &&
    (hasReferenceName(text, tag + "." + fn.id.functionKey) ||
      fn.terminals.every((t) => hasReferenceName(text, t.terminalKey)))
  );
}
function detachedProtectionPair(a, b, ir) {
  const fn = (x) =>
    ir.functions.find(
      (f) => f.id.deviceUid === x.uid && f.id.functionKey === x.functionKey,
    );
  const roles = [
    nativeContactRole(ir, fn(a)).role,
    nativeContactRole(ir, fn(b)).role,
  ];
  return (
    roles.includes("contact") &&
    roles.some((r) => ["overload", "breaker", "fuse"].includes(r))
  );
}
export function elementNavigationAudit(packet, geometries, ir, request) {
  const {
      appearances,
      failures,
      findings = [],
    } = elementPopulation(packet, geometries, ir, request),
    obligations = [];
  unresolvedElementPointers(appearances, geometries, ir, findings);
  for (const a of appearances) {
    const peers = appearances.filter(
      (b) =>
        a.uid === b.uid &&
        a.functionKey !== b.functionKey &&
        a.sheet !== b.sheet &&
        detachedProtectionPair(a, b, ir) &&
        !existingActuationPair(a, b, ir),
    );
    for (const b of peers) {
      inspectElementPair(
        a,
        b,
        appearances,
        geometries,
        ir,
        findings,
        failures,
        obligations,
      );
    }
  }
  return {
    findings,
    failures,
    obligations,
    eligible: obligations.length,
    appearances,
  };
}

function unresolvedElementPointers(appearances, geometries, ir, findings) {
  for (const a of appearances)
    for (const ink of referenceInk(geometries[a.geometryIndex]))
      for (const fn of ir.functions.filter(
        (f) =>
          f.id.deviceUid === a.uid &&
          f.terminals.length &&
          f.id.functionKey !== a.functionKey &&
          detachedProtectionPair(
            a,
            { uid: f.id.deviceUid, functionKey: f.id.functionKey },
            ir,
          ) &&
          !existingActuationPair(
            a,
            { uid: f.id.deviceUid, functionKey: f.id.functionKey },
            ir,
          ) &&
          namesFunction(ink.text, f, ir),
      ))
        for (const token of referenceTokens(ink.text)) {
          if (token.sheet === a.sheet) continue;
          if (
            !appearances.some(
              (b) =>
                b.uid === a.uid &&
                b.functionKey === fn.id.functionKey &&
                b.sheet === token.sheet &&
                rowZones(geometries[b.geometryIndex], b.bbox).includes(
                  token.zone,
                ),
            )
          )
            findings.push({
              ...finding("element-navigation-target-unavailable", ink, {
                deviceUid: a.uid,
                targetFunction: fn.id.functionKey,
                targetSheet: token.sheet,
                zone: token.zone,
              }),
              sheet: a.sheet,
            });
        }
}

function correctElementClause(t, a, b, appearances, geometries, ir, zones) {
  const tokens = referenceTokens(t.text),
    named = ir.functions.filter(
      (f) =>
        f.id.deviceUid === a.uid &&
        f.terminals.length &&
        namesFunction(t.text, f, ir),
    );
  const destinations = appearances.filter(
    (p) =>
      p.uid === b.uid && p.functionKey === b.functionKey && p.sheet !== a.sheet,
  );
  return (
    tokens.filter((p) => p.sheet === b.sheet && zones.includes(p.zone))
      .length === 1 &&
    (tokens.length === 1 || named.length === 1) &&
    tokens.every((p) =>
      destinations.some(
        (q) =>
          q.sheet === p.sheet &&
          rowZones(geometries[q.geometryIndex], q.bbox).includes(p.zone),
      ),
    )
  );
}

function inspectElementPair(
  a,
  b,
  appearances,
  geometries,
  ir,
  findings,
  failures,
  obligations,
) {
  const g = geometries[a.geometryIndex],
    target = geometries[b.geometryIndex],
    fn = ir.functions.find(
      (f) => f.id.deviceUid === b.uid && f.id.functionKey === b.functionKey,
    );
  const zones = rowZones(target, b.bbox),
    tag = ir.devices.find((d) => d.uid === a.uid)?.designation;
  const candidates = referenceInk(g).filter(
    (t) =>
      namesFunction(t.text, fn, ir) &&
      nearestOwner(g, a, t.bbox).ownerNearest &&
      anchorDistance(a.anchor, t.bbox) <= 60.01,
  );
  // One clause may name several functions at the SAME measured destination;
  // several different destinations need separate named clauses (no swaps).
  const correct = candidates.filter((t) =>
    correctElementClause(t, a, b, appearances, geometries, ir, zones),
  );
  const record = {
    sheet: a.sheet,
    deviceUid: a.uid,
    designation: tag,
    sourceFunction: a.functionKey,
    targetFunction: b.functionKey,
    targetSheet: b.sheet,
    allowedZones: zones,
    sourceElement: a.element,
    targetElement: b.element,
  };
  obligations.push(record);
  if (!zones.length)
    failures.push({
      ...finding("element-navigation-zone-geometry-unavailable", b, record),
      sheet: a.sheet,
    });
  else if (correct.length !== 1)
    findings.push({
      ...finding(
        "detached-element-reference-missing-or-wrong",
        candidates[0] ?? a,
        {
          ...record,
          matches: correct.length,
          printed: candidates.map((t) => t.text),
        },
      ),
      sheet: a.sheet,
    });
}
