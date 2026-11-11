import { readFile } from "node:fs/promises";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { prepareWiringDrawing } from "../src/wiring.js";
import { prepareCommunicationPages } from "../src/communication.js";
import { prepareConnectorAssemblyDrawing } from "../src/connector-assembly.js";
import { prepareCircuitView } from "../src/circuit.js";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { connectorFixture } from "../../compiler/test/connector-fixture.js";
import { breakerAuxiliaryFixture } from "./breaker-auxiliary-fixture.js";
import { seriesFixture, request } from "./series-loop-fixture.js";
import { directFixture, directView } from "./direct-loop-fixture.js";

function authored(ir: ElectricalIr): ElectricalIr {
  return {
    ...ir,
    devices: ir.devices.map((d, i) => ({
      ...d,
      description:
        i % 3 === 0
          ? "Instance Ω e\u0301; engineering limit 24 V"
          : i % 3 === 1
            ? " \t "
            : undefined,
    })),
    deviceTypes: ir.deviceTypes.map((t, i) => ({
      ...t,
      description: `Type fallback ${i}; retain all qualifiers`,
      catalog: { ...t.catalog, orderNumber: `PART/${i}-` + "X".repeat(45) },
    })),
  };
}

/** Expected fields come directly from IR, independently of the renderer's plan. */
function complete(
  ir: ElectricalIr,
  content: string,
  refs: readonly { deviceUid: string }[],
) {
  const doc = parseHTML(`<svg>${content}</svg>`).document;
  for (const uid of new Set(refs.map((r) => r.deviceUid))) {
    const device = ir.devices.find((d) => d.uid === uid)!;
    const type = ir.deviceTypes.find((t) => t.id === device.typeId)!;
    const expected = {
      designation: device.designation,
      description: device.description?.trim()
        ? device.description
        : type.description?.trim()
          ? type.description
          : undefined,
      part: type.catalog?.orderNumber?.trim()
        ? type.catalog.orderNumber
        : undefined,
    };
    for (const [field, value] of Object.entries(expected)) {
      const rows = [
        ...doc.querySelectorAll(
          `[data-tag-owner-uid="${uid}"][data-tag-field="${field}"]`,
        ),
      ];
      expect(rows.map((r) => r.textContent).join("")).toBe(
        value === undefined
          ? ""
          : field === "part"
            ? value
            : value.replace(/\s+/gu, " ").trim(),
      );
      for (const row of rows) {
        expect(Number(row.getAttribute("font-size"))).toBeGreaterThanOrEqual(
          field === "designation" ? 2.7 : 2.5,
        );
        expect(row.getAttribute("fill")).toBe("#18212b");
        expect(row.hasAttribute("textLength")).toBe(false);
      }
    }
  }
}

