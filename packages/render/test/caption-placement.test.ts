import { beforeAll, expect, it } from "vitest";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { prepareCircuitView } from "../src/circuit.js";
import { prepareSchematicDrawing } from "../src/renderer.js";
import { validateCompoundRegions } from "../src/layout/compound-regions.js";
import {
  identityProject,
  identityCircuit,
  mixedDisconnector,
} from "./symbol-identity-fixture.js";
import { controlCircuitView, motorCircuitView } from "./circuit-fixture.js";
import { parseHTML } from "linkedom";
import { captionOracle } from "./helpers/caption-oracle.js";
import {
  browserPath,
  launchBrowser,
} from "../../cli/test/helpers/pdf-raster.js";
import {
  captionInk,
  ownerCaption,
  inkGap,
  strokeBoxes,
} from "../src/symbols/caption-ink.js";

const must = <T>(x: T | null | undefined): T => {
  if (x == null) throw Error("Missing fixture value");
  return x;
};
const flows = ["left-to-right", "top-to-bottom"] as const;
let motor: ElectricalIr;
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error("Compile failed");
  motor = c.ir;
});

it("keeps legal anchors and separate terminal-caption spacing, with deterministic bounded refusal", () => {
  const box = captionInk("S1", 18, 3.3, 2.7, "middle", true),
    area = { left: 0, right: 40, top: 0, bottom: 30 };
  const other = {
    left: box.left,
    right: box.right,
    top: box.bottom + 0.5,
    bottom: box.bottom + 2,
  };
  expect(
    ownerCaption("S1", 18, 3.3, 2.7, "middle", true, area, [], [other]),
  ).toMatchObject({ x: 18, y: 3.3 });
  const stroke = strokeBoxes(
    [
      [
        { x: box.left - 0.6, y: 0 },
        { x: box.left - 0.6, y: 8 },
      ],
    ],
    0.35,
  );
  const p = ownerCaption("S1", 18, 3.3, 2.7, "middle", true, area, stroke);
  expect(inkGap(p.box, must(stroke[0]))).toBeGreaterThanOrEqual(1);
  expect(p).toEqual(
    ownerCaption("S1", 18, 3.3, 2.7, "middle", true, area, stroke),
  );
  expect(() =>
    ownerCaption("S1", 18, 3.3, 2.7, "middle", true, area, [area]),
  ).toThrow(/S1.*1 mm/);
});

