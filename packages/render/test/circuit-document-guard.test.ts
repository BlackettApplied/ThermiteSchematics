import { expect, it } from "vitest";
import type { RenderedPacket } from "../src/packet/types.js";
import { circuitPacketGuard } from "../src/layout/circuit-packet-guard.js";

function packet(companionSheet = 3): RenderedPacket {
  const fact = {
    kind: "port-link-status" as const,
    deviceUid: "device-n01",
    portKey: "B1",
  };
  const row = {
    id: "inventory/row/b1",
    nativeKey: "port/b1",
    displayName: "N01: B1",
    facts: [fact],
    columns: ["identity", "status"] as const,
    primitiveId: `sheet-${companionSheet}-row-b1`,
    sheet: companionSheet,
    zone: "A1",
    rectMm: { x: 10, y: 30, w: 80, h: 10 },
    anchorMm: { x: 50, y: 35 },
    anchorRule: "row-region-center/1" as const,
  };
  const identity = {
    snapshotDigest: "native-source",
    presentationDigest: "presentation",
    revision: "UNSPECIFIED",
  };
  const sheet = (number: number, svg: string) => ({
    number,
    view: {
      format: "documentation-view/0.1" as const,
      kind: "circuit" as const,
      title: "Circuit",
    },
    svg: svg
      .replace(
        "<svg>",
        `<svg aria-label="Circuit, sheet ${number} of ${companionSheet}" data-sheet="${number}" data-total-sheets="${companionSheet}"><title>Circuit - Sheet ${number} of ${companionSheet}</title><text x="406" y="15" font-size="2.6" text-anchor="end">SHEET ${String(number).padStart(2, "0")} / ${String(companionSheet).padStart(2, "0")}</text>`,
      )
      .replace(
        "</svg>",
        `<text x="348" y="284.5" font-size="2.4">SHEET ${number} OF ${companionSheet}</text></svg>`,
      ),
    references: [],
    continuations: [],
  });
  return {
    format: "schematic-packet/0.1",
    page: {
      size: "a3",
      orientation: "landscape",
      widthMm: 420,
      heightMm: 297,
      marginMm: 10,
    },
    sheets: [
      sheet(
        1,
        `<svg><g data-navigation-view="view"/><g id="caption-ink" data-document-dependency="dependency" data-document-note-id="note" data-document-caption-form="identities"><text x="11" y="103" font-size="2.5">Ports: network inventory ${String(companionSheet).padStart(2, "0")}.A1 (N01: B1).</text></g></svg>`,
      ),
      ...Array.from({ length: companionSheet - 2 }, (_, i) =>
        sheet(i + 2, '<svg><g data-navigation-view="view"/></svg>'),
      ),
      {
        ...sheet(
          companionSheet,
          `<svg><g data-document-id="inventory" data-document-origin="auto"><text x="10" y="20" font-size="2.5">network inventory</text><g id="sheet-${companionSheet}-row-b1" data-report-row="port/b1"><text x="10" y="35" font-size="2.5">N01: B1</text><text x="60" y="35" font-size="2.5">unconnected</text><text x="10" y="50" font-size="2.5">Authored 04.A1</text></g></g></svg>`,
        ),
        view: {
          format: "documentation-view/0.1",
          kind: "network",
          title: "Network",
        },
      },
    ],
    html: "",
    coverage: {} as RenderedPacket["coverage"],
    navigation: {
      format: "issued-navigation/0.1",
      snapshotDigest: "native-source",
      anchorRule: "function-terminal-centroid/2",
      quantumMm: 0.01,
      rounding: "decimal-half-up/1",
      seeds: [],
      measurementGaps: [],
      occurrences: [],
      canonicalGroups: [],
      pageRegions: [],
      reservations: [],
      annotations: [],
      documentFormat: "issued-documents/1",
      documents: [
        {
          ...identity,
          id: "inventory",
          kind: "network",
          label: "network inventory",
          autoOrigin: { dependencyIds: ["dependency"] },
          rows: [row],
        },
      ],
      dependencies: [
        {
          ...identity,
          id: "dependency",
          noteId: "note",
          need: "port-link-status",
          requiredFacts: [fact],
          requiredColumns: ["identity", "status"],
          subject: "Ports",
          owner: { viewKey: "view", noteId: "note", sheet: 1 },
          resolution: [{ documentId: "inventory", rows: [row.id] }],
          caption: {
            text: `Ports: network inventory ${String(companionSheet).padStart(2, "0")}.A1 (N01: B1).`,
            primitiveId: "caption-ink",
            rectMm: { x: 10, y: 100, w: 100, h: 6 },
            form: "identities",
          },
        },
      ],
      autoDocuments: [
        {
          documentId: "inventory",
          dependencyIds: ["dependency"],
          sheets: [companionSheet],
        },
      ],
    },
  };
}

it("allows removal before a companion with consistent page renumbering", () => {
  const before = packet(4),
    after = packet(3);
  const bytes = JSON.stringify([before, after]);
  expect(circuitPacketGuard(after, before)).toBe(true);
  expect(JSON.stringify([before, after])).toBe(bytes);
  expect(circuitPacketGuard(before, structuredClone(before))).toBe(true);
});

