import { expect, it, vi } from "vitest";
import type { DocumentDependency } from "../src/packet/document-types.js";
import type { RenderedSheet } from "../src/packet/types.js";
import { placeDocumentCaption } from "../src/packet/document-caption-place.js";
import { documentCaptionInk } from "../src/packet/document-caption-ink.js";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { offViewFixture, parseSvg } from "./off-view-fixtures.js";
import { documentCaptionOwner } from "../src/packet/document-caption-owner.js";
import { localNavigationSlot } from "../src/packet/navigation-symbols.js";
import { documentCaptionLeader } from "../src/packet/document-caption-leader.js";
import * as captionSlots from "../src/packet/document-caption-slot.js";
import { DocumentDependencyError } from "../src/packet/document-error.js";

const ir = createTerminalIr([
  { uid: "caption-owner", designation: "X1", terminalKeys: ["1"] },
]);
const field = { x: 0, y: 0, w: 200, h: 200 };
const need = (): DocumentDependency => ({
  id: "native-need",
  noteId: "terminal-incidence",
  need: "conductor-incidence",
  requiredFacts: [
    {
      kind: "conductor-incidence",
      element: { kind: "wire", uid: "wire-1" },
      end: 0,
      terminal: { deviceUid: "caption-owner", terminalKey: "1" },
    },
  ],
  requiredColumns: ["identity", "endpoints", "status"],
  subject: "X1.1",
  count: 1,
  owner: { viewKey: "view-1", noteId: "terminal-incidence", sheet: 1 },
  snapshotDigest: "source",
  presentationDigest: "presentation",
  revision: "A",
  resolution: [],
});

it("uses the first native frame rather than a later direct label background", () => {
  const drawing = sheet();
  const svg = drawing.svg.replace(
    "<circle",
    '<rect x="155" y="145" width="10" height="10" fill="white"/><circle',
  );
  expect(
    documentCaptionOwner(need(), { ...drawing, svg }, field)?.frameMm,
  ).toEqual({
    x: 150,
    y: 150,
    w: 20,
    h: 20,
  });
});

it("rejects local caption ink nearer a foreign frame", () => {
  const drawing = sheet(
    '<g data-device-uid="foreign"><rect x="100" y="100" width="20" height="20" fill="white" stroke="black"/></g>',
  );
  const owner = documentCaptionOwner(need(), drawing, field);
  expect(owner).toBeDefined();
  if (!owner) throw Error("Missing owner fixture");
  expect(localNavigationSlot({ x: 120, y: 124, w: 20, h: 5 }, owner)).toBe(
    false,
  );
});

it.each(["ink", "claim"])("rejects a leader blocked by %s", (blocker) => {
  const drawing = sheet();
  const owner = documentCaptionOwner(need(), drawing, field);
  expect(owner).toBeDefined();
  if (!owner) throw Error("Missing owner fixture");
  const caption = { x: 140, y: 0, w: 40, h: 10 };
  expect(documentCaptionLeader(caption, owner, drawing.svg, [])).toBeDefined();
  const svg =
    blocker === "ink"
      ? drawing.svg.replace(
          "</svg>",
          '<path d="M 140 75 L 180 75" stroke="black" stroke-width=".3"/></svg>',
        )
      : drawing.svg;
  const claims = blocker === "claim" ? [{ x: 150, y: 70, w: 20, h: 10 }] : [];
  expect(documentCaptionLeader(caption, owner, svg, claims)).toBeUndefined();
});

it("does not assign a multi-device need to its first terminal", () => {
  const dependency = need();
  dependency.requiredFacts = [
    ...dependency.requiredFacts,
    {
      kind: "conductor-incidence",
      element: { kind: "wire", uid: "wire-1" },
      end: 1,
      terminal: { deviceUid: "peer", terminalKey: "1" },
    },
  ];
  expect(documentCaptionOwner(dependency, sheet(), field)).toBeUndefined();
});

it("does not choose between distinct markers for the same source terminal", () => {
  const drawing = sheet();
  const svg = drawing.svg.replace(
    "</g>",
    '<circle data-terminal-key="1" cx="160" cy="160" r=".7"/></g>',
  );
  expect(
    documentCaptionOwner(need(), { ...drawing, svg }, field),
  ).toBeUndefined();
});