for (const flow of flows) {
  it(`keeps rooted NO/NC ink beside its own contact (${flow})`, async () => {
    const browser = await launchBrowser(),
      page = await browser.newPage();
    try {
      for (const state of ["open", "closed"]) {
        const f = await identityProject(
          "thermite:disconnector",
          `aux-${state}`,
          "control",
          mixedDisconnector,
        );
        try {
          const r = await renderSchematicPacket(f.ir, {
            format: "schematic-packet-request/0.1",
            layout: "compact",
            views: [{ ...f.request, flow }],
          });
          if (!r.ok) throw Error(r.error.message);
          const sheet = must(
            r.value.sheets.find((s) =>
              s.svg.includes(`>${state === "open" ? "NO" : "NC"}</text>`),
            ),
          );
          const t = must(
            (await captionOracle(page, sheet.svg)).find(
              (t) => t.text === (state === "open" ? "NO" : "NC"),
            ),
          );
          if (flow === "top-to-bottom") {
            expect(t.wiringGap).toBeGreaterThanOrEqual(1);
            expect(t.markGap).toBeGreaterThanOrEqual(1);
            expect(t.textGap).toBeGreaterThanOrEqual(1);
            expect(t.markDistance).toBeLessThan(5);
          }
          expect(r.value.sheets.length).toBeLessThanOrEqual(
            flow === "top-to-bottom" ? 2 : 1,
          );
        } finally {
          await f.dispose();
        }
      }
    } finally {
      await browser.close();
    }
  });
  it(`clears every DUT attachment and source stub (${flow})`, async () => {
    const f = await identityProject(
        "thermite:disconnector",
        "aux-open",
        "control",
        mixedDisconnector,
      ),
      browser = await launchBrowser();
    try {
      const r = await renderSchematicPacket(f.ir, {
        format: "schematic-packet-request/0.1",
        layout: "compact",
        views: [identityCircuit(f.ir, flow, true)],
      });
      if (!r.ok) throw Error(r.error.message);
      const t = must(
        (
          await captionOracle(
            await browser.newPage(),
            must(r.value.sheets[0]).svg,
          )
        ).find((t) => t.text === "DUT"),
      );
      for (const owner of parseHTML(r.value.html).document.querySelectorAll(
        "[data-circuit-functions][data-device-uid]",
      )) {
        const uid = owner.getAttribute("data-device-uid");
        const tag = owner.querySelector(
          'g[data-tag-kind="body"] > text[data-tag-field="designation"]',
        );
        expect(tag?.textContent).toBe(
          must(f.ir.devices.find((d) => d.uid === uid)).designation,
        );
      }
      expect(t.attachmentGap).toBeGreaterThanOrEqual(1);
      expect(r.value.sheets).toHaveLength(1);
    } finally {
      await f.dispose();
      await browser.close();
    }
  });
  it(`keeps the relation footer clear of A2 and after the terminal elements (${flow})`, async () => {
    const r = await renderSchematicPacket(motor, {
      format: "schematic-packet-request/0.1",
      views: [
        { ...controlCircuitView(), flow },
        {
          format: "circuit-view-request/0.1",
          title: "Feedback",
          flow,
          groups: [
            {
              id: "feedback",
              lineReference: "300",
              functions: [
                { device: { by: "designation", value: "K1" }, key: "aux13" },
              ],
              conductors: [],
            },
          ],
        },
      ],
    });
    if (!r.ok) throw Error(r.error.message);
    const browser = await launchBrowser();
    try {
      const sheet = must(
          r.value.sheets.find((s) => s.svg.includes("13-14: 300")),
        ),
        t = must(
          (await captionOracle(await browser.newPage(), sheet.svg)).find(
            (t) => t.text === "13-14: 300",
          ),
        );
      expect(t.attachmentGap).toBeGreaterThanOrEqual(1);
      expect(r.value.sheets.length).toBeLessThanOrEqual(
        flow === "top-to-bottom" ? 3 : 2,
      );
      const doc = parseHTML(sheet.svg).document,
        footer = must(
          [...doc.querySelectorAll("text")].find(
            (t) => t.textContent === "13-14: 300",
          ),
        ),
        owner = must(footer.closest("[data-device-uid]"));
      expect([...owner.querySelectorAll("text")].at(-1)?.textContent).toBe(
        "13-14: 300",
      );
    } finally {
      await browser.close();
    }
  });
  it(`sizes the 40-contact summary from final lines and the body/pin minimum (${flow})`, async () => {
    const ir = structuredClone(motor),
      uid = must(ir.devices.find((d) => d.designation === "K1")).uid,
      base = must(
        ir.functions.find(
          (f) => f.id.deviceUid === uid && f.id.functionKey === "pole1",
        ),
      ),
      refs = new Map<string, string[]>();
    for (let i = 0; i < 40; i++) {
      const id = { deviceUid: uid, functionKey: `extra${i}` };
      ir.functions.push({ ...structuredClone(base), id });
      ir.internalRelations.push({
        deviceUid: uid,
        verb: "actuates",
        from: { deviceUid: uid, functionKey: "coil" },
        to: id,
        sourceOrigins: [],
      });
      refs.set(JSON.stringify([uid, id.functionKey]), ["300"]);
    }
    const r = await prepareCircuitView(
        ir,
        { ...controlCircuitView(), flow },
        refs,
      ),
      doc = parseHTML(must(r.groups[0]).content).document,
      coil = must(
        must(doc.querySelector('[data-function-key="coil"]')).closest(
          "[data-device-uid]",
        ),
      );
    expect(coil.textContent).toContain("40 contacts: 300");
    const width = Number(coil.getAttribute("data-circuit-body-width"));
    expect(width).toBeLessThan(40);
    expect(width).toBeGreaterThanOrEqual(20);
  });
}

