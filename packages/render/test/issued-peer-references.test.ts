import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";
import { expect, it } from "vitest";
import { renderSchematicPacket } from "../src/sheets.js";
import type { SchematicPacketRequest } from "../src/packet/types.js";
import { parseSvg } from "./off-view-fixtures.js";
import { createTerminalIr } from "../../query/test/fixtures.js";

import { conveyorRequest } from "./packet-navigation-review-fixture.js";
import { repeatRequest } from "./wire-column-search-fixture.js";

it.each([
  {
    project: "conveyor-line",
    request: conveyorRequest(),
    pages: 20,
    token: "→ CB2.5/L3 04.D3",
  },
  {
    project: "machine-demo",
    request: repeatRequest("left-to-right"),
    pages: 37,
    token: "→ CB1.3/L2 02.B4",
  },
])(
  "retains the issued Letter portrait $project packet with peer notes",
  async ({ project, request, pages, token }) => {
    const c = await compileProject(`examples/${project}`);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const r = await renderSchematicPacket(
      c.ir,
      {
        ...request,
        layout: "standard",
        page: { size: "letter", orientation: "portrait" },
      },
      c.presentation,
    );
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.sheets).toHaveLength(pages);
    const notes = r.value.sheets.flatMap((sheet) =>
      Array.from(
        parseSvg(sheet.svg).querySelectorAll("[data-peer-reference]"),
        (t) => t.textContent,
      ),
    );
    expect(notes.some((note) => note?.endsWith(token))).toBe(true);
  },
);

async function example(name: string, file = "packet.json") {
  const root = `examples/${name}`;
  const source = await compileProject(root);
  if (!source.ok) throw Error(JSON.stringify(source.diagnostics));
  const request: SchematicPacketRequest = JSON.parse(
    await readFile(`${root}/${file}`, "utf8"),
  );
  return async (change = (value: SchematicPacketRequest) => value) => {
    const output = await renderSchematicPacket(
      source.ir,
      change(request),
      source.presentation,
    );
    if (!output.ok) throw Error(JSON.stringify(output.error));
    return output.value.sheets.map((sheet) => ({
      ...sheet,
      document: parseSvg(sheet.svg),
    }));
  };
}

it("points to the actual selected attachment and its reciprocal port (#397)", async () => {
  const render = await example("topology-coverage");
  const sheets = await render();
  const refs = (sheet: number) =>
    [
      ...sheets[sheet - 1]!.document.querySelectorAll(
        '[data-peer-reference="attachment"]',
      ),
    ].map((el) => el.textContent?.trim());
  expect(refs(1)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^R1\.X2 · CAP-X2 → 02\.[A-D][1-6]$/u),
      expect.stringMatching(/^R1\.X4 · W2 → 03\.[A-D][1-6]$/u),
    ]),
  );
  expect(refs(2)).toContainEqual(
    expect.stringMatching(/^R1\.X2 · CAP-X2 → 01\./u),
  );
  expect(refs(4)).toContainEqual(expect.stringMatching(/^Y1\.IN · W2 → 03\./u));
  expect(refs(3)).toContainEqual(expect.stringMatching(/^Y1\.IN · W2 → 04\./u));
});