it("does not use a partially clipped owner frame", () => {
  const drawing = sheet();
  const svg = drawing.svg.replace(
    "<g data-navigation-view=",
    '<defs><clipPath id="owner-crop"><rect x="150" y="150" width="10" height="20"/></clipPath></defs><g clip-path="url(#owner-crop)" data-navigation-view=',
  );
  expect(
    documentCaptionOwner(need(), { ...drawing, svg }, field),
  ).toBeUndefined();
});

it("keeps the visible part of a clipped foreign frame as a competitor", () => {
  const drawing = sheet(
    '<defs><clipPath id="foreign-crop"><rect x="100" y="100" width="10" height="20"/></clipPath></defs><g data-device-uid="foreign" clip-path="url(#foreign-crop)"><rect x="90" y="100" width="20" height="20" fill="white" stroke="black"/></g>',
  );
  const owner = documentCaptionOwner(need(), drawing, field);
  expect(owner).toBeDefined();
  if (!owner) throw Error("Missing owner fixture");
  expect(owner.framesMm).toContainEqual({ x: 100, y: 100, w: 10, h: 20 });
  expect(localNavigationSlot({ x: 112, y: 124, w: 20, h: 5 }, owner)).toBe(
    false,
  );
});

it.each([
  { stroke: 0.3, scale: 1, nonScaling: false },
  { stroke: 1, scale: 1, nonScaling: false },
  { stroke: 0.3, scale: 2, nonScaling: false },
  { stroke: 1, scale: 2, nonScaling: false },
  { stroke: 0.3, scale: 2, nonScaling: true },
  { stroke: 1, scale: 2, nonScaling: true },
])(
  "leaves a visible 2 mm gap beyond the transformed marker: %j",
  ({ stroke, scale, nonScaling }) => {
    const drawing = sheet();
    const shifted = drawing.svg.replace(
      "<g data-navigation-view=",
      `<g transform="translate(${-150 * (scale - 1)} ${-150 * (scale - 1)}) scale(${scale})" data-navigation-view=`,
    );
    const svg = shifted.replace(
      'r=".7" fill="white" stroke="black"',
      `r=".7" fill="white" stroke="black" stroke-width="${stroke}"${nonScaling ? ' vector-effect="non-scaling-stroke"' : ""}`,
    );
    const owner = documentCaptionOwner(need(), { ...drawing, svg }, field);
    expect(owner).toBeDefined();
    if (!owner) throw Error("Missing owner fixture");
    const leader = documentCaptionLeader(
      { x: 140, y: 0, w: 50, h: 10 },
      owner,
      svg,
      [],
    );
    expect(leader).toBeDefined();
    if (!leader) throw Error("Missing clear leader fixture");
    const distance = Math.hypot(
      owner.anchorMm.x - leader.to.x,
      owner.anchorMm.y - leader.to.y,
    );
    const visibleRadius = 0.7 * scale + (stroke / 2) * (nonScaling ? 1 : scale);
    expect(distance - visibleRadius).toBeGreaterThanOrEqual(2 - 1e-9);
  },
);

it("labels local and remote caption refusal attempts separately", () => {
  const mock = vi
    .spyOn(captionSlots, "documentCaptionSlot")
    .mockImplementation((_need, _tokens, _field, _sheet, _claims, mode) => {
      throw Error(`${mode}: identity slot blocked`);
    });
  let caught: unknown;
  try {
    placeDocumentCaption(ir, need(), [], field, sheet(), [], true);
  } catch (error) {
    caught = error;
  } finally {
    mock.mockRestore();
  }
  expect(caught).toBeInstanceOf(DocumentDependencyError);
  if (!(caught instanceof DocumentDependencyError))
    throw Error("Missing refusal fixture");
  expect(caught.details).toMatchObject({
    identityFormError: "Error: self-located: identity slot blocked",
    localFormErrors: { identities: "Error: local: identity slot blocked" },
    remoteFormErrors: {
      identities: "Error: self-located: identity slot blocked",
    },
  });
});
function sheet(obstacles = ""): RenderedSheet {
  return {
    number: 1,
    view: { format: "documentation-view/0.1", kind: "wiring", title: "Owner" },
    references: [],
    continuations: [],
    svg: `<svg width="200mm" height="200mm" viewBox="0 0 200 200">${obstacles}<g data-navigation-view="view-1" data-device-uid="caption-owner"><rect x="150" y="150" width="20" height="20" fill="white" stroke="black"/><circle data-terminal-key="1" cx="160" cy="150" r=".7" fill="white" stroke="black"/></g></svg>`,
  };
}