it("reserves a separate self-loop S1 tag lane and designation paint order", async () => {
  const c = await compileProject("examples/self-loop-labels");
  if (!c.ok) throw Error("Compile failed");
  const { readFile } = await import("node:fs/promises");
  const request = JSON.parse(
    await readFile("examples/self-loop-labels/packet.json", "utf8"),
  );
  request.views[0].flow = "top-to-bottom";
  const r = await renderSchematicPacket(c.ir, request);
  if (!r.ok) throw Error(r.error.message);
  const doc = parseHTML(r.value.html).document,
    t = must(
      [...doc.querySelectorAll("text")].find((e) => e.textContent === "S1"),
    );
  expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(2.7);
  expect(t.getAttribute("data-tag-field")).toBe("designation");
  const owner = must(t.closest("[data-device-uid]"));
  const tag = must(owner.querySelector('g[data-tag-kind="body"]'));
  expect(owner.firstElementChild).toBe(tag);
  expect(tag.firstElementChild).toBe(t);
});

for (const flow of flows)
  it(`clears all SO1 source leads at natural type (${flow})`, async () => {
    const { readFile } = await import("node:fs/promises");
    const c = await compileProject("examples/functional-symbols");
    if (!c.ok) throw Error("Compile failed");
    const request = JSON.parse(
      await readFile(
        `examples/functional-symbols/packet-${flow}.request.json`,
        "utf8",
      ),
    );
    const r = await renderSchematicPacket(c.ir, request);
    if (!r.ok) throw Error(r.error.message);
    const browser = await launchBrowser();
    try {
      const sheet = must(
          r.value.sheets.find((s) => s.svg.includes(">SO1</text>")),
        ),
        t = must(
          (await captionOracle(await browser.newPage(), sheet.svg)).find(
            (t) => t.text === "SO1",
          ),
        );
      expect(t.attachmentGap).toBeGreaterThanOrEqual(1);
      expect(t.size).toBe(2.7);
      expect(t.length).toBeUndefined();
    } finally {
      await browser.close();
    }
  });

