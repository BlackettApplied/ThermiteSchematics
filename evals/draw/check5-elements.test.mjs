import { expect, it } from "vitest";
import { elementFixture } from "./check5-navigation-fixture.mjs";
import { elementNavigationAudit } from "./element-navigation-oracle.mjs";
const audit = (x) =>
  elementNavigationAudit(x.packet, x.geometries, x.ir, x.request);
const problems = (x) => {
  const a = audit(x);
  return [...a.findings, ...a.failures];
};
it.each(["left-to-right", "top-to-bottom"])(
  "CHECK5 independent full-element positive (%s)",
  (flow) => {
    const x = elementFixture(flow),
      a = audit(x);
    expect(problems(x)).toEqual([]);
    expect(a.obligations).toHaveLength(6);
    expect(x.ir.internalRelations[0].verb).toBe("trips");
  },
);
it.each([
  [
    "wrong device",
    (x) =>
      (x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
        "K2.aux → 02.A1"),
  ],
  [
    "wrong function",
    (x) =>
      (x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
        "OL1.pole1 → 02.A1"),
  ],
  [
    "wrong sheet",
    (x) =>
      (x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
        "OL1.aux → 01.A1"),
  ],
  [
    "wrong zone",
    (x) =>
      (x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
        "OL1.aux → 02.D6"),
  ],
  [
    "wrong role",
    (x) =>
      (x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
        "OL1.aux coil → 02.A1"),
  ],
  [
    "wrong state",
    (x) =>
      (x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
        "OL1 NO contact 95–96 → 02.A1"),
  ],
  [
    "hidden entire selected element",
    (x) => {
      x.geometries[1].shapes = [];
      x.geometries[1].terminals = [];
    },
  ],
  [
    "hidden pointer",
    (x) =>
      (x.geometries[0].texts.find((t) => t.element === "nav-aux").painted =
        false),
  ],
  [
    "erased reverse",
    (x) =>
      (x.geometries[1].texts = x.geometries[1].texts.filter(
        (t) => !t.element.startsWith("nav-"),
      )),
  ],
  [
    "hidden body",
    (x) =>
      (x.geometries[1].shapes = x.geometries[1].shapes.filter(
        (s) => s.element !== "aux",
      )),
  ],
  ["missing source", (x) => delete x.ir.functions],
  ["missing geometry", (x) => (x.geometries[1] = null)],
  [
    "forged export only",
    (x) => {
      x.geometries[0].texts = x.geometries[0].texts.filter(
        (t) => t.element !== "nav-aux",
      );
      x.packet.navigation = {
        annotations: [
          { owner: "D", targetSheet: 2, zone: "A1", correct: true },
        ],
      };
    },
  ],
])("CHECK5 full-element adversary: %s", (_name, mutate) => {
  const x = elementFixture();
  expect(problems(x)).toEqual([]);
  mutate(x);
  expect(problems(x).length).toBeGreaterThan(0);
});
it("CHECK5 full-element terminals identify a native function without construction inference", () => {
  const x = elementFixture();
  x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
    "OL1 NC contact 95–96 → 02.A1";
  expect(problems(x)).toEqual([]);
});
it("CHECK5 undrawn auxiliary, ordinary repeats, and unrelated devices create no detached obligation", () => {
  const x = elementFixture();
  x.request.views[1].groups[0].functions = [];
  x.geometries[1].shapes = [];
  x.geometries[1].terminals = [];
  x.geometries.forEach(
    (g) => (g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"))),
  );
  expect(problems(x)).toEqual([]);
  expect(audit(x).eligible).toBe(0);
});
it("CHECK5 native coil actuation remains in the existing mirror population", () => {
  const x = elementFixture();
  const coil = { deviceUid: "D", functionKey: "coil" };
  x.ir.functions.push({ id: coil, kind: "coil", terminals: [] });
  x.ir.internalRelations = x.ir.functions
    .filter((f) => f.kind === "contact")
    .map((f) => ({ deviceUid: "D", verb: "actuates", from: coil, to: f.id }));
  x.geometries.forEach(
    (g) => (g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"))),
  );
  expect(problems(x)).toEqual([]);
  expect(audit(x).eligible).toBe(0);
});
it("CHECK5 a mechanism actuates relation never impersonates coil actuation", () => {
  const x = elementFixture();
  x.ir.internalRelations = x.ir.functions
    .filter((f) => f.kind === "contact")
    .map((f) => ({
      deviceUid: "D",
      verb: "actuates",
      from: { deviceUid: "D", functionKey: "trip" },
      to: f.id,
    }));
  x.geometries.forEach(
    (g) => (g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"))),
  );
  expect(audit(x).eligible).toBe(6);
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("CHECK5 similarly tagged distinct native UIDs do not become peers", () => {
  const x = elementFixture();
  const uid = "OTHER";
  x.ir.devices.push({ uid, designation: "OL11", typeId: "type" });
  for (const f of x.ir.functions.filter((f) => f.id.functionKey === "aux")) {
    f.id.deviceUid = uid;
    f.terminals.forEach((t) => (t.deviceUid = uid));
  }
  x.request.views[1].groups[0].functions[0].device.value = uid;
  x.geometries[1].shapes.forEach((s) => (s.deviceUid = uid));
  x.geometries[1].terminals.forEach((t) => (t.deviceUid = uid));
  expect(audit(x).obligations).toEqual([]);
});
it("CHECK5 repeated native destinations all resolve under the same function identity", () => {
  const x = elementFixture();
  x.packet.sheets.push({ ...structuredClone(x.packet.sheets[1]), number: 3 });
  x.geometries.push(structuredClone(x.geometries[1]));
  x.geometries[0].texts.find((t) => t.element === "nav-aux").text =
    "OL1.aux → 02.A1, 03.A1";
  expect(problems(x)).toEqual([]);
  expect(audit(x).obligations).toHaveLength(12);
});
it("CHECK5 a selected appearance cannot vanish with all of its annotation and geometry", () => {
  const x = elementFixture();
  x.geometries[1].shapes = [];
  x.geometries[1].terminals = [];
  x.geometries.forEach(
    (g) => (g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"))),
  );
  expect(
    audit(x).failures.some(
      (f) => f.kind === "element-navigation-selected-appearance-unavailable",
    ),
  ).toBe(true);
});
it("CHECK5 correct distant ink is not a local pointer", () => {
  const x = elementFixture();
  x.geometries[0].texts.find((t) => t.element === "nav-aux").bbox.y = 200;
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("CHECK5 filled native bodies and circuit shape classes retain their population", () => {
  const x = elementFixture();
  x.geometries.forEach((g) =>
    g.shapes
      .filter((s) => s.symbol)
      .forEach((s) => {
        s.stroke = 0;
        s.fill = "#101828";
        s.glyphBody = true;
        delete s.symbol;
      }),
  );
  expect(problems(x)).toEqual([]);
  expect(audit(x).eligible).toBe(6);
});
it("CHECK5 unrelated canvas labels cannot be flattened into a fake reference", () => {
  const x = elementFixture();
  const note = x.geometries[0].texts.find((t) => t.element === "nav-aux");
  note.text = "02.A1";
  note.textContainer = "whole-canvas";
  x.geometries[0].texts.push({
    ...structuredClone(note),
    element: "unrelated",
    text: "OL1.aux",
    bbox: { x: 200, y: 200, w: 20, h: 3 },
  });
  expect(audit(x).findings.length).toBeGreaterThan(0);
});
it("CHECK5 PLC channels and source/PE pairs need a separate navigation convention", () => {
  const x = elementFixture();
  x.ir.deviceTypes[0].circuitSymbols = {};
  x.ir.functions.forEach((f) => (f.kind = "channel"));
  x.geometries.forEach(
    (g) => (g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"))),
  );
  expect(audit(x).eligible).toBe(0);
  expect(problems(x)).toEqual([]);
});
it("CHECK5 a complete circuit terminal interface is not a full selected function", () => {
  const x = elementFixture();
  x.request.views[1].groups[0].functions = [];
  x.geometries[1].shapes = x.geometries[1].shapes.filter(
    (s) => s.element !== "aux",
  );
  x.geometries.forEach(
    (g) => (g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"))),
  );
  expect(problems(x)).toEqual([]);
  expect(audit(x).eligible).toBe(0);
});
it("CHECK5 a rooted protection body cannot disappear while its native terminal ink remains", () => {
  const x = elementFixture();
  x.packet.sheets[1].view = {
    family: "control",
    root: { deviceUid: "D", designation: "OL1" },
  };
  x.request.views[1] = {
    format: "schematic-view-request/0.1",
    family: "control",
    root: { by: "uid", value: "D" },
  };
  expect(problems(x)).toEqual([]);
  x.geometries[1].shapes = x.geometries[1].shapes.filter(
    (s) => s.element !== "aux",
  );
  expect(
    audit(x).failures.some(
      (f) => f.kind === "element-navigation-body-unavailable",
    ),
  ).toBe(true);
});
