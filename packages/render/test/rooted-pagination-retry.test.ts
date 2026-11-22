import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { RenderSummary } from "../src/types.js";
import type { RenderedSheet } from "../src/packet/types.js";
import { ELK_OPTIONS } from "../src/layout/options.js";
import {
  nativeDrawing,
  repaginateDrawing,
  repositionDrawing,
} from "../src/off-view/prepared.js";
import { normalizePaperPage } from "../src/packet/page.js";
import { buildRootedCandidates } from "../src/packet/rooted-build.js";
import { retryRootedPagination } from "../src/packet/rooted-pagination-retry.js";
import { searchRootedCandidates } from "../src/packet/rooted-search.js";
import {
  prepareSchematicDrawing,
  type PreparedSchematicDrawing,
} from "../src/renderer.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { agentRefusalFixture, sensorTrace } from "./agent-refusals-fixture.js";
import { actuation } from "./dol-control-junctions-fixture.js";
import { dolProbeFixture } from "./dol-control-probes-fixture.js";
import { observedRecoveryEngine } from "./helpers/agent-recovery.js";

const page = {
  size: "tabloid",
  orientation: "landscape",
  marginMm: 20,
} as const;
const packet = { format: "schematic-packet-request/0.1", page } as const;
const view = actuation("R1", "top-to-bottom");

it("reflows a neutral actuation view after a measured spacing failure", async () => {
  const fixture = await dolProbeFixture("p5");
  try {
    const before = JSON.stringify(fixture.ir);
    const paper = normalizePaperPage(page);
    assert.ok(paper.ok);
    const observed = observedRecoveryEngine();
    const prepared = await prepareSchematicDrawing(
      fixture.ir,
      view,
      undefined,
      {
        layoutEngine: observed.engine,
        packetContinuations: true,
      },
    );
    assert.ok(prepared.ok);
    const drawing = prepared.value;
    const old = buildRootedCandidates(fixture.ir, drawing, paper.value);
    assert.ok(!old.ok && old.paginationSpacing);
    expect(old.constraint?.kind).toBe("grid");
    const spacing = old.paginationSpacing;
    expect(spacing.axes).toEqual(["height"]);
    const originalInput = observed.inputs.at(-1);
    assert.ok(originalInput);
    const attemptCount = observed.inputs.length;
    const changed = await repaginateDrawing(drawing, drawing, spacing);
    assert.ok(changed.ok);
    expect(observed.inputs.length).toBe(attemptCount + 1);
    expectOnlyLayerSpacingChanged(
      originalInput,
      observed.inputs.at(-1),
      spacing.parentId,
    );
    const noCards = await nativeDrawing(drawing);
    assert.ok(noCards.ok);
    await expectReusableDrawing(changed.value, noCards.value);
    const nativeProposal = await repaginateDrawing(
      noCards.value,
      drawing,
      spacing,
    );
    assert.ok(nativeProposal.ok);
    const plans = buildRootedCandidates(
      fixture.ir,
      nativeProposal.value,
      paper.value,
      undefined,
      true,
    );
    assert.ok(plans.ok);
    expect(plans.value.every((plan) => plan.scale === 0.25)).toBe(true);

    const result = await renderSchematicPacket(fixture.ir, {
      ...packet,
      views: [view],
      index: true,
    });
    assert.ok(result.ok, JSON.stringify(result));
    expectReflowDiagnostic(result.value);
    expect(result.value.navigation?.occurrences.length).toBeGreaterThan(0);
    expectPrintedWiresAndContinuations(
      result.value.sheets,
      drawing.summary.conductiveElementIds,
    );
    expect(JSON.stringify(fixture.ir)).toBe(before);
  } finally {
    await fixture.dispose();
  }
});

async function expectReusableDrawing(
  proposal: PreparedSchematicDrawing,
  noCards: PreparedSchematicDrawing,
) {
  const moved = await repositionDrawing(proposal, {});
  assert.ok(moved.ok);
  expect(moved.value.summary).toEqual(proposal.summary);
  const proposalWithoutCards = await nativeDrawing(proposal);
  expect(proposalWithoutCards).toEqual({ ok: true, value: noCards });
}

function expectReflowDiagnostic(
  packet: import("../src/packet/types.js").RenderedPacket,
) {
  const message =
    'View 1 "R1 / control": A tighter top-to-bottom placement was used during pagination.';
  expect(packet.coverage.diagnostics).toContainEqual(
    expect.objectContaining({ code: "I906", severity: "info", message }),
  );
  for (const { svg } of packet.sheets)
    expect(svg).not.toMatch(/I906|A tighter top-to-bottom placement/);
}

