import { beforeAll, afterAll, it, expect } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
import { fixture } from "./m3-fixture.mjs";
import { stripInkScript } from "./terminal-strip-ink.mjs";
import { wireLocatorAudit } from "./wire-locators.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const svg = (body) =>
  embedPrintableFont(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200" font-family="Thermite Sans, sans-serif">${body}</svg>`,
  );
const text = (x, y, value) =>
  `<text x="${x}" y="${y}" font-size="2.5">${value}</text>`;
function drawing(pin = false, hidden = false) {
  const grid =
    Array.from({ length: 6 }, (_, i) =>
      text(30 + i * 30, 12, String(i + 1)),
    ).join("") + [..."ABCD"].map((t, i) => text(10, 42 + i * 40, t)).join("");
  return svg(
    grid +
      `<g data-device-uid="a"${hidden ? ' display="none"' : ""}>${pin ? text(29, 50, "1: Native terminal") : '<circle data-terminal-key="1" cx="30" cy="50" r="1" fill="white" stroke="black"/>'}</g><g data-device-uid="b"><circle data-terminal-key="1" cx="90" cy="90" r="1" fill="white" stroke="black"/></g>`,
  );
}
function schedule(stacked, printed, to = "01.B3") {
  const labels = [
    "Conductor / label",
    "End A / first endpoint",
    "End B / second endpoint",
    "Color / size",
    "Assignment",
    "From sheet.zone",
    "To sheet.zone",
  ];
  function row(header) {
    const values = header
        ? labels
        : ["W1", "A.1", "B.1", "Blue", "Connected", printed, to],
      y = header ? 20 : 50;
    const boxes = values.map((_, i) => ({
      x: 20 + (stacked && i >= 5 ? i - 4 : i) * 35,
      y: y + (stacked && i >= 5 ? 10 : 0),
      w: 35,
      h: stacked && (i === 1 || i === 2 || i >= 5) ? 10 : 20,
    }));
    return `<g ${header ? "" : 'data-report-row="w"'}>${boxes.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="white" stroke="#9ba6b4"/>`).join("")}${values.map((v, i) => `<g data-report-column="${i + 1}">${text(boxes[i].x + 2, boxes[i].y + 5, v)}</g>`).join("")}</g>`;
  }
  return svg(`<g data-document-id="doc">${row(true)}${row(false)}</g>`);
}
function native() {
  const ir = fixture().ir;
  ir.devices = [
    { uid: "a", designation: "A", typeId: "t" },
    { uid: "b", designation: "B", typeId: "t" },
  ];
  ir.deviceTypes[0].terminals = [{ key: "1", description: "Native terminal" }];
  ir.wires = [
    {
      uid: "w",
      designation: "W1",
      endpoints: [
        { terminal: { deviceUid: "a", terminalKey: "1" } },
        { terminal: { deviceUid: "b", terminalKey: "1" } },
      ],
    },
  ];
  return ir;
}
const packet = {
  sheets: [
    { number: 1, view: { kind: "wiring", format: "documentation-view/0.1" } },
    { number: 2, view: { kind: "wires", format: "documentation-view/0.1" } },
  ],
};
it.each([false, true])(
  "compares actual ordinary/stacked printed values with native measured appearances (%s)",
  async (stacked) => {
    const g = await openSheet(page, drawing());
    for (const [printed, count] of [
      ["01.A1", 0],
      ["not drawn", 1],
      ["02.A1", 1],
      ["01.D6", 1],
    ]) {
      const report = await openSheet(page, schedule(stacked, printed));
      expect(
        wireLocatorAudit(packet, [g, report], native()).findings,
      ).toHaveLength(count);
    }
  },
);
it("measures a terminal painted only as native pin-list text and ignores hidden ink", async () => {
  const report = await openSheet(page, schedule(false, "01.A1"));
  expect(
    wireLocatorAudit(
      packet,
      [await openSheet(page, drawing(true)), report],
      native(),
    ).findings,
  ).toEqual([]);
  expect(
    wireLocatorAudit(
      packet,
      [await openSheet(page, drawing(true, true)), report],
      native(),
    ).findings[0].kind,
  ).toBe("wire-locator-without-appearance");
  expect(
    wireLocatorAudit(
      packet,
      [await openSheet(page, drawing(false, true)), report],
      native(),
    ).findings[0].kind,
  ).toBe("wire-locator-without-appearance");
});

it.each([false, true])(
  "clipped native marker or pin text supplies no appearance (%s)",
  async (pin) => {
    const source = drawing(pin).replace(
      '<g data-device-uid="a">',
      '<defs><clipPath id="cut"><rect x="0" y="0" width="1" height="1"/></clipPath></defs><g data-device-uid="a" clip-path="url(#cut)">',
    );
    expect(source).toContain('clip-path="url(#cut)"');
    const report = await openSheet(page, schedule(false, "01.A1"));
    expect(
      wireLocatorAudit(
        packet,
        [await openSheet(page, source), report],
        native(),
      ).findings[0].kind,
    ).toBe("wire-locator-without-appearance");
  },
);

it.each([false, true])(
  "connects measured locator failures and native data gaps to the DQ-19 sheet verdict (%s)",
  async (missingNative) => {
    const { evaluateSheet } = await import("./evaluate.mjs");
    const ir = native();
    Object.assign(ir, { functions: [], nets: [] });
    const p = structuredClone(packet);
    for (const s of p.sheets)
      Object.assign(s, { references: [], continuations: [] });
    const source = await openSheet(page, drawing()),
      report = await openSheet(page, schedule(false, "not drawn"));
    const table = {
      kind: "wires",
      documentId: "doc",
      columns: [
        "Conductor / label",
        "End A / first endpoint",
        "End B / second endpoint",
        "Color / size",
        "Assignment",
        "From sheet.zone",
        "To sheet.zone",
      ],
      rows: [
        {
          key: "w",
          cells: ["W1", "A.1", "B.1", "Blue", "Connected", "01.A1", "01.B3"],
        },
      ],
    };
    if (missingNative) delete ir.wires[0].endpoints;
    const results = evaluateSheet(
      { id: "native-locator", flow: "left-to-right" },
      p.sheets[1],
      p,
      report,
      ir,
      [],
      [],
      [],
      [table],
      [source, report],
      missingNative ? undefined : { views: [] },
    );
    expect(
      results
        .filter((r) => r.dq === "DQ-19")
        .flatMap((r) => r.evidence.findings)
        .some(
          (f) =>
            f.kind ===
            (missingNative
              ? "wire-locator-measurement-gap"
              : "wire-locator-undrawn-claim"),
        ),
    ).toBe(true);
  },
);

it("D1b wrong pin description supplies no appearance despite the native key prefix", async () => {
  const source = drawing(true).replace(
    "1: Native terminal",
    "1: Foreign terminal",
  );
  const result = wireLocatorAudit(
    packet,
    [
      await openSheet(page, source),
      await openSheet(page, schedule(false, "01.A1")),
    ],
    native(),
  );
  expect(result.findings[0].kind).toBe("wire-locator-without-appearance");
});
it("D1b cable circles are matched by nearby painted endpoint identities after DOM reordering", async () => {
  const ir = native();
  ir.wires = [];
  ir.cables = [
    {
      uid: "c",
      designation: "C",
      typeId: "core",
      assignments: [
        {
          id: "1",
          endpoints: [
            { terminal: { deviceUid: "a", terminalKey: "1" } },
            { terminal: { deviceUid: "b", terminalKey: "1" } },
          ],
        },
      ],
    },
  ];
  ir.cableTypes = [{ id: "core", conductors: [{ id: "1" }] }];
  const source = drawing().replace(
    /<g data-device-uid="a">[\s\S]*?<\/g><g data-device-uid="b">[\s\S]*?<\/g>/,
    `<g data-cable-uid="c" data-conductor-id="1">${text(29, 45, "A.1")}${text(89, 85, "B.1")}<circle cx="90" cy="90" r="1" fill="white" stroke="black"/><circle cx="30" cy="50" r="1" fill="white" stroke="black"/></g>`,
  );
  const report = await openSheet(
    page,
    schedule(false, "01.A1").replace(
      'data-report-row="w"',
      'data-report-row="[&quot;c&quot;,&quot;1&quot;]"',
    ),
  );
  expect(
    wireLocatorAudit(packet, [await openSheet(page, source), report], ir)
      .findings,
  ).toEqual([]);
  const wrong = await openSheet(page, source.replace("A.1", "FOREIGN.1"));
  expect(wireLocatorAudit(packet, [wrong, report], ir).findings[0].kind).toBe(
    "wire-locator-without-appearance",
  );
});

const stripSource = (stub, rect = true) =>
  drawing()
    .replace(/<g data-device-uid="[^"]+">.*?<\/g>/gu, "")
    .replace(
      "</svg>",
      `<g data-sheet-kind="terminal-strip"><g data-terminal-strip="a">
     ${text(50, 29, "A — authored order")}
     <g data-strip-terminal="[&quot;a&quot;,&quot;1&quot;]">
      ${rect ? '<rect x="54" y="40" width="12" height="8" fill="white" stroke="black"/>' : ""}
      ${text(56, 44, "1")}
     </g>
     ${stub}
    </g></g></svg>`,
    )
    .replace("<svg ", '<svg data-sheet="3" ');
const validStub = `<g data-strip-incidence="w" data-strip-at="[&quot;a&quot;,&quot;1&quot;]">
  <path d="M66 44 H78" fill="none" stroke="black"/>${text(80, 44, "W1 → B.1")}
