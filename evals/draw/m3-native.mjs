import { nativeRelationReference } from "./relation-reference.mjs";
import { terminalKey, factKey } from "./m3-facts.mjs";
export {
  terminalKey,
  compact,
  semanticColumns,
  factKey,
  factKeys,
} from "./m3-facts.mjs";
import {
  assemblyFacts,
  assemblyStatus,
  appendUnoccupiedConnectors,
} from "./m3-connector-facts.mjs";
import { addWiringNeeds } from "./m3-wiring-needs.mjs";
import { assemblyNativeNeeds } from "./m3-assembly-needs.mjs";
// Independent issued-documents/1 adapter. Only native IR and measured source
// appearances enter this module; exported facts and planner code never do.
import { createHash } from "node:crypto";
import { nativeEmptyState } from "./native-empty-state.mjs";
export const M3_FORMAT = "issued-documents/1";
export const sha = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const device = (ir, uid) => ir.devices?.find((d) => d.uid === uid);
const endName = (ir, t) =>
  t
    ? `${device(ir, t.deviceUid)?.designation}.${t.terminalKey}`
    : "Unterminated";
const nativePortText = (ir, uid, key, network = true) => {
  const d = device(ir, uid),
    description = ir.deviceTypes
      ?.find((t) => t.id === d?.typeId)
      ?.ports?.[key]?.description?.trim();
  const identity = network
    ? `${d?.designation}: ${key}${description && description !== key ? ` — ${description}` : ""}`
    : `${d?.designation}.${key}`;
  return [identity, d?.location].filter(Boolean).join("\n");
};
const inc = (element, end, terminal) => ({
  kind: "conductor-incidence",
  element,
  end,
  terminal,
});
const port = (deviceUid, portKey) => ({
  kind: "port-link-status",
  deviceUid,
  portKey,
});
function appendWireRows(ir, rows) {
  for (const kind of ["wire", "jumper"])
    for (const w of ir[kind === "wire" ? "wires" : "jumpers"] ?? []) {
      const element = { kind, uid: w.uid },
        ends = w.endpoints.map((e) => e.terminal);
      rows.push({
        kind: "wires",
        key: w.uid,
        name: w.designation ?? "Jumper",
        ends,
        element,
        facts: ends.map((t, i) => inc(element, i, t)),
        required: {
          0: [
            [
              w.designation ?? "Jumper",
              w.properties?.label && w.properties.label !== w.designation
                ? w.properties.label
                : null,
            ]
              .filter(Boolean)
              .join(" / "),
          ],
          1: [endName(ir, ends[0])],
          2: [endName(ir, ends[1])],
          4: ["Connected"],
        },
        exactColumns: [0, 1, 2, 4],
      });
    }
}

function appendCableRows(ir, rows) {
  for (const cable of ir.cables ?? []) {
    const connected = (ir.cableConductors ?? []).filter(
      (c) => c.id.cableUid === cable.uid,
    );
    const defs =
      ir.cableTypes?.find((t) => t.id === cable.typeId)?.conductors ??
      connected.map((c) => ({ id: c.id.conductorId }));
    for (const def of defs) {
      const assignment = cable.assignments?.find((a) => a.id === def.id),
        physical = connected.find((c) => c.id.conductorId === def.id);
      const sourceEnds = assignment?.endpoints ?? physical?.endpoints,
        ends = [0, 1].map((i) => sourceEnds?.[i]?.terminal);
      const count = ends.filter(Boolean).length,
        usage =
          assignment?.usage ?? (sourceEnds ? "unspecified" : "unassigned");
      const status = !sourceEnds
        ? "unassigned"
        : count === 2
          ? "connected"
          : count === 1
            ? "partially-terminated"
            : "unterminated";
      const element = {
        kind: "cable_conductor",
        cableUid: cable.uid,
        conductorId: def.id,
      };
      rows.push({
        kind: "wires",
        key: JSON.stringify([cable.uid, def.id]),
        name: `${cable.designation}/${def.id}`,
        ends,
        element,
        facts: [
          ...ends.flatMap((t, i) => (t ? [inc(element, i, t)] : [])),
          { kind: "core-inventory", cableUid: cable.uid, conductorId: def.id },
        ],
        required: {
          0: [`${cable.designation}/${def.id}`],
          1: [endName(ir, ends[0])],
          2: [endName(ir, ends[1])],
          4: [`${usage}; ${status}`],
        },
        exactColumns: [0, 1, 2, 4],
      });
    }
  }
}

