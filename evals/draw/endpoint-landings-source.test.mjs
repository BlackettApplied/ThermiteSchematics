import { expect, it } from "vitest";
import { endpointLandingFindings } from "./endpoint-landings.mjs";

const end = (deviceUid, terminalKey) => ({ deviceUid, terminalKey });
const a = end("A", "1"),
  b = end("B", "2");
const native = () => ({
  devices: [
    { uid: "A", typeId: "t" },
    { uid: "B", typeId: "t" },
  ],
  deviceTypes: [{ id: "t", ports: { P: {} }, connectorPorts: { C: {} } }],
  terminals: [{ id: a }, { id: b }],
  wires: [{ uid: "wire", endpoints: [{ terminal: a }, { terminal: b }] }],
  jumpers: [],
  cables: [{ uid: "cable" }],
  cableConductors: [
    {
      id: { cableUid: "cable", conductorId: "core" },
      cableUid: "cable",
      endpoints: [{ terminal: a }, { terminal: b }],
    },
  ],
  relations: [
    {
      uid: "link",
      fromDeviceUid: "A",
      toDeviceUid: "B",
      connection: { fromPort: "P", toPort: "P" },
    },
    {
      uid: "assembly",
      fromDeviceUid: "A",
      toDeviceUid: "B",
      assembly: { fromPort: "C", toPort: "C" },
    },
  ],
});
const landing = (endName, deviceUid, terminal, anchorKind) => ({
  end: endName,
  deviceUid,
  ownerDeviceUid: deviceUid,
  terminal,
  anchorKind,
  endpoint: { x: 10, y: 20 },
  anchor: { x: 10, y: 20 },
});
const relation = (family = "loop") => {
  const terminal =
    family === "communication" ? "P" : family === "assembly" ? "C" : null;
  return {
    element: "route",
    relationFamily: family,
    relationKey:
      family === "loop"
        ? "wire"
        : family === "communication"
          ? "link"
          : "assembly",
    ownedLandings: [
      landing("source", "A", terminal ?? "1", family),
      landing("target", "B", terminal ?? "2", family),
    ],
  };
};
const findings = (r, ir = native()) =>
  endpointLandingFindings({ shapes: [], relationLandings: [r] }, ir);

it.each(["loop", "communication", "assembly"])(
  "binds a correct %s relation to native source",
  (family) => {
    expect(findings(relation(family))).toEqual([]);
  },
);

