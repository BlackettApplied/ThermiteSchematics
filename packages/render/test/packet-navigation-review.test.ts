import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import { roundNavigation } from "../src/packet/navigation-location.js";
import { navigationFixture } from "./packet-navigation-fixture.js";
import {
  twoContactFixture,
  conveyorRequest,
} from "./packet-navigation-review-fixture.js";
import { control, offViewFixture } from "./off-view-fixtures.js";
import * as cards from "../src/off-view/svg.js";

it.each(["conveyor-line", "machine-demo"])(
  "prints one SRC1 label per drawn symbol in %s",
  async (name) => {
    const c = await compileProject(`examples/${name}`);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    const request =
      name === "conveyor-line"
        ? conveyorRequest()
        : JSON.parse(
            await readFile(`examples/${name}/packet.request.json`, "utf8"),
          );
    for (const flow of ["left-to-right", "top-to-bottom"]) {
      for (const view of request.views) if (view.flow) view.flow = flow;
      const r = await renderSchematicPacket(c.ir, request, c.presentation);
      if (!r.ok) throw Error(JSON.stringify(r.error));
      const uid = c.ir.devices.find((d) => d.designation === "SRC1")!.uid;
      const owned = new Set(
        r.value
          .navigation!.occurrences.filter((o) => o.source.deviceUid === uid)
          .map((o) => o.id),
      );
      const labels = r.value.navigation!.annotations.filter((a) =>
        owned.has(a.ownerOccurrence),
      );
      expect(labels).toHaveLength(2);
      expect(labels[1]!.text).toContain("(same functions)");
    }
  },
);

it("merges two repeated contacts into one label with literal per-function target zones", async () => {
  const source = await offViewFixture();
  try {
    const f = twoContactFixture(source.ir),
      r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(r.value.navigation.annotations.map((a) => a.text)).toEqual([
      "K1: Also shown 02.B3, 02.C3",
      "K1: Repeat of 01.B3, 01.C3 (same functions)",
    ]);
  } finally {
    await source.dispose();
  }
});

it("claims reservations only on full occurrences, never on a fragment sheet", async () => {
  const source = await offViewFixture();
  try {
    const f = navigationFixture(source.ir);
    f.drafts.splice(1, 0, structuredClone(f.drafts[0]!));
    f.sheets.splice(1, 0, {
      ...f.sheets[0]!,
      number: 2,
      svg: f.sheets[0]!.svg.replace(
        'width="80" height="40" viewBox="0 0 40 20"',
        'width="40" height="40" viewBox="0 0 20 20"',
      ),
    });
    f.sheets[2] = { ...f.sheets[2]!, number: 3 };
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(
      r.value.navigation.reservations.map((r) => r.allocatedMm!.sheet),
    ).toEqual([1, 3]);
    expect(new Set(r.value.navigation.reservations.map((r) => r.id)).size).toBe(
      2,
    );
    expect(r.value.sheets[1]!.annotationIds).toBeUndefined();
  } finally {
    await source.dispose();
  }
});

it("rejects a suppressed real off-view card through the production packet finalizer", async () => {
  const c = await compileProject("examples/conveyor-line");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const emit = cards.offViewCardSvg;
  const spy = vi
    .spyOn(cards, "offViewCardSvg")
    .mockImplementation((label, ...args) =>
      label.offView?.terminalName === "PB1.12" ? "" : emit(label, ...args),
    );
  try {
    const r = await renderSchematicPacket(c.ir, {
      format: "schematic-packet-request/0.1",
      views: [
        control(),
        { ...control(), root: { by: "designation", value: "K2" } },
      ],
    });
    expect(spy).toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("R006");
      expect(r.error.message).toMatch(/source-incidence/);
    }
  } finally {
    spy.mockRestore();
  }
});

it("rounds exact decimal half-way values up at navigation boundaries", () => {
  expect(roundNavigation(1.005)).toBe(1.01);
  expect(roundNavigation(19.995)).toBe(20);
  expect(roundNavigation(-1.005)).toBe(-1.01);
});

import { sameViewFixture } from "./packet-navigation-review-fixture.js";
it("selects canonical by sheet before zone within one authored view", async () => {
  const source = await offViewFixture();
  try {
    const f = sameViewFixture(source.ir, [
      { sheet: 1, x: 10, y: 30 },
      { sheet: 2, x: 10, y: 0 },
    ]);
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(
      r.value.navigation.occurrences.map((o) => o.destination.zone),
    ).toEqual(["C2", "A2"]);
    expect(
      r.value.navigation.annotations.map(
        (a) => a.locality!.ownerLocation.sheet,
      ),
    ).toEqual([1, 2]);
    const first = r.value.navigation.occurrences.find(
      (o) => o.primitiveIds[0] === "native-0",
    )!;
    expect(r.value.navigation.canonicalGroups[0]!.canonical).toBe(first.id);
  } finally {
    await source.dispose();
  }
});
it("selects canonical by zone before anchor y within one sheet and view", async () => {
  const source = await offViewFixture();
  try {
    const f = sameViewFixture(source.ir, [
      { sheet: 1, x: 70, y: 0 },
      { sheet: 1, x: 0, y: 4 },
    ]);
    const r = finalizeNavigation(f.ir, f.drafts, f.sheets);
    if (!r.ok) throw Error(JSON.stringify(r.error));
    expect(
      r.value.navigation.occurrences.map((o) => [
        o.destination.zone,
        o.destination.anchorMm,
      ]),
    ).toEqual([
      ["A5", { x: 90, y: 10 }],
      ["A2", { x: 20, y: 14 }],
    ]);
    const earlierZone = r.value.navigation.occurrences.find(
      (o) => o.primitiveIds[0] === "native-1",
    )!;
    expect(r.value.navigation.canonicalGroups[0]!.canonical).toBe(
      earlierZone.id,
    );
  } finally {
    await source.dispose();
  }
});

import * as svgReader from "../src/device-legend/svg-tree.js";
import { seedCircuitNavigation } from "../src/packet/navigation-circuit.js";
it("refuses a circuit start-tag/tree name mismatch", async () => {
  const source = await offViewFixture();
  const parse = svgReader.svgTree;
  const spy = vi.spyOn(svgReader, "svgTree").mockImplementation((svg) => {
    const tree = parse(svg);
    tree.children[0]!.name = "wrong-tag";
    return tree;
  });
  try {
    const f = navigationFixture(source.ir);
    expect(() => seedCircuitNavigation(f.ir, f.drafts)).toThrow(
      /start-tag\/tree name mismatch/,
    );
  } finally {
    spy.mockRestore();
    await source.dispose();
  }
});

import * as repeats from "../src/packet/navigation-repeats.js";
it("rejects duplicate reservation identities through production finalization", async () => {
  const source = await offViewFixture();
  const plan = repeats.planRepeatNavigation;
  const spy = vi
    .spyOn(repeats, "planRepeatNavigation")
    .mockImplementation((...args) => {
      const result = plan(...args);
      result.reservations.push(structuredClone(result.reservations[0]!));
      return result;
    });
  try {
    const f = navigationFixture(source.ir);
    const result = finalizeNavigation(f.ir, f.drafts, f.sheets);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.message).toContain(
        "Duplicate navigation reservation identity",
      );
  } finally {
    spy.mockRestore();
    await source.dispose();
  }
});