it("rejects a contact caption outside its pre-ELK owner region", async () => {
  const f = await identityProject(
    "thermite:disconnector",
    "aux-open",
    "control",
    mixedDisconnector,
  );
  try {
    const r = await prepareSchematicDrawing(f.ir, {
      ...f.request,
      flow: "top-to-bottom",
    });
    if (!r.ok) throw Error(r.error.message);
    const { graph, layout } = r.value,
      owner = must(
        graph.nodes.find(
          (n) =>
            n.kind === "symbol" &&
            n.labels.some((l) => l.printableText === "NO"),
        ),
      );
    const id = must(
      layout.labels.find(
        (l) => l.ownerId === owner.id && l.role === "function",
      ),
    ).id;
    const geometry = {
      nodes: new Map(layout.nodes.map((n) => [n.id, n])),
      ports: new Map(layout.ports.map((p) => [p.id, p])),
      labels: new Map(layout.labels.map((l) => [l.id, l])),
      edges: new Map(layout.edges.map((e) => [e.id, e])),
    };
    const check = {
      boundsOf: (r: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => ({
        left: r.x,
        top: r.y,
        right: r.x + r.width,
        bottom: r.y + r.height,
      }),
      inside: (
        a: { left: number; right: number; top: number; bottom: number },
        b: { left: number; right: number; top: number; bottom: number },
      ) =>
        a.left >= b.left &&
        a.right <= b.right &&
        a.top >= b.top &&
        a.bottom <= b.bottom,
      quantizeLayoutNumber: (n: unknown) => Number(Number(n).toFixed(3)),
      reject: (m: string): never => {
        throw Error(m);
      },
    };
    expect(() =>
      validateCompoundRegions(
        graph,
        geometry,
        layout.width,
        layout.height,
        check,
      ),
    ).not.toThrow();
    const original = must(geometry.labels.get(id));
    geometry.labels.set(id, { ...original, x: original.x - 8 });
    expect(() =>
      validateCompoundRegions(
        graph,
        geometry,
        layout.width,
        layout.height,
        check,
      ),
    ).toThrow(/owner-nearest contact region/);
  } finally {
    await f.dispose();
  }
});

it("preserves designation order before boundary text", async () => {
  const r = await renderSchematicPacket(motor, {
    format: "schematic-packet-request/0.1",
    views: [motorCircuitView()],
  });
  if (!r.ok) throw Error(r.error.message);
  const doc = parseHTML(r.value.html).document;
  let boundary = 0;
  for (const owner of doc.querySelectorAll(
    "[data-circuit-functions][data-device-uid]",
  )) {
    const texts = [...owner.querySelectorAll("text")];
    if (texts.some((t) => t.textContent === "BOUNDARY")) {
      const device = must(
        motor.devices.find(
          (d) => d.uid === owner.getAttribute("data-device-uid"),
        ),
      );
      expect(must(texts[0]).textContent).toBe(device.designation);
      boundary++;
    }
  }
  expect(boundary).toBeGreaterThan(0);
});

it("keeps the pushbutton NC caption beside its owning mark too", async () => {
  const r = await renderSchematicPacket(motor, {
    format: "schematic-packet-request/0.1",
    layout: "compact",
    views: [
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
        flow: "top-to-bottom",
      },
    ],
  });
  if (!r.ok) throw Error(r.error.message);
  const uid = must(motor.devices.find((d) => d.designation === "PB1")).uid,
    browser = await launchBrowser();
  let checked = 0;
  try {
    const page = await browser.newPage();
    for (const sheet of r.value.sheets)
      for (const t of await captionOracle(page, sheet.svg))
        if (t.text === "NC" && t.device === uid) {
          expect(t.markGap).toBeGreaterThanOrEqual(1);
          expect(t.wiringGap).toBeGreaterThanOrEqual(1);
          expect(t.markDistance).toBeLessThan(5);
          checked++;
        }
  } finally {
    await browser.close();
  }
  expect(checked).toBeGreaterThan(0);
});

it("keeps card offsets and caption ink in their owning content box", async () => {
  const { sideBranch } = await import("./profile-side-branch-fixture.js"),
    ir = await sideBranch("TB1", "3");
  const r = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    layout: "compact",
    views: [
      {
        format: "schematic-view-request/0.2",
        root: { by: "designation", value: "LS1" },
        flow: "top-to-bottom",
        intent: {
          kind: "trace",
          to: { by: "designation", value: "PLC1" },
          includePower: false,
        },
      },
    ],
  });
  if (!r.ok) throw Error(r.error.message);
  expect(r.value.html).toContain("data-off-view-terminal");
  const uid = must(ir.devices.find((d) => d.designation === "LS1")).uid,
    browser = await launchBrowser();
  let seen = 0;
  try {
    const page = await browser.newPage();
    for (const s of r.value.sheets)
      for (const t of await captionOracle(page, s.svg))
        if (t.text === "NO" && t.device === uid) {
          expect(t.markDistance).toBeLessThan(5);
          expect(t.markGap).toBeGreaterThanOrEqual(1);
          expect(t.wiringGap).toBeGreaterThanOrEqual(1);
          expect(t.cardGap).toBeGreaterThanOrEqual(1);
          seen++;
        }
  } finally {
    await browser.close();
  }
  expect(seen).toBeGreaterThan(0);
});

