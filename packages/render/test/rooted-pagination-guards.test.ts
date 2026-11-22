import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import type { PreparedSchematicDrawing } from "../src/renderer.js";
import type { SchematicPacketRequest } from "../src/sheets.js";
import { renderSchematicPacket } from "../src/sheets.js";
import * as prepared from "../src/off-view/prepared.js";
import * as build from "../src/packet/rooted-build.js";
import * as fit from "../src/packet/composition-fit.js";
import * as frame from "../src/packet/frame-budget.js";
import * as placement from "../src/packet/frame-legacy-placement.js";
import { hasCompactFrame } from "../src/packet/frame-profile.js";
import * as pagination from "../src/packet/rooted-pagination-retry.js";
import { actuation } from "./dol-control-junctions-fixture.js";
import { dolProbeFixture } from "./dol-control-probes-fixture.js";
import p7A4R006 from "./fixtures/dol-control-probes/p7-a4-landscape-r006.json";

const view = actuation("R1", "top-to-bottom");
const request = {
  format: "schematic-packet-request/0.1",
  page: { size: "tabloid", orientation: "landscape", marginMm: 20 },
  views: [view],
} as const satisfies SchematicPacketRequest;
const compactPresentation = {
  format: "project-presentation/0.3",
  revision: "UNSPECIFIED",
  backgroundColor: "#ffffff",
  titleBlockLines: [],
} as const;

afterEach(() => vi.restoreAllMocks());

async function withFixture(
  name: "p5" | "p7",
  test: (ir: ElectricalIr) => Promise<void>,
) {
  const fixture = await dolProbeFixture(name);
  try {
    await test(fixture.ir);
  } finally {
    await fixture.dispose();
  }
}

async function withoutProposal<T>(render: () => Promise<T>) {
  const stub = vi
    .spyOn(pagination, "retryRootedPagination")
    .mockResolvedValue(undefined);
  try {
    return await render();
  } finally {
    stub.mockRestore();
  }
}

it("retains the entire base R006 when the reflow still fails on A4", async () => {
  await withFixture("p7", async (ir) => {
    const retry = vi.spyOn(pagination, "retryRootedPagination");
    const result = await renderSchematicPacket(ir, {
      ...request,
      page: { size: "a4", orientation: "landscape", marginMm: 10 },
    });
    expect(retry).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: p7A4R006 });
  });
});

it.each(["no-card grid", "composition", "annotated scale", "no-card scale"])(
  "retains the original R006 when the proposal fails the %s check",
  async (check) => {
    await withFixture("p5", async (ir) => {
      const render = () => renderSchematicPacket(ir, request);
      const original = await withoutProposal(render);
      assert.ok(!original.ok && original.error.details?.boundaryCutRetry);
      const proposals = new Map<PreparedSchematicDrawing, boolean>(),
        repaginate = prepared.repaginateDrawing;
      vi.spyOn(prepared, "repaginateDrawing").mockImplementation(
        async (...args) => {
          const result = await repaginate(...args);
          if (result.ok) proposals.set(result.value, args[0] !== args[1]);
          return result;
        },
      );
      const rejected = vi.fn();
      if (check === "no-card grid") {
        const candidates = build.buildRootedCandidates;
        vi.spyOn(build, "buildRootedCandidates").mockImplementation(
          (...args) => {
            if (args[4] && proposals.get(args[1])) {
              rejected();
              return { ok: false, error: original.error };
            }
            return candidates(...args);
          },
        );
      } else if (check === "composition") {
        const composition = fit.compositionFits;
        vi.spyOn(fit, "compositionFits").mockImplementation((...args) => {
          if (proposals.has(args[0].prepared)) {
            rejected();
            return false;
          }
          return composition(...args);
        });
      } else {
        const space = build.rootedSpace;
        vi.spyOn(build, "rootedSpace").mockImplementation((...args) => {
          const result = space(...args);
          if (proposals.get(args[0]) !== (check === "no-card scale"))
            return result;
          rejected();
          return { ...result, scale: 0.3 };
        });
      }
      expect(await render()).toEqual(original);
      expect(rejected).toHaveBeenCalled();
    });
  },
);

it("retains the first view's original refusal when a later view makes the packet fail", async () => {
  await withFixture("p5", async (ir) => {
    const later = actuation("No such device", "top-to-bottom");
    const combined = { ...request, views: [view, later] };
    const original = await withoutProposal(() =>
      renderSchematicPacket(ir, combined),
    );
    assert.ok(!original.ok && original.error.details?.boundaryCutRetry);
    const laterOnly = await renderSchematicPacket(ir, {
      ...request,
      views: [later],
    });
    assert.ok(!laterOnly.ok && laterOnly.error.code !== original.error.code);
    const retry = vi.spyOn(pagination, "retryRootedPagination");
    expect(await renderSchematicPacket(ir, combined)).toEqual(original);
    expect(await retry.mock.results[0]?.value).toBeDefined();
  });
});

it("only tries the tighter placement on the legacy reference page of a compact frame", async () => {
  await withFixture("p5", async (ir) => {
    const retry = vi.spyOn(pagination, "retryRootedPagination");
    const result = await renderSchematicPacket(
      ir,
      request,
      compactPresentation,
    );
    assert.ok(result.ok, JSON.stringify(result));
    expect(retry.mock.calls.map(([, , page]) => hasCompactFrame(page))).toEqual(
      [false],
    );
    expect(
      result.value.coverage.diagnostics?.filter((d) => d.code === "I906"),
    ).toHaveLength(1);
  });
});

it("retains the legacy R006 if compact-frame placement fails after reflow", async () => {
  await withFixture("p5", async (ir) => {
    const render = () =>
      renderSchematicPacket(ir, request, compactPresentation);
    const original = await withoutProposal(render);
    assert.ok(!original.ok && original.error.details?.boundaryCutRetry);
    const budget = frame.frameBudgetFailure;
    vi.spyOn(frame, "frameBudgetFailure").mockImplementation((...args) =>
      frame.frameContext(args[1], args[0].prepared.view)?.reference?.drafts[0]
        ?.rootedPaginationFailure
        ? "drawing-field-loss"
        : budget(...args),
    );
    const place = placement.legacyFramePlacement;
    const fallback = vi
      .spyOn(placement, "legacyFramePlacement")
      .mockImplementation((...args) =>
        args[0].drafts[0]?.rootedPaginationFailure
          ? {
              ok: false,
              error: {
                code: "R006",
                root: "packet",
                reason: "unprintable-layout",
                message:
                  "Compact frame has no compatible within-budget placement.",
              },
            }
          : place(...args),
      );
    expect(await render()).toEqual(original);
    expect(fallback).toHaveBeenCalled();
  });
});