it.each(["left-to-right", "top-to-bottom"] as const)(
  "prints reciprocal conductor endpoints in the rooted packet (%s, #397)",
  async (flow) => {
    const source = await compileProject("examples/motor-starter");
    if (!source.ok) throw Error(JSON.stringify(source.diagnostics));
    const request: SchematicPacketRequest = JSON.parse(
      await readFile("examples/alpha/motor-starter.packet.json", "utf8"),
    );
    const result = await renderSchematicPacket(
      source.ir,
      { ...request, views: request.views.map((v) => ({ ...v, flow })) },
      source.presentation,
    );
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const notes = result.value.sheets.flatMap((sheet) =>
      [
        ...parseSvg(sheet.svg).querySelectorAll(
          '[data-peer-reference="conductor-peer"]',
        ),
      ].map((n) => n.textContent),
    );
    expect(notes).toContainEqual(
      expect.stringMatching(/^W-CTL-004 · PS1\.- → TB1\.4 \d+\.[A-D][1-6]$/u),
    );
    expect(notes).toContainEqual(
      expect.stringMatching(/^W-CTL-004 · TB1\.4 → PS1\.- \d+\.[A-D][1-6]$/u),
    );
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "links a cable card with the painted circuit boundary terminal in %s (#397)",
  async (flow) => {
    const render = await example(
      "motor-starter",
      "../alpha/motor-starter-documentation.packet.json",
    );
    const sheets = await render((request) => ({
      ...request,
      views: request.views.map((view) =>
        view.format === "schematic-view-request/0.1" ||
        view.format === "circuit-view-request/0.1"
          ? { ...view, flow }
          : view,
      ),
    }));
    const circuit = sheets.find((sheet) => sheet.view.kind === "circuit");
    const cable = sheets.find(
      (sheet) => "intent" in sheet.view && sheet.view.intent === "conductors",
    );
    expect(circuit).toBeDefined();
    expect(cable).toBeDefined();
    const notes = (sheet: typeof circuit) =>
      [
        ...sheet!.document.querySelectorAll(
          '[data-peer-reference="conductor-peer"]',
        ),
      ].map((entry) => entry.textContent);
    expect(notes(circuit)).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^W-CTL-004 · PS1\\.- → TB1\\.4 ${String(cable!.number).padStart(2, "0")}\\.[A-D][1-6]$`,
          "u",
        ),
      ),
    );
    expect(notes(cable)).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^W-CTL-004 · TB1\\.4 → PS1\\.- ${String(circuit!.number).padStart(2, "0")}\\.[A-D][1-6]$`,
          "u",
        ),
      ),
    );
  },
);

it("uses counterpart relay terminals in wiring views (#397)", async () => {
  const render = await example("operator-console", "packet.request.json");
  const sheets = await render();
  const notes = (n: number) =>
    [
      ...sheets[n - 1]!.document.querySelectorAll(
        '[data-peer-reference="terminal-interface"]',
      ),
    ].map((el) => el.textContent);
  expect(notes(5)).toContainEqual(
    expect.stringMatching(
      /^K-R · coil terminal A1 → contact terminal 14 07\./u,
    ),
  );
  expect(notes(7)).toContainEqual(
    expect.stringMatching(
      /^K-R · contact terminal 14 → coil terminal A1 05\./u,
    ),
  );
});

it("points an undrawn assembly at its exact issued inventory row (#429)", async () => {
  const render = await example("cap-pagination");
  const sheets = await render();
  const note = [
    ...sheets[1]!.document.querySelectorAll(
      '[data-peer-reference="assembly-inventory"]',
    ),
  ].find((el) => el.textContent?.includes("R1.X09"));
  expect(note?.textContent).toMatch(/^R1\.X09 · CBL1 inventory → 04\.D3$/u);
  expect(
    sheets[1]!.document.querySelector('[data-connector-port="X09"]')
      ?.textContent,
  ).toContain("outside view");
});

it("prints the matching inventory sheet alongside every strip row key (#431)", async () => {
  const render = await example("operator-console", "packet.request.json");
  const sheets = await render();
  const inventories = sheets.filter(
    (s) =>
      s.view.kind === "terminals" && s.view.title === "XT-HMI terminal plan",
  );
  expect(inventories).toHaveLength(2);
  const strips = sheets.filter((s) => s.view.kind === "terminal-strip");
  expect(strips).toHaveLength(2);
  const referenced = new Set<number>();
  for (const sheet of strips) {
    const terminals = [
      ...sheet.document.querySelectorAll("[data-strip-terminal]"),
    ];
    expect(terminals.length).toBeGreaterThan(0);
    for (const terminal of terminals) {
      const key = terminal.getAttribute("data-strip-terminal");
      const ref = terminal.getAttribute("data-strip-ref");
      const target = inventories.find((s) =>
        [...s.document.querySelectorAll("[data-strip-row]")].some(
          (el) =>
            el.getAttribute("data-strip-row") === key && el.textContent === ref,
        ),
      );
      expect(target).toBeDefined();
      const token = `S${String(target!.number).padStart(2, "0")}`;
      expect(
        terminal.querySelector("[data-strip-inventory]")?.textContent,
      ).toBe(token);
      referenced.add(target!.number);
    }
  }
  expect([...referenced]).toEqual(inventories.map((s) => s.number));
});

