import { beforeAll, afterAll, expect, it } from "vitest";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import {
  dependencyDraft,
  wireNeed,
  documentPaper,
  fixtureSheets,
  reportFixture,
} from "./document-fixture.js";
import { appendDocumentCompanions } from "../src/packet/document-companions.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import { renderSchematicPacket, renderSchematicSheets } from "../src/sheets.js";
import { documentLoopFixture, loopRequest } from "./document-loop-fixture.js";
import {
  documentCaptionTokens,
  wrapDocumentTokens,
} from "../src/packet/document-caption-text.js";

let source: Awaited<ReturnType<typeof offViewFixture>>;
beforeAll(async () => {
  source = await offViewFixture();
});
afterAll(async () => {
  await source.dispose();
});
it("deduplicates overlapping needs and adds no invented authored view index", () => {
  const need = wireNeed(source.ir),
    draft = dependencyDraft(source.ir, [need, { ...need, noteId: "another" }]);
  const closed = appendDocumentCompanions(source.ir, [draft], documentPaper());
  if (!closed.ok) throw Error(JSON.stringify(closed.error));
  const auto = closed.value.filter((d) => d.autoDocumentOrigin);
  expect(auto).toHaveLength(1);
  expect(auto[0]!.documentRows!.map((r) => r.nativeKey)).toEqual([
    source.ir.wires.find((w) => w.designation === "W3")!.uid,
  ]);
  expect(auto[0]!.autoDocumentOrigin!.dependencyIds).toHaveLength(2);
  expect(auto[0]!.views).toBeUndefined();
  expect(auto[0]!.documentationSelection).toBeUndefined();
  expect(auto[0]!.documentNeeds).toBeUndefined();
});
it("reuses complete requested rows before appending and preserves filtered reports", () => {
  const need = wireNeed(source.ir),
    d = dependencyDraft(source.ir, [need]);
  const reports = reportFixture(source.ir, {
    format: "documentation-view-request/0.1",
    kind: "wires",
    filter: { devices: ["H1"] },
  });
  const bytes = JSON.stringify(reports);
  const result = appendDocumentCompanions(
    source.ir,
    [d, ...reports],
    documentPaper(),
  );
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(result.value).toHaveLength(1 + reports.length);
  expect(JSON.stringify(reports)).toBe(bytes);
});
it("returns contextual R006 when the required appended page crosses the cap", () => {
  const d = dependencyDraft(source.ir, [wireNeed(source.ir)]),
    drafts = [
      d,
      ...Array.from({ length: 99 }, () => dependencyDraft(source.ir)),
    ];
  const result = appendDocumentCompanions(source.ir, drafts, documentPaper());
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("must refuse");
  expect(result.error.code).toBe("R006");
  expect(result.error.message).toContain("100-sheet");
  expect("details" in result.error && result.error.details?.subjects).toContain(
    "PS1.+",
  );
});
it("refuses an occupied caption field without moving or erasing native ink", () => {
  const d = dependencyDraft(source.ir, [wireNeed(source.ir)]),
    b = d.drawingBounds!;
  d.content = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="black"/>`;
  const closed = appendDocumentCompanions(source.ir, [d], documentPaper());
  if (!closed.ok) throw Error(JSON.stringify(closed.error));
  const sheets = fixtureSheets(source.ir, closed.value),
    bytes = JSON.stringify(sheets);
  const result = finalizeNavigation(source.ir, closed.value, sheets, {
    page: documentPaper(),
    documents: { presentation: undefined, standalone: false },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("must refuse");
  expect(result.error.code).toBe("R006");
  expect(result.error.message).toContain("PS1.+");
  expect(JSON.stringify(sheets)).toBe(bytes);
});
it("is pure and deterministic after source closure, including inserted sheet tokens", () => {
  const d = dependencyDraft(source.ir, [wireNeed(source.ir)]);
  const closed = appendDocumentCompanions(
    source.ir,
    [dependencyDraft(source.ir), d],
    documentPaper(),
  );
  if (!closed.ok) throw Error(JSON.stringify(closed.error));
  const sheets = fixtureSheets(source.ir, closed.value),
    before = JSON.stringify([closed.value, sheets]);
  const run = () =>
    finalizeNavigation(source.ir, closed.value, sheets, {
      page: documentPaper(),
      documents: { presentation: undefined, standalone: false },
    });
  const first = run(),
    second = run();
  if (!first.ok) throw Error(JSON.stringify(first.error));
  expect(second).toEqual(first);
  expect(JSON.stringify([closed.value, sheets])).toBe(before);
  expect(first.value.navigation.dependencies![0]!.caption!.text).toContain(
    "03.A4",
  );
});
it("keeps unresolved relation pin maps unresolved and inventories every native core status", async () => {
  const f = await documentLoopFixture();
  try {
    const before = JSON.stringify(f.ir);
    const result = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      views: [loopRequest],
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const assemblies = result.value.sheets.filter(
      (s) => "kind" in s.view && s.view.kind === "assemblies",
    );
    expect(assemblies).toHaveLength(1);
    const dom = parseSvg(assemblies[0]!.svg);
    expect(
      dom.querySelector(
        '[data-report-row="69000000-0000-4000-8000-000000000004"] [data-report-column="5"]',
      )!.textContent,
    ).toContain("Pin mapping: unresolved");
    const wires = result.value.sheets.find(
      (s) => "kind" in s.view && s.view.kind === "wires",
    )!;
    const rows = [...parseSvg(wires.svg).querySelectorAll("[data-report-row]")];
    expect(rows).toHaveLength(4);
    expect(rows[2]!.textContent).toContain("spare; connected");
    expect(rows[3]!.textContent).toContain("spare; connected");
    expect(JSON.stringify(f.ir)).toBe(before);
  } finally {
    await f.dispose();
  }
});
it("keeps standalone views honestly partial and generic warnings promise no inventory", async () => {
  const result = await renderSchematicSheets(source.ir, {
    format: "wiring-view-request/0.1",
    title: "standalone",
    conductors: ["W1"],
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(result.value.sheets).toHaveLength(1);
  expect(result.value.navigation!.dependencies![0]!.caption!.text).toContain(
    "no companion inventory is included.",
  );
  expect(
    result.value.navigation!.dependencies!.every((d) => !d.resolution.length),
  ).toBe(true);
});
it("never splits authored identities, sheet.zone or terminal tokens", () => {
  const tokens = [
    "terminal",
    "inventory",
    "100.B2",
    "(A spaced device.X odd key,",
  ]; // spaces inside a single authored identity.
  const lines = wrapDocumentTokens(tokens, 36);
  expect(lines.join("\n")).toContain("100.B2");
  expect(lines.some((l) => l.includes("A spaced device.X odd key"))).toBe(true);
  expect(() => wrapDocumentTokens(["UNBREAKABLE".repeat(30)], 20)).toThrow(
    /Indivisible/,
  );
});

it("keeps loose/unassigned core states explicit without pretending a loop is printable", async () => {
  const f = await documentLoopFixture(true);
  try {
    const refused = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      views: [loopRequest],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw Error("loose loop must refuse");
    expect(refused.error.message).toContain("unassigned or loose cores");
    const need = {
      noteId: "native-core-status",
      need: "core-inventory" as const,
      requiredFacts: ["3", "4"].map((conductorId) => ({
        kind: "core-inventory" as const,
        cableUid: f.ir.cables[0]!.uid,
        conductorId,
      })),
      requiredColumns: ["identity", "endpoints", "status"] as const,
      subject: "Cable core details",
    };
    const closed = appendDocumentCompanions(
      f.ir,
      [dependencyDraft(f.ir, [need])],
      documentPaper(),
    );
    if (!closed.ok) throw Error(JSON.stringify(closed.error));
    const rows = closed.value.flatMap((d) => d.documentRows ?? []);
    expect(rows.map((r) => r.cells[4])).toEqual([
      "spare; unterminated",
      "unassigned; unassigned",
    ]);
  } finally {
    await f.dispose();
  }
});
it("refuses unresolved final promises even when no automatic inventory is supplied", () => {
  const drafts = [dependencyDraft(source.ir, [wireNeed(source.ir)])];
  const result = finalizeNavigation(
    source.ir,
    drafts,
    fixtureSheets(source.ir, drafts),
    {
      page: documentPaper(),
      documents: { presentation: undefined, standalone: false },
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("must refuse");
  expect(result.error.code).toBe("R006");
  expect(
    "details" in result.error && result.error.details?.documentDependencies,
  ).toHaveLength(1);
});
it("refuses a cycle rather than adding promises to generated inventories", () => {
  const d = dependencyDraft(source.ir, [wireNeed(source.ir)]);
  d.autoDocumentOrigin = { dependencyIds: ["earlier"] };
  const result = appendDocumentCompanions(source.ir, [d], documentPaper());
  expect(result.ok).toBe(false);
  if (result.ok) throw Error("must refuse");
  expect(result.error.message).toContain("Cyclic");
});
it("preserves caller drafts during source closure", () => {
  const drafts = [dependencyDraft(source.ir, [wireNeed(source.ir)])],
    bytes = JSON.stringify(drafts);
  const result = appendDocumentCompanions(source.ir, drafts, documentPaper());
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(JSON.stringify(drafts)).toBe(bytes);
});
it("refuses an unprintable required report with view, need and source context", async () => {
  const f = await offViewFixture((objects) => {
    objects.find((o) => o.designation === "W3").designation = "W".repeat(400);
  });
  try {
    const result = await renderSchematicPacket(f.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "wiring-view-request/0.1",
          title: "Unprintable companion",
          conductors: ["W1"],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("must refuse");
    expect(result.error.code).toBe("R006");
    expect(result.error.message).toContain("Unprintable companion");
    expect(
      "details" in result.error && result.error.details?.subjects,
    ).toContain("PS1.+");
  } finally {
    await f.dispose();
  }
});
it("prints readable endpoint identity for an unnamed jumper, never its row UUID", async () => {
  const result = await renderSchematicPacket(source.ir, {
    format: "schematic-packet-request/0.1",
    views: [
      {
        format: "wiring-view-request/0.1",
        title: "Return",
        conductors: ["W2"],
      },
    ],
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const text = result.value
    .navigation!.dependencies!.flatMap((d) => d.caption!.text)
    .join(" ");
  expect(text).toContain("PS1.- ↔ TB1.2");
  expect(text).not.toContain(
    source.ir.jumpers.find((j) => !j.designation)!.uid,
  );
});
it("generic selected-path warnings promise no inventory", async () => {
  const result = await renderSchematicPacket(source.ir, {
    format: "schematic-packet-request/0.1",
    views: [
      {
        format: "schematic-view-request/0.1",
        root: { by: "designation", value: "K1" },
        family: "control",
      },
    ],
  });
  if (!result.ok) throw Error(JSON.stringify(result.error));
  expect(result.value.navigation!.dependencies).toEqual([]);
  expect(result.value.navigation!.autoDocuments).toEqual([]);
  const text = result.value.sheets
    .map((s) => parseSvg(s.svg).querySelector("svg")!.textContent)
    .join(" ");
  expect(text).toContain(
    "Selected path only; other authored connections may be outside this view.",
  );
  expect(text).not.toContain("See circuit views or packet coverage");
});
it("reserves the widest sheet token before allocating a caption", async () => {
  const { documentCaptionReservation } =
    await import("../src/packet/document-caption-ink.js");
  const { printableTextMetrics } = await import("../src/text-metrics.js");
  const { documentDependencies } =
    await import("../src/packet/document-companions.js");
  const need = documentDependencies(source.ir, [
    dependencyDraft(source.ir, [wireNeed(source.ir)]),
  ])[0]!;
  const width = printableTextMetrics("Inventory 01.A1", 2.5).advance + 2.01;
  const reservation = documentCaptionReservation(
    need,
    ["Inventory", "01.A1"],
    width,
  );
  expect(printableTextMetrics("Inventory 100.D6", 2.5).advance).toBeGreaterThan(
    width - 2,
  );
  expect(reservation.shapes![0]!.inkMm.h).toBe(9.2);
});

it("standalone direct-loop notes do not promise an included inventory", async () => {
  const f = await documentLoopFixture();
  try {
    const result = await renderSchematicSheets(f.ir, loopRequest);
    if (!result.ok) throw Error(JSON.stringify(result.error));
    expect(result.value.sheets).toHaveLength(1);
    expect(
      result.value.navigation!.dependencies!.every((d) => !d.resolution.length),
    ).toBe(true);
    const text = [
      ...parseSvg(result.value.sheets[0]!.svg).querySelectorAll("text"),
    ]
      .map((t) => t.textContent)
      .join(" ");
    expect(text).not.toContain("inventory locations follow");
    expect(text).toContain("no companion inventory is included.");
  } finally {
    await f.dispose();
  }
});

it("keeps the document extension itself pure over native finalized sheets", async () => {
  const drafts = [dependencyDraft(source.ir, [wireNeed(source.ir)])];
  const closed = appendDocumentCompanions(source.ir, drafts, documentPaper());
  if (!closed.ok) throw Error(JSON.stringify(closed.error));
  const sheets = fixtureSheets(source.ir, closed.value);
  const native = finalizeNavigation(source.ir, closed.value, sheets);
  if (!native.ok) throw Error(JSON.stringify(native.error));
  const { finalizeDocuments } =
    await import("../src/packet/document-captions.js");
  const before = JSON.stringify(sheets);
  finalizeDocuments(
    source.ir,
    closed.value,
    sheets,
    documentPaper(),
    native.value.navigation,
    false,
  );
  expect(JSON.stringify(sheets)).toBe(before);
});