function appendTerminalRows(ir, rows) {
  for (const t of ir.terminals ?? []) {
    const id = t.id,
      connections = rows.filter((w) =>
        w.ends?.some((e) => e && terminalKey(e) === terminalKey(id)),
      );
    const peers = connections.flatMap((w) =>
      w.ends.flatMap((end, i) =>
        end && terminalKey(end) === terminalKey(id)
          ? [{ name: w.name, peer: w.ends[1 - i] }]
          : [],
      ),
    );
    const ownLocation = device(ir, id.deviceUid)?.location;
    const local = peers.filter(
      (p) =>
        p.peer &&
        ownLocation !== undefined &&
        device(ir, p.peer.deviceUid)?.location === ownLocation,
    );
    const connectionText = (ps) =>
      ps
        .map((p) => `${p.name} -> ${endName(ir, p.peer)}`)
        .sort()
        .join("; ");
    const other = peers.filter((p) => !local.includes(p));
    rows.push({
      kind: "terminals",
      key: terminalKey(id),
      name: endName(ir, id),
      facts: [{ kind: "terminal-inventory", terminal: id }],
      required: {
        0: [device(ir, id.deviceUid)?.designation],
        2: [id.terminalKey],
        4: [
          local.length
            ? connectionText(local)
            : nativeEmptyState("no-same-location-connections"),
        ],
        5: [
          other.length
            ? connectionText(other)
            : nativeEmptyState("no-other-location-connections"),
        ],
        6: [connections.length ? "Terminated" : "Unconnected"],
      },
      exactColumns: [0, 2, 4, 5, 6],
      connections: connections.map((w) => ({
        name: w.name,
        peers: w.ends
          .filter((e) => e && terminalKey(e) !== terminalKey(id))
          .map((e) => endName(ir, e)),
      })),
    });
  }
}

function appendRelationRows(ir, rows) {
  for (const r of ir.relations ?? []) {
    const c = r.connection ?? r.assembly;
    if (!c) continue;
    const network = !!r.connection;
    const identity = nativeRelationReference(ir, r).text;
    const status = network
      ? { requiredStatus: [c.status ?? nativeEmptyState("unspecified-status")] }
      : assemblyStatus(c);
    rows.push({
      kind: network ? "network" : "assemblies",
      key: r.uid,
      name: identity,
      facts: network
        ? [port(r.fromDeviceUid, c.fromPort), port(r.toDeviceUid, c.toPort)]
        : assemblyFacts(r),
      ownerUid: r.fromDeviceUid,
      ...(status.sourceGap ? { sourceGap: status.sourceGap } : {}),
      required: {
        0: [identity],
        1: network
          ? [
              [
                c.protocol,
                c.cable?.specification,
                c.cable?.lengthM === undefined
                  ? undefined
                  : `${c.cable.lengthM} m`,
                c.cable?.route,
              ]
                .filter(Boolean)
                .join("\n"),
            ]
          : [c.kind].filter(Boolean),
        2: [nativePortText(ir, r.fromDeviceUid, c.fromPort, network)],
        3: [nativePortText(ir, r.toDeviceUid, c.toPort, network)],
        4: status.requiredStatus,
      },
      exactColumns: network ? [0, 1, 2, 3, 4] : [0, 2, 3, 4],
      ports: [
        {
          column: 2,
          designation: device(ir, r.fromDeviceUid)?.designation,
          key: c.fromPort,
        },
        {
          column: 3,
          designation: device(ir, r.toDeviceUid)?.designation,
          key: c.toPort,
        },
      ],
    });
  }
}

