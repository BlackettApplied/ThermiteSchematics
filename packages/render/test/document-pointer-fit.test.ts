import { expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";
import { pointerFixture } from "./document-pointer-fixture.js";
import { assemblyPortPointers } from "../src/packet/document-assembly-pointers.js";
import { DocumentDependencyError } from "../src/packet/document-error.js";
import * as slots from "../src/packet/navigation-slots.js";
import { renderSchematicPacket } from "../src/sheets.js";

it("wraps whole port, arrow and destination entries at narrow fallback widths", async () => {
  const f = await pointerFixture();
  const result = assemblyPortPointers(f.ir, f.drafts, f.sheets, f.page, []);
  const lines = [
    ...parseHTML(result[0]?.svg ?? "").document.querySelectorAll(
      "[data-assembly-port-destinations] text",
    ),
  ].map((t) => t.textContent);
  expect(lines).toEqual(["Port R1.X2 → 02.B3;", "Port R1.X3 → 03.D6."]);
});

it("keeps eight entries atomic when ink forces the 100 mm fallback shape", async () => {
  const f = await pointerFixture(180, false, 9);
  const owner = f.ir.devices.find((d) => d.designation === "R1");
  if (!owner) throw Error("Missing native owner");
  owner.designation = "CONTROL-R1";
  const draft = f.drafts[0];
  if (!draft) throw Error("Missing source draft");
  draft.inlineDocumentBounds = { x: 105, y: 0, w: 75, h: 120 };
  const result = assemblyPortPointers(f.ir, f.drafts, f.sheets, f.page, []);
  const lines = [
    ...parseHTML(result[0]?.svg ?? "").document.querySelectorAll(
      "[data-assembly-port-destinations] text",
    ),
  ].map((t) => t.textContent);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines)
    expect(line).toMatch(
      /^Port CONTROL-R1\.X\d → \d{2}\.[A-D][1-6][;.](?: Port CONTROL-R1\.X\d → \d{2}\.[A-D][1-6][;.])*$/u,
    );
  expect(lines.join(" ").match(/Port CONTROL-R1\.X\d →/gu)).toHaveLength(8);
});

it.each([
  { width: 10, blocked: false },
  { width: 52, blocked: true },
])(
  "types a pointer fit refusal with required and available millimetres: %j",
  async ({ width, blocked }) => {
    const f = await pointerFixture(width, blocked);
    let caught: unknown;
    try {
      assemblyPortPointers(f.ir, f.drafts, f.sheets, f.page, []);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DocumentDependencyError);
    if (!(caught instanceof DocumentDependencyError)) return;
    expect(caught.details).toMatchObject({
      sheet: 1,
      profile: "assembly-port-pointer/1",
      availableMm: { x: 0, y: 0, w: width, h: 120 },
      placementSearch: expect.any(Object),
      requiredMm: { w: expect.any(Number), h: expect.any(Number) },
    });
    expect(caught.message).toMatch(/sheet 1.*Port R1\.X2.*mm/u);
  },
);

it("returns R006 with pointer placement measurements through packet finalization", async () => {
  const c = await compileProject("examples/cap-pagination");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const request = JSON.parse(
    await readFile("examples/cap-pagination/packet.json", "utf8"),
  );
  const allocate = slots.allocateNavigationSlots;
  const probe = vi
    .spyOn(slots, "allocateNavigationSlots")
    .mockImplementation((requests, ...rest) => {
      if (requests[0]?.reservation.profileId === "assembly-port-pointer/1")
        throw new slots.NavigationSlotFailure("Forced pointer vacancy", {
          forced: true,
        });
      return allocate(requests, ...rest);
    });
  try {
    const result = await renderSchematicPacket(c.ir, request);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "R006",
        details: {
          profile: "assembly-port-pointer/1",
          placementSearch: { forced: true },
          requiredMm: expect.any(Object),
          availableMm: expect.any(Object),
        },
      },
    });
  } finally {
    probe.mockRestore();
  }
});

it("propagates unexpected slot errors by identity", async () => {
  const f = await pointerFixture();
  const error = new Error("Unexpected geometry failure");
  const probe = vi
    .spyOn(slots, "allocateNavigationSlots")
    .mockImplementation(() => {
      throw error;
    });
  try {
    let caught: unknown;
    try {
      assemblyPortPointers(f.ir, f.drafts, f.sheets, f.page, []);
    } catch (value) {
      caught = value;
    }
    expect(caught).toBe(error);
  } finally {
    probe.mockRestore();
  }
});