it("preserves caption locality when a card translates its content", async () => {
  const { contactCaptionRegion } =
    await import("../src/presentation/contact-caption.js");
  const r = await prepareSchematicDrawing(motor, {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "K1" },
    family: "control",
    flow: "top-to-bottom",
  });
  if (!r.ok) throw Error(r.error.message);
  const node = must(
    r.value.graph.nodes.find(
      (n) =>
        n.kind === "symbol" && n.labels.some((l) => l.printableText === "NC"),
    ),
  );
  if (node.kind !== "symbol") throw Error("Expected contact");
  const label = must(node.labels.find((l) => l.printableText === "NC")),
    body = node.contentBox ?? {
      x: 0,
      y: 0,
      width: node.width,
      height: node.height,
    };
  const translated = {
    ...node,
    primitiveOrigin: {
      x: node.primitiveOrigin.x + 40,
      y: node.primitiveOrigin.y + 24,
    },
    contentBox: { ...body, x: body.x + 40, y: body.y + 24 },
    width: node.width + 40,
    height: node.height + 24,
  };
  expect(contactCaptionRegion(translated, label)).toEqual(
    contactCaptionRegion(node, label),
  );
});

it("reserves caption lanes before routing only on failure, with a finite retry limit", async () => {
  const { reserveCircuitCaptions } =
      await import("../src/symbols/circuit-caption-reservation.js"),
    { CaptionPlacementError } = await import("../src/symbols/caption-ink.js");
  const owner = {
      width: 16,
      device: { designation: "XT1-S01" },
      relationLabels: [],
      pins: [{ side: "NORTH", x: 5.5 }],
    },
    before = JSON.stringify(owner);
  reserveCircuitCaptions([owner], true, () => {});
  expect(JSON.stringify(owner)).toBe(before);
  let calls = 0;
  reserveCircuitCaptions([owner], true, (n) => {
    calls++;
    if (calls === 1) throw new CaptionPlacementError(n.device.designation);
    expect(n.width).toBeGreaterThan(16);
  });
  expect(calls).toBe(2);
  expect(owner.pins).toEqual([{ side: "NORTH", x: 5.5 }]);
  calls = 0;
  expect(() =>
    reserveCircuitCaptions([owner], true, (n) => {
      if (++calls > 4) throw Error("unbounded probe");
      throw new CaptionPlacementError(n.device.designation);
    }),
  ).toThrow(/XT1-S01.*1 mm/);
  expect(calls).toBe(3);
});

for (const flow of flows)
  it(`reserves a side lane for the long terminal-strip designation (${flow})`, async () => {
    const { jumperChainCircuitFixture } = await import("./circuit-fixture.js"),
      f = await jumperChainCircuitFixture(),
      browser = await launchBrowser();
    try {
      const before = JSON.stringify(f.ir),
        r = await renderSchematicPacket(f.ir, {
          format: "schematic-packet-request/0.1",
          views: [{ ...f.view, flow }],
        });
      if (!r.ok) throw Error(r.error.message);
      const sheet = must(
          r.value.sheets.find((s) => s.svg.includes(">XT1-S01</text>")),
        ),
        t = must(
          (await captionOracle(await browser.newPage(), sheet.svg)).find(
            (t) => t.text === "XT1-S01",
          ),
        );
      expect(t.attachmentGap).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
      await browser.close();
    }
  });

for (const flow of flows)
  it(`clears custom winding leads and enclosures in the complete transformer circuit (${flow})`, async () => {
    const c = await compileProject(
      "packages/core-library/test/fixtures/transformer-control",
    );
    if (!c.ok) throw Error("Compile failed");
    const functions = [
      ["XT1", "terminal1"],
      ["XT1", "terminal2"],
      ["T1", "primary"],
      ["T1", "secondary"],
      ["R1", "coil"],
      ["H1", "lamp"],
    ].map(([value, key]) => ({
      device: { by: "designation" as const, value: must(value) },
      key: must(key),
    }));
    const r = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "circuit-view-request/0.1",
          title: "Unrated transformer control",
          flow,
          groups: [
            {
              id: "unrated-control",
              functions,
              conductors: ["W1", "W2", "W3", "W4", "W5", "W6"],
            },
          ],
        },
      ],
    });
    if (!r.ok) throw Error(r.error.message);
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      for (const word of ["T1", "XT1", "R1"]) {
        const t = must(
          (await captionOracle(page, must(r.value.sheets[0]).svg)).find(
            (t) => t.text === word,
          ),
        );
        expect(t.ownerStrokeGap, word).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await browser.close();
    }
  });