it("fits a long inventory key and its sheet locator at 2.5 mm (#431)", async () => {
  const keys = Array.from({ length: 105 }, (_, i) => String(i + 1));
  const ir = createTerminalIr(
    Array.from({ length: 10 }, (_, i) => ({
      uid: `strip-${i}`,
      designation: `XT${String(i + 1).padStart(2, "0")}`,
      terminalKeys: i === 9 ? keys : ["1"],
    })),
  );
  const type = ir.deviceTypes[0]!;
  type.category = "terminal-strip";
  type.terminals = [{ key: "1", source: type.source }];
  type.terminalOrder = ["1"];
  ir.deviceTypes.push({
    ...type,
    id: "type:wide-strip",
    terminals: keys.map((key) => ({ key, source: type.source })),
    terminalOrder: keys,
  });
  ir.devices[9]!.typeId = "type:wide-strip";
  const result = await renderSchematicPacket(ir, {
    format: "schematic-packet-request/0.1",
    page: { size: "tabloid", orientation: "landscape" },
    index: false,
    views: [{ format: "documentation-view-request/0.1", kind: "terminals" }],
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const key = "T10/R100";
  const inventory = result.value.sheets.find((sheet) =>
    [...parseSvg(sheet.svg).querySelectorAll("[data-strip-row]")].some(
      (t) => t.textContent === key,
    ),
  );
  const body = result.value.sheets
    .map((sheet) =>
      parseSvg(sheet.svg).querySelector(
        `[data-strip-ref="${key}"][data-strip-terminal]`,
      ),
    )
    .find((value) => value);
  expect(result.value.sheets).toHaveLength(9);
  expect(inventory).toBeDefined();
  expect(body).toBeDefined();
  const labels = Array.from(body!.querySelectorAll("text"));
  expect(labels.map((label) => label.textContent)).toEqual([
    "100",
    key,
    `S${String(inventory!.number).padStart(2, "0")}`,
  ]);
  expect(labels.map((label) => label.getAttribute("font-size"))).toEqual([
    "2.5",
    "2.5",
    "2.5",
  ]);
  expect(new Set(labels.map((label) => label.getAttribute("y"))).size).toBe(3);
});

it("only names device and function references after they are issued (#434)", async () => {
  const render = await example("self-loop-labels");
  for (const change of [
    (r: SchematicPacketRequest) => ({ ...r, index: false }),
    (r: SchematicPacketRequest) => ({
      ...r,
      index: true,
      references: false as const,
    }),
    (r: SchematicPacketRequest) => ({ ...r, index: true }),
  ]) {
    const sheets = await render(change);
    const target = sheets.find((s) => s.view.kind === "references");
    for (const sheet of sheets.filter((s) => s.view.kind === "circuit")) {
      const ink = [...sheet.document.querySelectorAll("text")]
        .map((t) => t.textContent)
        .join(" ");
      expect(ink).toContain(
        "Source-selected circuits · [+N]: connections outside group",
      );
      expect(ink).not.toContain("device/function references in index");
      if (target) {
        expect(ink).toContain(
          `Device and function references S${String(target.number).padStart(2, "0")}`,
        );
      } else expect(ink).not.toContain("Device and function references");
    }
  }
});
