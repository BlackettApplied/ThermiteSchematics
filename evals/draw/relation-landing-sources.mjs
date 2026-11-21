// Expected owners come only from native IR. SVG keys select a source row;
// exported endpoint declarations never supply or repair a missing source owner.
const token = (s) => typeof s === "string" && s.trim().length > 0;
const terminal = (p) => token(p?.deviceUid) && token(p?.terminalKey);
const same = (a, b) =>
  a?.deviceUid === b?.deviceUid && a?.terminalKey === b?.terminalKey;
const pair = (row) =>
  Array.isArray(row?.endpoints) ? row.endpoints.map((e) => e?.terminal) : null;
const validPair = (ends) =>
  Array.isArray(ends) && ends.length === 2 && ends.every(terminal);
const coreKey = (id) => JSON.stringify([id?.cableUid, id?.conductorId]);
const nativeSources = new WeakMap();
export const relationLandingSource = (g) => nativeSources.get(g);
export function withRelationLandingSource(g, ir, evaluate) {
  nativeSources.set(g, ir);
  try {
    return evaluate();
  } finally {
    nativeSources.delete(g);
  }
}
function sourceIdentity(ir, p, family) {
  const devices = ir.devices?.filter((d) => d.uid === p.deviceUid) ?? [];
  if (devices.length > 1) return "ambiguous-source-identity";
  if (devices.length !== 1) return "missing-source-identity";
  if (family === "loop") {
    const terminals = ir.terminals?.filter((t) => same(t.id, p)) ?? [];
    return terminals.length === 1
      ? null
      : terminals.length > 1
        ? "ambiguous-source-identity"
        : "missing-source-identity";
  }
  const types = ir.deviceTypes?.filter((t) => t.id === devices[0].typeId) ?? [];
  if (types.length > 1) return "ambiguous-source-identity";
  const ports =
    types[0]?.[family === "communication" ? "ports" : "connectorPorts"];
  return types.length === 1 && Object.hasOwn(ports ?? {}, p.terminalKey)
    ? null
    : "missing-source-identity";
}
function loopSource(key, ir) {
  let id;
  try {
    id = JSON.parse(key);
  } catch {}
  if (id && typeof id === "object") {
    if (
      !token(id.cableUid) ||
      !token(id.conductorId) ||
      Object.keys(id).sort().join() !== "cableUid,conductorId"
    )
      return [];
    return (ir.cableConductors ?? []).filter(
      (c) => coreKey(c.id) === coreKey(id) && c.cableUid === id.cableUid,
    );
  }
  return [...(ir.wires ?? []), ...(ir.jumpers ?? [])].filter(
    (c) => c.uid === key,
  );
}
function bundleSource(key, ir) {
  const cables = ir.cables?.filter((c) => c.uid === key) ?? [];
  if (cables.length !== 1)
    return {
      reason: cables.length
        ? "ambiguous-source-relation"
        : "unknown-source-relation",
    };
  const cores = ir.cableConductors?.filter((c) => c.cableUid === key) ?? [];
  if (
    !cores.length ||
    cores.some(
      (c) =>
        c.id?.cableUid !== key ||
        !token(c.id?.conductorId) ||
        !validPair(pair(c)),
    )
  )
    return { reason: "missing-source-identity" };
  if (new Set(cores.map((c) => coreKey(c.id))).size !== cores.length)
    return { reason: "ambiguous-source-relation" };
  const uids = [
    ...new Set(cores.flatMap((c) => pair(c).map((p) => p.deviceUid))),
  ].sort();
  if (
    uids.length !== 2 ||
    cores.some((c) => new Set(pair(c).map((p) => p.deviceUid)).size !== 2)
  )
    return { reason: "ambiguous-source-identity" };
  for (const c of cores)
    for (const p of pair(c)) {
      const reason = sourceIdentity(ir, p, "loop");
      if (reason) return { reason };
    }
  return {
    ends: uids.map((deviceUid) => ({
      deviceUid,
      terminals: cores
        .map((c) => pair(c).find((p) => p.deviceUid === deviceUid).terminalKey)
        .sort(),
    })),
    members: cores.map((c) => ({ key: coreKey(c.id), ends: pair(c) })),
  };
}
export function sourceRelation(s, ir) {
  const family = s.relationFamily,
    key = s.relationKey;
  if (
    !ir ||
    !["loop", "communication", "assembly", "loop-bundle"].includes(family) ||
    !token(key)
  )
    return { reason: "missing-source-relation-identity" };
  if (family === "loop-bundle") return bundleSource(key, ir);
  const rows =
    family === "loop"
      ? loopSource(key, ir)
      : (ir.relations ?? []).filter((r) => r.uid === key);
  if (rows.length !== 1)
    return {
      reason: rows.length
        ? "ambiguous-source-relation"
        : "unknown-source-relation",
    };
  const row = rows[0],
    detail = row[family === "communication" ? "connection" : "assembly"];
  const ends =
    family === "loop"
      ? pair(row)
      : [
          { deviceUid: row.fromDeviceUid, terminalKey: detail?.fromPort },
          { deviceUid: row.toDeviceUid, terminalKey: detail?.toPort },
        ];
  if (!validPair(ends)) return { reason: "missing-source-identity" };
  for (const p of ends) {
    const reason = sourceIdentity(ir, p, family);
    if (reason) return { reason };
  }
  return { ends };
}
function bundleClaimsMatch(s, source) {
  if (
    !Array.isArray(s.bundleMembers) ||
    s.bundleMembers.length !== source.members.length
  )
    return false;
  const used = new Set();
  return s.bundleMembers.every((m) => {
    let id;
    try {
      id = JSON.parse(m?.id);
    } catch {
      return false;
    }
    const key = coreKey(id),
      native = source.members.filter((c) => c.key === key);
    if (used.has(key) || native.length !== 1 || !validPair(m.ends))
      return false;
    used.add(key);
    return (
      m.ends.every((p) => native[0].ends.some((q) => same(p, q))) &&
      !same(m.ends[0], m.ends[1])
    );
  });
}
function declaredPairMatches(s, ends) {
  if (s.declaredEndpoints === undefined) return true; // Historical keys + unique markers remain sufficient.
  const claims = Array.isArray(s.declaredEndpoints)
    ? s.declaredEndpoints.map((p) => ({
        deviceUid: p?.deviceUid,
        terminalKey: s.relationFamily === "loop" ? p?.terminalKey : p?.portKey,
      }))
    : null;
  return (
    validPair(claims) &&
    (s.relationFamily === "loop"
      ? claims.every((p) => ends.some((q) => same(p, q))) &&
        !same(claims[0], claims[1])
      : claims.every((p, i) => same(p, ends[i])))
  );
}
const finding = (s, reason, source, landing, mismatch = false) => ({
  kind: mismatch
    ? "endpoint-landing-source-mismatch"
    : "endpoint-landing-source-unavailable",
  element: s.element,
  relationFamily: s.relationFamily,
  relationKey: s.relationKey,
  ...(s.bbox ? { bbox: s.bbox } : { sheetLevel: true }),
  ...(landing
    ? {
        end: landing.end,
        deviceUid: landing.deviceUid,
        ownerDeviceUid: landing.ownerDeviceUid,
        terminal: landing.terminal,
      }
    : {}),
  sourceEndpoints: source.ends,
  reason,
});
function claimIdentityReason(p) {
  if (p.identityClaims === undefined) return null; // Older measurement DTOs.
  if (!Array.isArray(p.identityClaims)) return "invalid-drawn-identity";
  for (const { field, value } of p.identityClaims) {
    const kind =
      field === "data-communication-port"
        ? "communication"
        : field === "data-connector-port"
          ? "assembly"
          : "loop";
    let uid = p.ownerDeviceUid,
      key = value;
    if (
      [
        "data-terminal-id",
        "data-loop-terminal",
        "data-terminal-attachment",
      ].includes(field)
    ) {
      let tuple;
      try {
        tuple = JSON.parse(value);
      } catch {
        return "invalid-drawn-identity";
      }
      if (!Array.isArray(tuple) || tuple.length !== 2)
        return "invalid-drawn-identity";
      [uid, key] = tuple;
    }
    if (!token(uid) || !token(key)) return "invalid-drawn-identity";
    if (kind !== p.anchorKind || uid !== p.deviceUid || key !== p.terminal)
      return "ambiguous-drawn-identity";
  }
  return null;
}
export function relationLandingSourceFindings(s, ir) {
  const landings = s.ownedLandings;
  const source = sourceRelation(s, ir);
  if (source.reason) return [finding(s, source.reason, source)];
  if (!Array.isArray(landings))
    return [finding(s, "missing-drawn-identity", source)];
  if (
    s.relationFamily === "loop-bundle"
      ? !bundleClaimsMatch(s, source)
      : !declaredPairMatches(s, source.ends)
  )
    return [
      finding(s, "drawn-relation-endpoints-mismatch", source, undefined, true),
    ];
  const used = new Set();
  return landings.flatMap((p) => {
    // Anchor availability and position retain their independent geometry guard.
    if (p.reason) return [];
    let reason = claimIdentityReason(p);
    if (
      !token(p.deviceUid) ||
      !token(p.ownerDeviceUid) ||
      !["source", "target"].includes(p.end) ||
      (s.relationFamily !== "loop-bundle" && !token(p.terminal))
    )
      reason ??= "missing-drawn-identity";
    const allowed = ["loop", "loop-bundle"].includes(s.relationFamily)
      ? source.ends
      : [
          source.ends[p.end === "source" ? 0 : p.end === "target" ? 1 : -1],
        ].filter(Boolean);
    const owners = allowed.filter(
      (q) => q.deviceUid === p.deviceUid && q.deviceUid === p.ownerDeviceUid,
    );
    if (!reason && !owners.length) reason = "source-owner-mismatch";
    if (!reason && p.anchorKind !== s.relationFamily)
      reason = "source-port-kind-mismatch";
    const expected = owners.find((q) =>
      s.relationFamily === "loop-bundle"
        ? p.bundleUid === s.relationKey
        : q.terminalKey === p.terminal,
    );
    if (!reason && !expected) reason = "source-terminal-mismatch";
    const key = JSON.stringify([p.deviceUid, p.terminal, p.bundleUid]);
    if (!reason && used.has(key)) reason = "repeated-source-endpoint";
    used.add(key);
    return reason
      ? [
          finding(
            s,
            reason,
            source,
            p,
            ![
              "missing-drawn-identity",
              "invalid-drawn-identity",
              "ambiguous-drawn-identity",
            ].includes(reason),
          ),
        ]
      : [];
  });
}
