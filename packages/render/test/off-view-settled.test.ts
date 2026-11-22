import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { expect, it, vi } from "vitest";
import { searchSettled } from "../src/packet/rooted-settled.js";
import { drawingDrafts } from "../src/packet/rooted.js";
import { renderSchematicPacket } from "../src/sheets.js";
import * as search from "../src/packet/rooted-search.js";
import * as prepared from "../src/off-view/prepared.js";
import type { RootedCandidate } from "../src/packet/rooted-build.js";
import type { RenderFailure } from "../src/types.js";

const page = {
  size: "tabloid" as const,
  orientation: "landscape" as const,
  widthMm: 431.8,
  heightMm: 279.4,
  marginMm: 10,
};
const request = {
  format: "schematic-view-request/0.1" as const,
  family: "control" as const,
  root: { by: "designation" as const, value: "K1" },
  flow: "left-to-right" as const,
};
const candidate = (pages: number, profile?: "compact" | "dense") =>
  ({
    drafts: Array.from({ length: pages }, () => ({
      rootedContent: { figures: 1, conductors: 1 },
      links: [],
    })),
    jogs: new Map(),
    detours: new Map(),
    proximity: 0,
    ...(profile ? { profile } : {}),
  }) as unknown as RootedCandidate;
const run = (pages: number, nativePages: number): search.RootedSearch => ({
  candidates: [candidate(pages)],
  native: [candidate(nativePages)],
  errors: [],
  nativeErrors: new Map(),
  prepared: [],
  attempts: 0,
  tried: new Set(),
});

it("settles only at or below native pages, keeping 2x exclusively for packet refusal", () => {
  expect(searchSettled(run(1, 1), page)).toBe(true);
  expect(searchSettled(run(1, 2), page)).toBe(true);
  expect(searchSettled(run(2, 1), page)).toBe(false);
  expect(searchSettled(run(3, 2), page)).toBe(false);
  expect(searchSettled(run(4, 2), page)).toBe(false);
  for (const kind of ["jogs", "detours"] as const) {
    const r = run(1, 1);
    r.candidates[0]![kind] = new Map([["wire", 1]]);
    expect(searchSettled(r, page)).toBe(false);
  }
  const empty = run(1, 1);
  empty.candidates[0]!.drafts[0]!.rootedContent!.figures = 0;
  expect(searchSettled(empty, page)).toBe(false);
});

// Complete 2.5 mm continuation banks add one sheet in these three witnesses.
// The native-only early-exit assertions above remain unchanged.
const settledCases = [
  ["tabloid", "landscape", 3],
  ["a3", "landscape", 3],
  ["a3", "portrait", 2],
  ["letter", "portrait", 6],
  ["letter", "landscape", 5],
] as const;
for (const witness of settledCases)
  it.each([witness])(
    "searches past 2x settlement on %s %s compact LR",
    async (size, orientation, maximum) => {
      const c = await compileProject("examples/motor-starter");
      if (!c.ok) throw Error(JSON.stringify(c));
      const r = await renderSchematicPacket(
        c.ir,
        {
          format: "schematic-packet-request/0.1",
          layout: "compact",
          page: { size, orientation },
          views: [
            {
              ...request,
              family: "power",
              root: { by: "designation", value: "M1" },
            },
            request,
          ],
        },
        c.presentation,
      );
      if (!r.ok) throw Error(JSON.stringify(r));
      expect(r.value.sheets.length).toBeLessThanOrEqual(maximum);
      expect(
        r.value.sheets.every((s) =>
          s.svg.includes("data-selected-view-notice"),
        ),
      ).toBe(true);
    },
    witness[0] === "letter" && witness[1] === "landscape" ? 60000 : 30000,
  );

const failure = (message: string): RenderFailure => ({
  code: "R006",
  root: "K1",
  reason: "unprintable-layout",
  message,
});
it.each([undefined, "compact", "dense"] as const)(
  "reports the matching %s baseline error instead of an earlier card failure",
  async (profile) => {
    const r = run(1, 1);
    r.candidates = [candidate(1, profile)];
    r.native = [];
    r.errors = [failure("Other profile: card does not fit")];
    const expected = failure(`${profile ?? "standard"}: baseline does not fit`);
    r.nativeErrors = new Map([
      [undefined, failure("standard baseline")],
      ["compact", failure("compact baseline")],
      ["dense", failure("dense baseline")],
    ]);
    r.nativeErrors.set(profile, expected);
    const spy = vi.spyOn(search, "searchRootedCandidates").mockResolvedValue(r);
    try {
      expect(
        await drawingDrafts(
          {} as ElectricalIr,
          request,
          undefined,
          page,
          "compact",
        ),
      ).toEqual({ ok: false, error: expected });
    } finally {
      spy.mockRestore();
    }
  },
);

it("retains each profile's failed no-card preparation for refusal reporting", async () => {
  const c = await compileProject("examples/off-view-connections");
  if (!c.ok) throw Error(JSON.stringify(c));
  const spy = vi.spyOn(prepared, "nativeDrawing");
  for (const name of ["standard", "compact", "dense"])
    spy.mockResolvedValueOnce({ ok: false, error: failure(name) });
  try {
    const r = await search.searchRootedCandidates(
      c.ir,
      request,
      c.presentation,
      page,
      true,
    );
    expect([...r.nativeErrors.keys()]).toEqual([undefined, "compact", "dense"]);
    for (const profile of [undefined, "compact", "dense"] as const)
      expect(r.nativeErrors.get(profile)!.message).toContain(
        `No printable no-card baseline: ${profile ?? "standard"}`,
      );
  } finally {
    spy.mockRestore();
  }
});