it("does not certify a relation when the native IR is unavailable", () => {
  expect(
    endpointLandingFindings({ shapes: [], relationLandings: [relation()] }),
  ).toEqual([
    expect.objectContaining({ reason: "missing-source-relation-identity" }),
  ]);
});
it.each(["source", "target"])(
  "checks a visible %s landing when the other end is clipped",
  (visible) => {
    const r = relation();
    r.ownedLandings = r.ownedLandings.filter((p) => p.end === visible);
    expect(findings(r)).toEqual([]);
  },
);
it.each([
  "unknown-end",
  "missing-landings",
  "malformed-source",
  "duplicate-key",
  "duplicate-terminal",
  "missing-source-terminal",
  "missing-source-device",
  "malformed-declaration",
])("fails closed once on %s", (caseName) => {
  const r = relation(),
    source = native();
  let reason = "missing-drawn-identity";
  if (caseName === "unknown-end") r.ownedLandings[1].end = "unknown";
  if (caseName === "missing-landings") delete r.ownedLandings;
  if (caseName === "malformed-source") {
    source.wires[0].endpoints = null;
    reason = "missing-source-identity";
  }
  if (caseName === "duplicate-key") {
    source.wires.push(structuredClone(source.wires[0]));
    reason = "ambiguous-source-relation";
  }
  if (caseName === "duplicate-terminal") {
    source.terminals.push({ id: b });
    reason = "ambiguous-source-identity";
  }
  if (caseName === "missing-source-terminal") {
    source.terminals.pop();
    reason = "missing-source-identity";
  }
  if (caseName === "missing-source-device") {
    source.devices.pop();
    reason = "missing-source-identity";
  }
  if (caseName === "malformed-declaration") {
    r.declaredEndpoints = null;
    reason = "drawn-relation-endpoints-mismatch";
  }
  expect(findings(r, source)).toEqual([expect.objectContaining({ reason })]);
});
it.each(["loop", "communication", "assembly"])(
  "rejects coherent foreign ownership for %s with exactly one finding",
  (family) => {
    const r = relation(family);
    Object.assign(r.ownedLandings[1], {
      deviceUid: "FOREIGN",
      ownerDeviceUid: "FOREIGN",
    });
    expect(findings(r)).toEqual([
      expect.objectContaining({
        kind: "endpoint-landing-source-mismatch",
        end: "target",
        reason: "source-owner-mismatch",
      }),
    ]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "rejects the right device on a wrong %s terminal/port",
  (family) => {
    const r = relation(family);
    r.ownedLandings[1].terminal = "WRONG";
    expect(findings(r)).toEqual([
      expect.objectContaining({
        reason: "source-terminal-mismatch",
        end: "target",
      }),
    ]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "refuses a forged %s terminal owner hidden by the marker tuple",
  (family) => {
    const r = relation(family);
    r.ownedLandings[1].ownerDeviceUid = "FOREIGN";
    expect(findings(r)).toEqual([
      expect.objectContaining({
        reason: "source-owner-mismatch",
        end: "target",
      }),
    ]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "fails closed on a missing %s identity",
  (family) => {
    const r = relation(family);
    delete r.ownedLandings[1].terminal;
    expect(findings(r)).toEqual([
      expect.objectContaining({
        reason: "missing-drawn-identity",
        end: "target",
      }),
    ]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "refuses a wrong %s relation key once",
  (family) => {
    const r = relation(family);
    r.relationKey = "unknown";
    expect(findings(r)).toEqual([
      expect.objectContaining({ reason: "unknown-source-relation" }),
    ]);
  },
);
it.each(["loop", "communication", "assembly"])(
  "refuses an ambiguous native %s identity once",
  (family) => {
    const ir = native(),
      r = relation(family);
    ir.devices.push({ ...ir.devices[1] });
    expect(findings(r, ir)).toEqual([
      expect.objectContaining({ reason: "ambiguous-source-identity" }),
    ]);
  },
);
it("fails the historical DT1 P4 coherent FOREIGN/X declaration without native identity", () => {
  const r = {
    element: "synthetic-loop",
    ownedLandings: [landing("target", "FOREIGN", "X", "loop")],
  };
  expect(findings(r)).toEqual([
    expect.objectContaining({ kind: "endpoint-landing-source-unavailable" }),
  ]);
});
it("cannot pass a declared unavailable anchor merely because its points coincide", () => {
  const r = relation();
  r.ownedLandings[1].reason = "ambiguous-owned-anchor";
  expect(findings(r)).toEqual([
    expect.objectContaining({
      kind: "endpoint-landing-ownership-unavailable",
      reason: "ambiguous-owned-anchor",
    }),
  ]);
});
it("resolves cable core keys independent of JSON property order and accepts reversed loop orientation", () => {
  const r = relation();
  r.relationKey = '{"conductorId":"core","cableUid":"cable"}';
  r.ownedLandings.reverse();
  r.ownedLandings.forEach((p, i) => {
    p.end = i ? "target" : "source";
  });
  expect(findings(r)).toEqual([]);
});
it("does not allow both loop ends to use the same native terminal", () => {
  const r = relation();
  Object.assign(r.ownedLandings[1], {
    deviceUid: "A",
    ownerDeviceUid: "A",
    terminal: "1",
  });
  expect(findings(r)).toEqual([
    expect.objectContaining({
      reason: "repeated-source-endpoint",
      end: "target",
    }),
  ]);
});
it("keeps communication ports distinct from electrical terminals and assembly ports", () => {
  const r = relation("communication");
  r.ownedLandings[1].anchorKind = "assembly";
  expect(findings(r)).toEqual([
    expect.objectContaining({
      reason: "source-port-kind-mismatch",
      end: "target",
    }),
  ]);
});
it("does not infer a relation key from historical endpoint declarations", () => {
  const r = relation();
  delete r.relationKey;
  r.declaredEndpoints = [a, b];
  expect(findings(r)).toEqual([
    expect.objectContaining({ kind: "endpoint-landing-source-unavailable" }),
  ]);
});