it("recovers a power view by tightening spacing along an oversized protected width", async () => {
  const fixture = await compileProject("examples/machine-demo");
  assert.ok(fixture.ok);
  const view = {
    ...actuation("M1", "top-to-bottom"),
    family: "power",
  } as const;
  const paper = normalizePaperPage({
    size: "tabloid",
    orientation: "portrait",
    marginMm: 25,
  });
  assert.ok(paper.ok);
  const search = await searchRootedCandidates(
    fixture.ir,
    view,
    undefined,
    paper.value,
    false,
  );
  const proposal = search.paginationRetry;
  assert.ok(proposal);
  expect(proposal.spacing).toEqual({ axes: ["width"] });
  expect(search.diagnostics).toContainEqual(
    expect.objectContaining({
      constraint: expect.objectContaining({ kind: "protected-span" }),
    }),
  );
  const ordinary = buildRootedCandidates(
    fixture.ir,
    proposal.annotated,
    paper.value,
  );
  expect(ordinary).toMatchObject({
    ok: false,
    constraint: { kind: "protected-span" },
  });
  const reflowed = await retryRootedPagination(
    fixture.ir,
    proposal,
    paper.value,
    0,
  );
  assert.ok(reflowed);
  expect(reflowed.winner.scale).toBe(0.25);
  expect(reflowed.native.scale).toBe(0.25);
  expect(reflowed.winner.prepared.layout.width).toBeLessThan(
    proposal.annotated.layout.width,
  );
  expect(reflowed.winner.prepared.summary).toEqual(proposal.annotated.summary);
});

function expectOnlyLayerSpacingChanged(
  original: ElkNode,
  candidate: ElkNode | undefined,
  parentId: string | undefined,
) {
  const proposalInput = structuredClone(candidate);
  const parent = proposalInput?.children?.find(({ id }) => id === parentId);
  assert.ok(parent?.layoutOptions);
  const option = ELK_OPTIONS.nodeNodeBetweenLayersSpacing;
  expect(Number(parent.layoutOptions[option])).toBeLessThan(56);
  parent.layoutOptions[option] = "56";
  expect(proposalInput).toEqual(original);
}

function expectPrintedWiresAndContinuations(
  sheets: readonly RenderedSheet[],
  selected: RenderSummary["conductiveElementIds"],
) {
  const printed = new Set(
    sheets.flatMap(({ svg }) =>
      Array.from(
        svg.matchAll(/<path [^>]*\bdata-wire-uid="([^"]+)"/g),
        (match) => match[1],
      ),
    ),
  );
  expect(printed).toEqual(
    new Set(selected.map((id) => (id.kind === "wire" ? id.uid : undefined))),
  );
  expectReciprocalContinuations(sheets, printed);
}
function expectReciprocalContinuations(
  sheets: readonly RenderedSheet[],
  printed: Set<string | undefined>,
) {
  expect(sheets.flatMap((sheet) => sheet.continuations).length).toBeGreaterThan(
    0,
  );
  for (const sheet of sheets)
    for (const link of sheet.continuations) {
      expect(link.provenance?.kind).toBe("wire");
      expect(
        printed.has(
          link.provenance?.kind === "wire" ? link.provenance.uid : undefined,
        ),
      ).toBe(true);
      expect(sheets[link.toSheet - 1]?.continuations).toContainEqual(
        expect.objectContaining({
          id: link.id,
          toSheet: sheet.number,
          provenance: link.provenance,
          end: 1 - (link.end ?? 0),
        }),
      );
    }
}

it.each(["sensor", "sensor-wire"] as const)(
  "retains R006 when the proposed %s cuts are still too close",
  async (name) => {
    const fixture = await agentRefusalFixture(name);
    try {
      const result = await renderSchematicPacket(fixture.ir, {
        ...packet,
        page: { ...page, marginMm: 10 },
        views: [{ ...sensorTrace, flow: "top-to-bottom" }],
      });
      assert.ok(!result.ok);
      expect(result.error).toMatchObject({
        code: "R006",
        reason: "unprintable-layout",
      });
      expect(result.error.message).toContain("3/18 mm continuation spacing");
      expect(result.error.message).toContain("CB1.1");
    } finally {
      await fixture.dispose();
    }
  },
);