function appendUnconnectedPorts(ir, rows) {
  for (const d of ir.devices ?? [])
    for (const [key, p] of Object.entries(
      ir.deviceTypes?.find((t) => t.id === d.typeId)?.ports ?? {},
    )) {
      if (p.kind && p.kind !== "communication") continue;
      if (
        (ir.relations ?? []).some(
          (r) =>
            r.connection &&
            ((r.fromDeviceUid === d.uid && r.connection.fromPort === key) ||
              (r.toDeviceUid === d.uid && r.connection.toPort === key)),
        )
      )
        continue;
      rows.push({
        kind: "network",
        key: JSON.stringify([d.uid, key]),
        name: `${d.designation}: ${key}`,
        facts: [port(d.uid, key)],
        required: {
          0: ["--"],
          1: [p.medium ?? nativeEmptyState("unspecified-medium")],
          2: [nativePortText(ir, d.uid, key)],
          3: ["Unconnected"],
          4: [nativeEmptyState("unspecified-status")],
        },
        exactColumns: [0, 1, 2, 3, 4],
        ports: [{ column: 2, designation: d.designation, key }],
      });
    }
}

export function nativeRows(ir) {
  const rows = [];
  appendWireRows(ir, rows);
  appendCableRows(ir, rows);
  appendTerminalRows(ir, rows);
  appendRelationRows(ir, rows);
  appendUnconnectedPorts(ir, rows);
  appendUnoccupiedConnectors(ir, rows);
  return rows;
}