it("chooses a fitting local slot instead of a remote margin and retains the need", () => {
  const dependency = need();
  const placed = placeDocumentCaption(
    ir,
    dependency,
    [],
    field,
    sheet(
      '<g data-device-uid="foreign"><rect x="20" y="20" width="20" height="20" fill="white" stroke="black"/><text x="20" y="30" font-size="2.5">X1.1</text></g>',
    ),
    [],
    true,
  );
  const box = placed.slot.allocatedMm?.rect;
  if (!box) throw Error("Missing caption slot");
  expect(
    Math.hypot(
      Math.max(box.x - 160, 160 - box.x - box.w, 0),
      Math.max(box.y - 150, 150 - box.y - box.h, 0),
    ),
  ).toBeLessThanOrEqual(60);
  const ink = documentCaptionInk(dependency, placed.slot, {
    form: placed.form,
  });
  expect(ink).toContain('data-document-dependency="native-need"');
  expect(ink).toContain("X1.1");
  expect(dependency.requiredFacts).toHaveLength(1);
  expect(dependency.caption?.locality).toMatchObject({
    deviceUid: "caption-owner",
    terminalKey: "1",
    mode: "local",
    anchorMm: { x: 160, y: 150 },
  });
  expect(dependency.caption?.locality?.distanceMm).toBeLessThanOrEqual(60);
});

it("supports a remote caption with a clear nonconductive leader", () => {
  const dependency = need();
  const obstacles =
    '<rect x="0" y="25" width="159" height="175" fill="black"/><rect x="161" y="25" width="39" height="175" fill="black"/><rect x="0" y="171" width="200" height="29" fill="black"/>';
  const placed = placeDocumentCaption(
    ir,
    dependency,
    [],
    field,
    sheet(obstacles),
    [],
    true,
  );
  const ink = documentCaptionInk(dependency, placed.slot, {
    form: placed.form,
  });
  expect(ink).toContain('data-document-caption-leader="native-need"');
  expect(ink).toContain("X1.1");
  expect(placed.slot.leader?.to.x).toBeCloseTo(160, 6);
  expect(placed.slot.leader?.to.y).toBeLessThanOrEqual(146.8);
});

it("prints a caption for every native need after locality placement", async () => {
  const source = await offViewFixture();
  try {
    const result = await renderSchematicPacket(source.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        {
          format: "wiring-view-request/0.1",
          title: "Local captions",
          conductors: ["W1"],
        },
      ],
    });
    if (!result.ok) throw Error(JSON.stringify(result.error));
    const dependencies = result.value.navigation.dependencies ?? [];
    expect(dependencies.map((d) => d.need).sort()).toEqual([
      "conductor-incidence",
      "terminal-inventory",
      "terminal-inventory",
    ]);
    for (const dependency of dependencies) {
      const owner = result.value.sheets.find(
        (s) => s.number === dependency.owner.sheet,
      );
      const captions = [
        ...parseSvg(owner?.svg ?? "").querySelectorAll(
          "[data-document-dependency]",
        ),
      ];
      expect(
        captions.filter(
          (c) => c.getAttribute("data-document-dependency") === dependency.id,
        ),
      ).toHaveLength(1);
      expect(dependency.requiredFacts.length).toBeGreaterThan(0);
      expect(dependency.resolution.length).toBeGreaterThan(0);
      if (dependency.need === "conductor-incidence") {
        const fact = dependency.requiredFacts[0];
        if (fact?.kind !== "conductor-incidence")
          throw Error("Missing native incidence");
        expect(dependency.caption?.locality).toMatchObject({
          deviceUid: fact.terminal.deviceUid,
          terminalKey: fact.terminal.terminalKey,
        });
      }
    }
  } finally {
    await source.dispose();
  }
});