it.each([
  ["dependency", (p: RenderedPacket) => (p.navigation!.dependencies = [])],
  ["document", (p: RenderedPacket) => (p.navigation!.documents = [])],
  ["auto origin", (p: RenderedPacket) => (p.navigation!.autoDocuments = [])],
  [
    "resolution",
    (p: RenderedPacket) => (p.navigation!.dependencies![0]!.resolution = []),
  ],
  [
    "native row",
    (p: RenderedPacket) => (p.navigation!.documents![0]!.rows = []),
  ],
  [
    "caption metadata",
    (p: RenderedPacket) => delete p.navigation!.dependencies![0]!.caption,
  ],
  [
    "source fact",
    (p: RenderedPacket) => (p.navigation!.dependencies![0]!.requiredFacts = []),
  ],
] as const)("conserves %s metadata in both directions", (_, change) => {
  const before = packet(),
    after = structuredClone(before);
  change(after);
  expect(circuitPacketGuard(after, before)).toBe(false);
  expect(circuitPacketGuard(before, after)).toBe(false);
});

it.each([
  ["caption text", "(N01: B1)", "(N01: B2)"],
  ["caption primitive", 'id="caption-ink"', 'id="wrong-ink"'],
  [
    "caption owner",
    'data-document-note-id="note"',
    'data-document-note-id="other"',
  ],
  ["caption position", 'y="103"', 'y="203"'],
  [
    "caption visibility",
    '<g id="caption-ink"',
    '<g opacity="0" id="caption-ink"',
  ],
  [
    "caption transform",
    '<g id="caption-ink"',
    '<g transform="translate(0 10)" id="caption-ink"',
  ],
  ["caption size", 'font-size="2.5"', 'font-size="1.5"'],
] as const)("conserves painted %s independently of metadata", (_, from, to) => {
  const before = packet(),
    after = structuredClone(before);
  after.sheets[0]!.svg = after.sheets[0]!.svg.replace(from, to);
  expect(circuitPacketGuard(after, before)).toBe(false);
  expect(circuitPacketGuard(before, after)).toBe(false);
});

it("rejects changed companion ink and a removed page despite surviving metadata", () => {
  const before = packet(),
    after = structuredClone(before);
  after.sheets[2]!.svg = after.sheets[2]!.svg.replace(
    "unconnected",
    "connected",
  );
  expect(circuitPacketGuard(after, before)).toBe(false);
  const missing = structuredClone(before);
  missing.sheets.splice(2, 1);
  expect(circuitPacketGuard(missing, before)).toBe(false);
});

it("rejects disappearing caption ink and inherited styles that hide it", () => {
  const before = packet(),
    after = structuredClone(before);
  after.sheets[0]!.svg = '<svg><g data-navigation-view="view"/></svg>';
  expect(circuitPacketGuard(after, before)).toBe(false);
  const hidden = structuredClone(before);
  hidden.sheets[0]!.svg = hidden.sheets[0]!.svg.replace(
    "<svg ",
    '<svg visibility="hidden" ',
  );
  expect(circuitPacketGuard(hidden, before)).toBe(false);
});

