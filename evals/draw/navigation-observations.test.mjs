import { expect, it } from "vitest";
import { navigationObservations } from "./navigation-observations.mjs";
import { observation } from "./evaluate.mjs";

function fixture() {
  const packet = {
    sheets: [1, 2].map((number) => ({
      number,
      view: { title: `View ${number}` },
    })),
  };
  return {
    packet,
    geometries: packet.sheets.map(() => ({
      texts: [],
      shapes: [],
      terminals: [],
    })),
    ir: { devices: [{ uid: "d", designation: "D1" }], functions: [] },
    request: { views: packet.sheets.map((s) => ({ title: s.view.title })) },
  };
}
const rows = (f) =>
  f.packet.sheets.flatMap((s) =>
    navigationObservations(
      { id: "native-probe" },
      s,
      f.packet,
      f.geometries,
      f.ir,
      f.request,
      (dq, issues, extra) =>
        observation({ id: "native-probe" }, s, dq, issues, extra),
    ),
  );
function nativeFunction(f, kind, sheets) {
  f.ir.functions.push({
    id: { deviceUid: "d", functionKey: "f" },
    kind,
    terminals: ["1", "2"].map((terminalKey) => ({
      deviceUid: "d",
      terminalKey,
    })),
  });
  for (const i of sheets) {
    const g = f.geometries[i];
    g.shapes.push({
      element: "body",
      deviceUid: "d",
      functionKey: "f",
      symbol: "symbol",
      functionScope: "glyph",
      navigationView: `view/${i}`,
      stroke: 0.2,
      bbox: { x: 20, y: 20, w: 20, h: 10 },
    });
    g.terminals.push(
      ...["1", "2"].map((terminal, j) => ({
        deviceUid: "d",
        terminal,
        functionScope: "glyph",
        painted: true,
        point: { x: 20 + j * 20, y: 25 },
      })),
    );
  }
}
it("emits one explicit packet absence, not one per empty sheet", () => {
  const f = fixture();
  nativeFunction(f, "resistor", [1]);
  expect(rows(f)).toEqual([
    expect.objectContaining({
      id: "native-probe/DQ-07/not-applicable",
      sheet: 1,
      status: "not-applicable",
      evidence: {
        findings: [],
        findingCount: 0,
        repeatObligations: 0,
        mirrorReturnAppearances: 0,
        nativeFunctions: { coils: 0, contacts: 0, actuates: 0 },
        packetViewKinds: [],
      },
    }),
  ]);
});
it.each([
  "coil",
  "repeat",
  "unmatched-repeat",
  "unmatched-mirror",
  "selected-missing-coil",
])(
  "native obligation or unmatched evidence %s prevents absence coverage",
  (kind) => {
    const f = fixture();
    if (kind === "coil") nativeFunction(f, "coil", [1]);
    if (kind === "repeat") nativeFunction(f, "resistor", [0, 1]);
    if (kind.startsWith("unmatched"))
      f.geometries[1].texts.push({
        text:
          kind === "unmatched-repeat"
            ? "D1: Also shown 01.A1"
            : "D1 Contact associations unspecified",
        element: "orphan",
        painted: true,
        navigationContainer: "orphan",
        navigationRole: kind === "unmatched-mirror" ? "mirror" : undefined,
        bbox: { x: 30, y: 30, w: 20, h: 3 },
      });
    if (kind === "selected-missing-coil") {
      nativeFunction(f, "coil", []);
      f.request.views[1].groups = [
        { functions: [{ device: { by: "uid", value: "d" }, key: "f" }] },
      ];
    }
    const observed = rows(f);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.some((r) => r.id.endsWith("/not-applicable"))).toBe(false);
    expect(observed.some((r) => r.status === "fail")).toBe(true);
  },
);

it("explains native relays without drawn function bodies without changing absence applicability", () => {
  const f = fixture();
  nativeFunction(f, "coil", []);
  f.ir.functions.push({
    ...f.ir.functions[0],
    id: { deviceUid: "d", functionKey: "contact" },
    kind: "contact",
  });
  f.ir.internalRelations = [
    {
      deviceUid: "d",
      verb: "actuates",
      from: f.ir.functions[0].id,
      to: f.ir.functions[1].id,
    },
  ];
  f.packet.sheets.forEach((s, i) => {
    s.view.kind = i ? "terminals" : "wiring";
  });
  const observed = rows(f);
  expect(observed).toHaveLength(1);
  expect(observed[0].status).toBe("not-applicable");
  expect(observed[0].evidence.nativeFunctions).toEqual({
    coils: 1,
    contacts: 1,
    actuates: 1,
  });
  expect(observed[0].evidence.packetViewKinds).toEqual(["terminals", "wiring"]);
  expect(observed[0].reason).toContain("no full coil/contact function bodies");
});
it("fails closed when an explicitly selected coil has no matching issued view title", () => {
  const f = fixture();
  nativeFunction(f, "coil", []);
  f.request.views[1].groups = [
    { functions: [{ device: { by: "uid", value: "d" }, key: "f" }] },
  ];
  f.packet.sheets[1].view.title = "No source view matches this";
  const observed = rows(f);
  expect(observed.some((r) => r.status === "not-applicable")).toBe(false);
  expect(
    observed.flatMap((r) => r.evidence.findings).map((f) => f.kind),
  ).toEqual(["navigation-selected-view-unresolved"]);
});
it("fails closed when an explicitly selected coil designation is ambiguous", () => {
  const f = fixture();
  nativeFunction(f, "coil", []);
  f.ir.devices.push({ uid: "foreign", designation: "D1" });
  f.request.views[0].groups = [
    { functions: [{ device: { by: "designation", value: "D1" }, key: "f" }] },
  ];
  const observed = rows(f);
  expect(observed.some((r) => r.status === "not-applicable")).toBe(false);
  expect(
    observed.flatMap((r) => r.evidence.findings).map((f) => f.kind),
  ).toEqual(["navigation-selected-source-unresolved"]);
});

it.each(["missing-device", "missing-function", "duplicate-function"])(
  "records an unresolved explicit native selection: %s",
  (kind) => {
    const f = fixture();
    nativeFunction(f, "coil", []);
    f.request.views[0].groups = [
      { functions: [{ device: { by: "uid", value: "d" }, key: "f" }] },
    ];
    if (kind === "missing-device") f.ir.devices = [];
    if (kind === "missing-function") f.ir.functions = [];
    if (kind === "duplicate-function")
      f.ir.functions.push(structuredClone(f.ir.functions[0]));
    const observed = rows(f);
    expect(observed.some((r) => r.status === "not-applicable")).toBe(false);
    expect(
      observed.flatMap((r) => r.evidence.findings).map((f) => f.kind),
    ).toEqual(["navigation-selected-source-unresolved"]);
  },
);
