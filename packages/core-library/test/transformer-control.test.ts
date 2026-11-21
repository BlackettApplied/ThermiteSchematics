import { reviewedTransformerInk } from "../../render/test/helpers/transformer-endpoint-ink.js";
import { assertRayWeights } from "../../render/test/helpers/attachment-weights.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { compileProject, analyzeCompleteness } from "@thermite/compiler";
import { prepareCircuitView } from "../../render/src/circuit.js";
import { renderSchematic } from "../../render/src/renderer.js";
import {
  transformerRoot,
  transformerFlows,
  transformerRequest,
} from "../../render/test/transformer-control-fixture.js";
import p7 from "./fixtures/transformer-control/p7-diagnostics.json";
import { dolProbeFixture } from "../../render/test/dol-control-probes-fixture.js";
import { circuitDocument } from "../../render/test/helpers/junction-rays.js";
import { captionInk } from "../../render/src/symbols/caption-ink.js";

it.each(transformerFlows)(
  "uses shipped unrated facts and preserves the complete circuit in %s",
  async (flow) => {
    const c = await compileProject(transformerRoot);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    expect(c.diagnostics).toEqual([]);
    expect(c.ir.devices.some((d) => d.designation === "K1")).toBe(false);
    const source = JSON.parse(
      await readFile(join(transformerRoot, "source.json"), "utf8"),
    );
    expect(JSON.stringify(source)).not.toMatch(/"rating"/);
    for (const id of [
      "core:control-transformer",
      "core:relay-1co",
      "core:pilot-light",
    ]) {
      const t = c.ir.deviceTypes.find((t) => t.id === id)!;
      expect(t.terminals.every((t) => t.rating === undefined)).toBe(true);
    }
    expect(
      analyzeCompleteness(c.ir).findings.filter((f) =>
        ["W903", "W904"].includes(f.code),
      ),
    ).toEqual([]);
    const functions = [
      ["XT1", "terminal1"],
      ["XT1", "terminal2"],
      ["T1", "primary"],
      ["T1", "secondary"],
      ["R1", "coil"],
      ["H1", "lamp"],
    ].map(([value, key]) => ({
      device: { by: "designation" as const, value: value! },
      key: key!,
    }));
    const view = await prepareCircuitView(c.ir, {
      format: "circuit-view-request/0.1",
      title: "Unrated transformer control",
      flow,
      groups: [
        {
          id: "unrated-control",
          label: "Unrated secondary, coil and indication",
          functions,
          conductors: ["W1", "W2", "W3", "W4", "W5", "W6"],
        },
      ],
    });
    expect(view.groups[0]!.coverage.conductorIds).toHaveLength(6);
    expect(view.groups[0]!.coverage.functionIds).toHaveLength(6);
    // Pin the geometry after measuring caption and terminal widths with Noto.
    // The physical frame and attachment ink are asserted separately.
    const reviewedContent = reviewedTransformerInk(view.groups[0]!.content);
    expect(view.groups[0]!.content).toContain('data-layout-source-port="');
    // Normalize attachment style for the geometry hash after checking the ink.
    assertRayWeights(view.groups[0]!.content);
    const originalOutlineInk = reviewedContent
      .replace(
        /(<g data-terminal-attachment="[^"]*" data-attachment-from="[^"]*" data-attachment-to="[^"]*"><path [^>]+stroke="white"[^>]*\/><path [^>]+stroke="#17212b" stroke-width=")[^"]+(?=")/gu,
        "$1.35",
      )
      .replace(
        /(<rect class="circuit-device-frame"[^>]*?)stroke="#667085" stroke-width="0.25"/gu,
        '$1stroke="#17212b" stroke-width="0.4"',
      )
      .replace(
        /(<g data-terminal-attachment="[^"]*" data-attachment-from="[^"]*" data-attachment-to="[^"]*"><path [^>]*fill="none") stroke="#17212b" stroke-width="0.32"/gu,
        '$1 stroke="#344054" stroke-width="0.3"',
      );
    expect(originalOutlineInk).not.toBe(reviewedContent);
    expect(createHash("sha256").update(originalOutlineInk).digest("hex")).toBe(
      flow === "left-to-right"
        ? "a46ca5c69f56240d3927fb60b2406c62c01ae652dac0ccd1525204cb0361f19b"
        : "0839400dd0b1eac2dc575a7a64dacbbcd1b79631d47e201973cead3a6dfa9f60",
    );
    const r = await renderSchematic(c.ir, transformerRequest(flow));
    expect(r.ok, JSON.stringify(r)).toBe(true);
  },
);
it("reserves painted winding clearance for the suffixed secondary label", async () => {
  const compiled = await compileProject(transformerRoot);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const view = await prepareCircuitView(compiled.ir, {
    format: "circuit-view-request/0.1",
    title: "Partial transformer control",
    flow: "left-to-right",
    groups: [
      {
        id: "without-indicator",
        label: "Primary and relay",
        functions: [
          ["XT1", "terminal1"],
          ["XT1", "terminal2"],
          ["T1", "primary"],
          ["T1", "secondary"],
          ["R1", "coil"],
        ].map(([value, key]) => ({
          device: { by: "designation", value: value! },
          key: key!,
        })),
        conductors: ["W1", "W2", "W3", "W4"],
      },
    ],
  });
  const document = circuitDocument(view.groups[0]!.content);
  const label = document.querySelector('g[data-terminal-key="X2"] > text')!;
  expect(label.textContent).toBe("X2 [+1]");
  const body = document.querySelector(
    '[data-function-key="secondary"] [data-circuit-mark="winding"] polyline',
  )!;
  const [, , , , corner] = body.getAttribute("points")!.split(" ");
  const shoulder = Number(corner!.split(",")[0]);
  // With 1 mm rise and 1.6 mm run, the outer miter of this 0.4 mm stroke
  // extends sqrt(1 + 1.6²) × 0.20 mm past the nominal winding shoulder.
  const miter = shoulder + 0.2 * Math.hypot(1, 1.6);
  const ink = captionInk(
    label.textContent!,
    Number(label.getAttribute("x")),
    Number(label.getAttribute("y")),
    Number(label.getAttribute("font-size")),
    "end",
  );
  expect(ink.left - miter).toBeGreaterThanOrEqual(0.55);
});

it("keeps P7 validate-only with its exact current I305 diagnostic", async () => {
  const fixture = await dolProbeFixture("p7");
  try {
    expect(fixture.diagnostics).toEqual(p7);
  } finally {
    await fixture.dispose();
  }
});