it("rejects a displaced caption even when its metadata follows the displacement", () => {
  const before = packet(),
    after = structuredClone(before);
  after.sheets[0]!.svg = after.sheets[0]!.svg.replace('y="103"', 'y="113"');
  after.navigation!.dependencies![0]!.caption!.rectMm.y += 10;
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it("conserves owning-view placement independently of the caption rectangle", () => {
  const before = packet(),
    after = structuredClone(before);
  after.sheets[0]!.svg = after.sheets[0]!.svg.replace(
    'data-navigation-view="view"',
    'data-navigation-view="view" transform="translate(0 10)"',
  );
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it("conserves reused authored row ink without requiring an automatic page", () => {
  const before = packet();
  delete before.navigation!.documents![0]!.autoOrigin;
  before.navigation!.autoDocuments = [];
  before.sheets[2]!.svg = before.sheets[2]!.svg.replace(
    'data-document-origin="auto"',
    'data-document-origin="authored"',
  );
  const after = structuredClone(before);
  after.sheets[2]!.svg = after.sheets[2]!.svg.replace(
    "unconnected",
    "connected",
  );
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it("conserves the complete companion page, including its printed header", () => {
  const before = packet(),
    after = structuredClone(before);
  after.sheets[2]!.svg = after.sheets[2]!.svg.replace(
    ">network inventory<",
    ">wire inventory<",
  );
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it("leaves unrelated requested reports to RT2a's existing pagination policy", () => {
  const before = packet();
  before.navigation!.dependencies = [];
  before.navigation!.autoDocuments = [];
  delete before.navigation!.documents![0]!.autoOrigin;
  before.sheets[0]!.svg = '<svg><g data-navigation-view="view"/></svg>';
  before.sheets[2]!.svg = before.sheets[2]!.svg.replace(
    'data-document-origin="auto"',
    'data-document-origin="authored"',
  );
  const after = structuredClone(before);
  after.navigation!.documents![0]!.rows[0]!.sheet = 4;
  expect(circuitPacketGuard(after, before)).toBe(true);
});

it("rejects unregistered companion paint replacing a circuit page", () => {
  const before = packet(),
    after = structuredClone(before);
  after.sheets[1]!.svg =
    '<svg><g data-document-origin="auto" data-document-id="unregistered"><text font-size="2.5" x="10" y="30">Extra inventory</text></g></svg>';
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it("rejects added unregistered rows inside a reused authored inventory", () => {
  const before = packet();
  delete before.navigation!.documents![0]!.autoOrigin;
  before.navigation!.autoDocuments = [];
  before.sheets[2]!.svg = before.sheets[2]!.svg.replace(
    'data-document-origin="auto"',
    'data-document-origin="authored"',
  );
  const after = structuredClone(before);
  after.sheets[2]!.svg = after.sheets[2]!.svg.replace(
    "</g></g>",
    '</g><g data-report-row="extra"><text font-size="2.5" x="10" y="50">N01: B2</text></g></g>',
  );
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it("conserves companion page ink outside the inventory wrapper", () => {
  const before = packet();
  before.sheets[2]!.svg = before.sheets[2]!.svg.replace(
    "</svg>",
    '<text font-size="2.5" x="10" y="260">Sheet 3</text></svg>',
  );
  const after = structuredClone(before);
  after.sheets[2]!.svg = after.sheets[2]!.svg.replace("Sheet 3", "Sheet 9");
  expect(circuitPacketGuard(after, before)).toBe(false);
});

it.each([
  "origin",
  "caption metadata",
  "caption paint",
  "zone",
  "row content",
  "authored text",
] as const)("rejects inconsistent renumbering or altered %s", (change) => {
  const before = packet(4),
    after = packet(3);
  if (change === "origin") after.navigation!.autoDocuments![0]!.sheets = [4];
  if (change === "caption metadata")
    after.navigation!.dependencies![0]!.caption!.text =
      "Ports: network inventory 04.A1 (N01: B1).";
  if (change === "caption paint")
    after.sheets[0]!.svg = after.sheets[0]!.svg.replace("03.A1", "04.A1");
  if (change === "zone") after.navigation!.documents![0]!.rows[0]!.zone = "A2";
  if (change === "row content")
    after.sheets[2]!.svg = after.sheets[2]!.svg.replace("N01: B1", "N01: B2");
  if (change === "authored text")
    after.sheets[2]!.svg = after.sheets[2]!.svg.replace(
      "Authored 04.A1",
      "Authored 03.A1",
    );
  expect(circuitPacketGuard(after, before)).toBe(false);
});

function twoPageInventory(first: number, last: number) {
  const p = packet(first),
    base = p.sheets.at(-1)!;
  const second = structuredClone(base);
  second.number = last;
  second.svg = second.svg
    .replaceAll(`sheet-${first}-`, `sheet-${last}-`)
    .replace('data-report-row="port/b1"', 'data-report-row="port/b2"')
    .replace("N01: B1", "N01: B2");
  const oldRow = p.navigation!.documents![0]!.rows[0]!;
  p.navigation!.documents![0]!.rows = [
    oldRow,
    {
      ...oldRow,
      id: "inventory/row/b2",
      nativeKey: "port/b2",
      displayName: "N01: B2",
      primitiveId: `sheet-${last}-row-b1`,
      sheet: last,
    },
  ];
  p.navigation!.autoDocuments![0]!.sheets = [first, last];
  const d = p.navigation!.dependencies![0]!;
  d.resolution = [
    { documentId: "inventory", rows: [oldRow.id, "inventory/row/b2"] },
  ];
  const caption = `Ports: network inventory ${String(first).padStart(2, "0")}.A1 (N01: B1); ${String(last).padStart(2, "0")}.A1 (N01: B2).`;
  p.sheets[0]!.svg = p.sheets[0]!.svg.replace(d.caption!.text, caption);
  d.caption!.text = caption;
  for (let number = first + 1; number < last; number++)
    p.sheets.push({ ...structuredClone(p.sheets[1]!), number });
  p.sheets.push(second);
  for (const s of p.sheets) {
    s.svg = s.svg
      .replace(/, sheet \d+ of \d+"/, `, sheet ${s.number} of ${last}"`)
      .replace(/data-sheet="\d+"/, `data-sheet="${s.number}"`)
      .replace(/data-total-sheets="\d+"/, `data-total-sheets="${last}"`)
      .replace(
        / - Sheet \d+ of \d+<\/title>/,
        ` - Sheet ${s.number} of ${last}</title>`,
      )
      .replace(
        /SHEET \d+ \/ \d+/,
        `SHEET ${String(s.number).padStart(2, "0")} / ${String(last).padStart(2, "0")}`,
      )
      .replace(/SHEET \d+ OF \d+/, `SHEET ${s.number} OF ${last}`);
  }
  return p;
}
it("uses one uniform companion offset across every inventory page", () => {
  const before = twoPageInventory(4, 5);
  expect(circuitPacketGuard(twoPageInventory(3, 4), before)).toBe(true);
  expect(circuitPacketGuard(twoPageInventory(3, 5), before)).toBe(false);
});