const distinct = (values) => [...new Set(values)];
function communicationView(sheet, request) {
  const candidates = (request?.views ?? []).filter(
    (v) =>
      v.format === "communication-view-request/0.1" &&
      (!v.title || sheet.view.title?.startsWith(v.title)),
  );
  const single =
    request?.views?.length === 1 &&
    request.views[0].format === "communication-view-request/0.1"
      ? request.views[0]
      : undefined;
  const view = single ?? (candidates.length === 1 ? candidates[0] : undefined);
  return view;
}
function communicationAllowed(ir, view) {
  const scopedLinks = (ir.relations ?? []).filter(
    (r) =>
      r.connection && (!view?.medium || r.connection.medium === view.medium),
  );
  const allowed = new Set(
    view?.devices
      ? ir.devices
          .filter(
            (d) =>
              view.devices.includes(d.uid) ||
              view.devices.includes(d.designation),
          )
          .map((d) => d.uid)
      : ir.devices
          .filter(
            (d) =>
              !view?.medium ||
              Object.values(
                ir.deviceTypes?.find((t) => t.id === d.typeId)?.ports ?? {},
              ).some((p) => p.medium === view.medium),
          )
          .map((d) => d.uid),
  );
  if (!view?.devices)
    for (const r of scopedLinks) {
      allowed.add(r.fromDeviceUid);
      allowed.add(r.toDeviceUid);
    }
  for (let changed = true; changed;) {
    changed = false;
    for (const r of scopedLinks)
      if (allowed.has(r.fromDeviceUid) || allowed.has(r.toDeviceUid))
        for (const uid of [r.fromDeviceUid, r.toDeviceUid])
          if (!allowed.has(uid)) {
            allowed.add(uid);
            changed = true;
          }
  }
  return allowed;
}
function addCommunicationNeeds(sheet, request, ir, catalog, uids, own, add) {
  const view = communicationView(sheet, request),
    allowed = communicationAllowed(ir, view);
  const ordered = uids.slice().sort((a, b) => {
    const an = device(ir, a)?.designation ?? a,
      bn = device(ir, b)?.designation ?? b;
    return an < bn ? -1 : an > bn ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  const links = (ir.relations ?? [])
    .filter(
      (r) =>
        r.connection &&
        own.has(r.fromDeviceUid) &&
        own.has(r.toDeviceUid) &&
        (!view?.medium || r.connection.medium === view.medium),
    )
    .sort((a, b) =>
      (a.designation ?? a.uid) < (b.designation ?? b.uid)
        ? -1
        : (a.designation ?? a.uid) > (b.designation ?? b.uid)
          ? 1
          : 0,
    );
  const facts = catalog
    .filter((r) => r.kind === "network")
    .flatMap((r) =>
      r.facts.filter(
        (f) =>
          own.has(f.deviceUid) &&
          (!view?.medium ||
            ir.deviceTypes?.find(
              (t) => t.id === device(ir, f.deviceUid)?.typeId,
            )?.ports?.[f.portKey]?.medium === view.medium),
      ),
    );
  for (const r of links)
    facts.push(
      port(r.fromDeviceUid, r.connection.fromPort),
      port(r.toDeviceUid, r.connection.toPort),
    );
  add(
    "port-link-status",
    `communication-status/${sha([ordered, links.map((r) => r.uid)])}`,
    facts,
    { scopeMismatch: uids.filter((uid) => !allowed.has(uid)) },
  );
}

// Source appearance + native endpoint incidence partition. Dropping a caption or
// an exported dependency does not remove the independently expected need.
export function nativeNeeds(
  sheet,
  g,
  ir,
  catalog = nativeRows(ir),
  request,
  scope,
) {
  const kind = nativeProducerKind(request, sheet),
    needs = [],
    uids = distinct(
      [
        ...(g.devices ?? []).map((d) => d.deviceUid),
        ...(g.terminals ?? []).map((t) => t.deviceUid),
      ].filter((uid) => device(ir, uid)),
    ),
    own = new Set(uids);
  const add = (need, noteId, facts, extra = {}) => {
    const unique = [...new Map(facts.map((f) => [factKey(f), f])).values()];
    if (unique.length) needs.push({ need, noteId, facts: unique, ...extra });
  };
  if (kind === "wiring")
    addWiringNeeds(sheet, g, ir, catalog, request, uids, own, add);
  if (kind === "connector-assembly")
    return assemblyNativeNeeds(sheet, g, ir, request, scope);
  if (["communication", "topology"].includes(kind))
    addCommunicationNeeds(sheet, request, ir, catalog, uids, own, add);
  if (["signal-loop", "analog-output"].includes(kind)) {
    const cableUids = new Set(
      catalog
        .filter(
          (r) =>
            r.kind === "wires" &&
            r.ends?.some((t) => t && own.has(t.deviceUid)),
        )
        .map((r) => r.element?.cableUid)
        .filter(Boolean),
    );
    add(
      "core-inventory",
      "loop-core-details",
      catalog
        .filter((r) => r.kind === "wires")
        .flatMap((r) =>
          r.facts.filter(
            (f) => f.kind === "core-inventory" && cableUids.has(f.cableUid),
          ),
        ),
    );
    const rels = new Set(
      (ir.relations ?? [])
        .filter(
          (r) =>
            r.assembly && (own.has(r.fromDeviceUid) || own.has(r.toDeviceUid)),
        )
        .map((r) => r.uid),
    );
    add(
      "assembly-pin-map",
      "loop-assembly-pin-maps",
      catalog
        .filter((r) => r.kind === "assemblies" && rels.has(r.key))
        .flatMap((r) => r.facts.filter((f) => f.kind === "assembly-pin-map")),
    );
  }
  return [...new Map(needs.map((n) => [n.noteId, n])).values()];
}

export function nativeProducerKind(request, sheet) {
  const v = request?.views?.length === 1 ? request.views[0] : null;
  if (!v || request?.m3AutomaticDocument) return sheet.view.kind;
  return (
    {
      "wiring-view-request/0.1": "wiring",
      "communication-view-request/0.1": "communication",
      "signal-loop-view-request/0.1": "signal-loop",
      "connector-assembly-view-request/0.1": "connector-assembly",
    }[v.format] ??
    v.kind ??
    "other-selected-view"
  );
}
export function nativeRequestForSheet(packet, geometries, request, sheet) {
  const views = request?.views ?? (request ? [request] : []),
    ordered = [];
  const own = geometries[packet.sheets.indexOf(sheet)];
  if (automaticDocument(own)) return { ...request, m3AutomaticDocument: true };
  for (const [i, s] of packet.sheets.entries()) {
    if (
      ["index", "references"].includes(s.view.kind) ||
      automaticDocument(geometries[i])
    )
      continue;
    for (const key of geometries[i]?.navigationViews ?? [])
      if (!ordered.includes(key)) ordered.push(key);
  }
  const keys = own?.navigationViews ?? [],
    order = keys.length === 1 ? ordered.indexOf(keys[0]) : -1;
  return ordered.length === views.length && order >= 0
    ? { ...request, views: [views[order]], m3AuthoredViewIndex: order }
    : {
        ...request,
        m3ViewScopeGap: {
          expectedViews: views.length,
          issuedViews: ordered.length,
          ownerKeys: keys,
        },
      };
}
function automaticDocument(g) {
  // Inline rows do not erase the graphical sheet's authored navigation view.
  return (
    !g?.navigationViews?.length &&
    g?.texts?.some((t) => t.documentOrigin === "auto")
  );
}