</g>`;
const stripPacket = {
  sheets: [...packet.sheets, { number: 3, view: { kind: "terminal-strip" } }],
};
async function auditStripCells(
  printed,
  markup,
  {
    diagram = false,
    rect = true,
    renameRow = false,
    ir = native(),
    mutateStrip = (source) => source,
    to,
  } = {},
) {
  const schematic = await openSheet(
    page,
    diagram ? drawing() : drawing(false, true),
  );
  const reportSvg = schedule(false, printed, to);
  const report = await openSheet(
    page,
    renameRow
      ? reportSvg.replace('data-report-row="w"', 'data-report-row="invented"')
      : reportSvg,
  );
  const strip = await openSheet(page, mutateStrip(stripSource(markup, rect)));
  strip.terminalStripInk = await page.evaluate(stripInkScript);
  if (ir.wires.length)
    ir.wires.push({ ...ir.wires[0], uid: "decoy", designation: "W2" });
  return wireLocatorAudit(stripPacket, [schematic, report, strip], ir);
}

it.each([
  ["03.A2", null],
  ["not drawn", "wire-locator-undrawn-claim"],
  ["04.A2", "wire-locator-mismatch"],
  ["03.B2", "wire-locator-mismatch"],
])(
  "reconciles a measured strip-only landing with printed %s",
  async (printed, kind) => {
    const result = await auditStripCells(printed, validStub);
    expect(result.findings.map((f) => f.kind)).toEqual(kind ? [kind] : []);
    const endpoint = result.measurements.find((entry) => entry.end === 0);
    expect(endpoint.allowed).toEqual(["03.A2"]);
  },
);

it.each([
  [
    "wrong conductor",
    validStub.replace(
      'data-strip-incidence="w"',
      'data-strip-incidence="decoy"',
    ),
    true,
  ],
  [
    "wrong terminal key",
    validStub.replace("&quot;1&quot;", "&quot;2&quot;"),
    true,
  ],
  ["wrong path", validStub.replace("M66 44 H78", "M66 54 H78"), true],
  ["hidden path", validStub.replace("<path", '<path opacity="0"'), true],
  [
    "clipped path",
    validStub.replace(
      "<path",
      '<clipPath id="cut"><rect width="1" height="1"/></clipPath><path clip-path="url(#cut)"',
    ),
    true,
  ],
  ["wrong caption", validStub.replace("W1 → B.1", "W10 → B.1"), true],
  ["missing stub", validStub.replace(/<path[^>]+\/>/, ""), true],
  [
    "definition-only path",
    validStub.replace(/<path[^>]+\/>/, (path) => `<defs>${path}</defs>`),
    true,
  ],
  [
    "nested viewport hides the path",
    validStub.replace(
      /<path[^>]+\/>/,
      (path) => `<svg width="1" height="1">${path}</svg>`,
    ),
    true,
  ],
  ["no terminal body", validStub, false],
  [
    "caption only inside the body",
    validStub.replace("M66 44 H78", "M59 44 H64"),
    true,
  ],
])("rejects a strip pointer with %s", async (_, stub, rect) => {
  expect(
    (await auditStripCells("03.A2", stub, { rect })).findings.map(
      (f) => f.kind,
    ),
  ).toEqual(["wire-locator-without-appearance"]);
});

it("keeps a real schematic landing, and rejects a mislabeled inventory row", async () => {
  expect(
    (await auditStripCells("01.A1", validStub, { diagram: true })).findings,
  ).toEqual([]);
  expect(
    (
      await auditStripCells("03.A2", validStub, { renameRow: true })
    ).findings.map((f) => f.kind),
  ).toEqual(["wire-locator-measurement-gap"]);
});

it.each([
  ["JP1", "JP1"],
  [undefined, "Jumper"],
])(
  "uses the native jumper designation (authored %s)",
  async (designation, caption) => {
    const ir = native();
    ir.jumpers = [{ ...ir.wires[0], designation }];
    ir.wires = [];
    const markup = validStub.replace("W1 → B.1", `${caption} → B.1`);
    expect((await auditStripCells("03.A2", markup, { ir })).findings).toEqual(
      [],
    );
    expect(
      (await auditStripCells("not drawn", markup, { ir })).findings.map(
        (f) => f.kind,
      ),
    ).toEqual(["wire-locator-undrawn-claim"]);
  },
);

it.each([
  [
    "misprinted heading",
    (source) => source.replace("A — authored order", "TX — authored order"),
  ],
  [
    "clipped caption",
    (source) =>
      source
        .replace(
          "<g data-sheet-kind=",
          '<defs><clipPath id="cut"><rect width="1" height="1"/></clipPath></defs><g data-sheet-kind=',
        )
        .replace(
          text(56, 44, "1"),
          text(56, 44, "1").replace("<text", '<text clip-path="url(#cut)"'),
        ),
  ],
  [
    "hidden caption",
    (source) =>
      source.replace(
        text(56, 44, "1"),
        text(56, 44, "1").replace("<text", '<text opacity="0"'),
      ),
  ],
])(
  "rejects not drawn with an uncorroborated strip identity: %s",
  async (_, mutateStrip) => {
    const audit = await auditStripCells("not drawn", validStub, {
      mutateStrip,
    });
    expect(audit.findings).toMatchObject([
      {
        kind: "wire-locator-strip-identity-unmeasurable",
        row: "w",
        end: 0,
        endpoint: { deviceUid: "a", terminalKey: "1" },
        stripIdentityGaps: [{ sheet: 3 }],
      },
    ]);
  },
);

it("rejects a generic schematic marker on a strip sheet without the conductor's approach", async () => {
  const marker =
    '<g data-device-uid="a"><circle data-terminal-key="1" cx="60" cy="44" r="1" fill="white" stroke="black"/></g>';
  expect((await auditStripCells("03.A2", marker)).findings).toMatchObject([
    { kind: "wire-locator-without-appearance", row: "w", end: 0 },
  ]);
});

it("rejects a destination when six grid labels do not form the printed sequence", async () => {
  const mutateStrip = (source) =>
    source.replace(text(180, 12, "6"), text(180, 12, "5"));
  expect(
    (await auditStripCells("03.A2", validStub, { mutateStrip })).findings,
  ).toMatchObject([
    { kind: "wire-locator-without-appearance", row: "w", end: 0 },
  ]);
});

it("binds a local jumper by its own bridge endpoints and printed captions", async () => {
  const ir = native();
  ir.deviceTypes[0].terminals.push({ key: "2" });
  ir.jumpers = [
    {
      uid: "w",
      designation: "J1",
      endpoints: ["1", "2"].map((terminalKey) => ({
        terminal: { deviceUid: "a", terminalKey },
      })),
    },
  ];
  ir.wires = [];
  const bridge = `
    <g data-strip-terminal="[&quot;a&quot;,&quot;2&quot;]">
      <rect x="54" y="80" width="12" height="8" fill="white" stroke="black"/>
      ${text(56, 84, "2")}
    </g>
    <g data-strip-jumper="w"><path d="M66 44 H80 V84 H66" fill="none" stroke="black"/></g>
    <g data-strip-bridge-label="w" data-strip-at="[&quot;a&quot;,&quot;1&quot;]">${text(80, 44, "B1 J1 → A.2")}</g>
    <g data-strip-bridge-label="w" data-strip-at="[&quot;a&quot;,&quot;2&quot;]">${text(80, 84, "B1 J1 → A.1")}</g>`;
  const options = { ir, to: "03.B2" };
  expect((await auditStripCells("03.A2", bridge, options)).findings).toEqual(
    [],
  );
  for (const invalid of [
    bridge.replace("B1 J1 → A.2", "B1 J1 → A.9"),
    bridge.replace("M66 44 H80", "M70 44 H80"),
  ]) {
    expect(
      (await auditStripCells("03.A2", invalid, options)).findings,
    ).toMatchObject([
      { kind: "wire-locator-without-appearance", row: "w", end: 0 },
    ]);
  }
});