it("prints instance, fallback and independent part rows on wiring and every communication part", async () => {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const ir = authored(c.ir),
    before = JSON.stringify(ir);
  const packet = JSON.parse(
    await readFile("examples/operator-console/packet.request.json", "utf8"),
  );
  const wiring = await prepareWiringDrawing(ir, packet.views[0]);
  complete(ir, wiring.content, wiring.references);
  const communication = packet.views.find(
    (v: { format: string }) => v.format === "communication-view-request/0.1",
  );
  const parts = await prepareCommunicationPages(
    ir,
    communication,
    (d) => d.references.length <= 2,
  );
  expect(parts.length).toBeGreaterThan(1);
  for (const part of parts) complete(ir, part.content, part.references);
  expect(JSON.stringify(ir)).toBe(before);
  // Identical authored fields on other devices cannot replace a missing owned row.
  const doc = parseHTML(`<svg>${wiring.content}</svg>`).document;
  doc.querySelector('[data-tag-field="description"]')!.remove();
  expect(() => complete(ir, doc.toString(), wiring.references)).toThrow();
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps complete circuit and ordinary/series loop tags with electrical IR unchanged in %s",
  async (flow) => {
    const circuit = await breakerAuxiliaryFixture();
    const series = await seriesFixture();
    const ordinary = await directFixture();
    try {
      const ir = authored(circuit.ir),
        before = JSON.stringify(ir);
      const drawing = await prepareCircuitView(ir, {
        ...circuit.request.views[0]!,
        flow,
      });
      for (const group of drawing.groups) {
        complete(ir, group.content, group.references);
        for (const row of parseHTML(
          `<svg>${group.content}</svg>`,
        ).document.querySelectorAll("text[data-tag-field]")) {
          expect(row.parentElement!.localName).toBe("g");
          expect(row.parentElement!.getAttribute("data-tag-owner-uid")).toBe(
            row.getAttribute("data-tag-owner-uid"),
          );
          expect(
            row.parentElement!.hasAttribute("data-circuit-functions"),
          ).toBe(false);
          expect(
            row.parentElement!.hasAttribute("data-related-functions"),
          ).toBe(false);
        }
      }
      expect(JSON.stringify(ir)).toBe(before);
      for (const [fixture, view] of [
        [series, request({ flow })],
        [ordinary, directView({ flow })],
      ] as const) {
        const source = authored(fixture.ir),
          original = JSON.stringify(source);
        const loop = await prepareSignalLoopDrawing(source, view);
        complete(source, loop.content, loop.references);
        expect(
          [
            ...parseHTML(
              `<svg>${loop.content}</svg>`,
            ).document.querySelectorAll("text"),
          ]
            .map((e) => e.textContent)
            .join(" "),
        ).toContain("selected channel");
        expect(JSON.stringify(source)).toBe(original);
      }
    } finally {
      await circuit.dispose();
      await series.dispose();
      await ordinary.dispose();
    }
  },
);

it("uses complete connector tags and omits empty optional fields without placeholders", async () => {
  const fixture = await connectorFixture();
  try {
    if (!fixture.result.ok)
      throw Error(JSON.stringify(fixture.result.diagnostics));
    const ir = authored(fixture.result.ir),
      before = JSON.stringify(ir);
    const view = {
      format: "connector-assembly-view-request/0.1" as const,
      assemblies: ["W1"],
    };
    const drawing = await prepareConnectorAssemblyDrawing(ir, view);
    complete(ir, drawing.content, drawing.references);
    expect(JSON.stringify(ir)).toBe(before);
    const bare = {
      ...ir,
      devices: ir.devices.map((d) => ({
        ...d,
        description: " ",
        location: undefined,
      })),
      deviceTypes: ir.deviceTypes.map((t) => ({
        ...t,
        description: " ",
        catalog: undefined,
      })),
    };
    const minimal = await prepareConnectorAssemblyDrawing(bare, view);
    complete(bare, minimal.content, minimal.references);
    expect(minimal.content).not.toContain("Location unspecified");
    expect(minimal.content).not.toContain('data-tag-field="part"');
  } finally {
    await fixture.dispose();
  }
});

it("refuses an owner with an unavoidable tag instead of shrinking or clipping", async () => {
  const f = await breakerAuxiliaryFixture();
  try {
    const ir = {
      ...f.ir,
      devices: f.ir.devices.map((d) => ({
        ...d,
        description: "Long authored qualification ".repeat(1000),
      })),
    };
    const result = await renderSchematicPacket(ir, f.request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("R006");
      expect(result.error.message).toContain("Q1");
      expect(result.error.message).toContain("description");
      expect(result.error.message).toContain("mm available");
      expect(result.error.details).toHaveProperty(
        "dimensions.requiredHeightMm",
      );
      expect(result.error.details).toHaveProperty("deviceTags");
    }
  } finally {
    await f.dispose();
  }
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "repeats complete local circuit tags on every pagination part in %s",
  async (flow) => {
    const c = await compileProject("examples/circuit-pagination");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const request = JSON.parse(
      await readFile("examples/circuit-pagination/packet.json", "utf8"),
    );
    for (const view of request.views) view.flow = flow;
    request.index = false;
    const before = JSON.stringify(c.ir);
    const r = await renderSchematicPacket(c.ir, request);
    if (!r.ok) throw Error(r.error.message);
    expect(r.value.sheets.length).toBeGreaterThan(1);
    for (const sheet of r.value.sheets) {
      const doc = parseHTML(sheet.svg).document;
      for (const owner of doc.querySelectorAll("[data-device-uid]")) {
        const uid = owner.getAttribute("data-device-uid")!;
        complete(c.ir, owner.outerHTML, [{ deviceUid: uid }]);
      }
    }
    expect(JSON.stringify(c.ir)).toBe(before);
  },
);

it.each(["standard", "compact"] as const)(
  "keeps the formerly printable letter-portrait functional circuit sweep in %s",
  async (layout) => {
    const c = await compileProject("examples/functional-symbols");
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      const request = JSON.parse(
        await readFile(
          `examples/functional-symbols/packet-${flow}.request.json`,
          "utf8",
        ),
      );
      const result = await renderSchematicPacket(c.ir, {
        ...request,
        layout,
        page: { size: "letter", orientation: "portrait" },
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) {
        const uid = c.ir.devices.find((d) => d.designation === "X1")!.uid;
        const sheet = result.value.sheets.find((s) =>
          s.references.some((r) => r.deviceUid === uid),
        )!;
        const doc = parseHTML(sheet.svg).document;
        const owner = doc.querySelector(`[data-device-uid="${uid}"]`)!;
        complete(c.ir, owner.outerHTML, [{ deviceUid: uid }]);
      }
    }
  },
);

it("retains device/field dimensions when communication partitioning cannot fit a complete link", async () => {
  const c = await compileProject("examples/operator-console");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const ir = {
    ...c.ir,
    devices: c.ir.devices.map((d) =>
      d.designation === "HMI1"
        ? { ...d, description: "Complete synthetic qualification ".repeat(500) }
        : d,
    ),
  };
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    views: [
      {
        format: "communication-view-request/0.1",
        medium: "ethernet",
        devices: ["HMI1"],
      },
    ],
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("R006");
    expect(result.error.message).toContain("HMI1");
    expect(result.error.message).toContain("description");
    expect(result.error.details).toHaveProperty("dimensions.availableHeightMm");
    expect(result.error.details).toHaveProperty("deviceTags");
  }
});

it("keeps shared-common functions on their specific conductors without losing identities or joining terminals", async () => {
  const { circuitConductorFunctions } =
    await import("../src/symbols/circuit-pagination-functions.js");
  const f = await breakerAuxiliaryFixture();
  try {
    const base = f.ir.functions[0]!;
    const pin = (terminalKey: string, deviceUid = "owner") => ({
      deviceUid,
      terminalKey,
    });
    const fn = (functionKey: string, terminals: string[]) => ({
      ...base,
      id: { deviceUid: "owner", functionKey },
      terminals: terminals.map((t) => pin(t)),
    });
    const functions = [
      fn("a", ["a", "common"]),
      fn("b", ["b", "common"]),
      fn("common", ["common"]),
    ];
    const conductors = ["a", "b", "common"].map((t) => ({
      ends: [pin(t), pin(t, "boundary")],
    }));
    const before = JSON.stringify({ functions, conductors });
    expect(
      conductors.map((c) =>
        circuitConductorFunctions(functions, conductors, c).map(
          (f) => f.id.functionKey,
        ),
      ),
    ).toEqual([["a"], ["b"], ["common"]]);
    expect(
      circuitConductorFunctions(functions, conductors, {
        ends: [pin("common", "foreign")],
      }),
    ).toEqual([]);
    const contact = [fn("contact", ["a", "b"])];
    for (const c of conductors.slice(0, 2))
      expect(circuitConductorFunctions(contact, conductors, c)).toEqual(
        contact,
      );
    expect(JSON.stringify({ functions, conductors })).toBe(before);
  } finally {
    await f.dispose();
  }
});
