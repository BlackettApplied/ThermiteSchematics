import { expect } from "vitest";
import { parseHTML } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import type { prepareSchematicDrawing } from "../../src/renderer.js";
import { emitSchematicSvg } from "../../src/svg/emitter.js";
import { svgSemanticId } from "../../src/svg/escape.js";
import { printableTextMetrics } from "../../src/text-metrics.js";
import type {
  LayoutLabel,
  LayoutEdge,
  NormalizedSchematicLayout,
} from "../../src/types.js";
import { required } from "../fixtures.js";
import {
  nativePath,
  on,
  printedCaptionSupport,
  foreignRoutes,
} from "./wire-label-support.js";
import { points } from "./route-quality.js";
import { hasSourceCaption } from "./source-caption.js";
type Prepared = Extract<
  Awaited<ReturnType<typeof prepareSchematicDrawing>>,
  { ok: true }
>["value"];
type Document = ReturnType<typeof parseHTML>["document"];
type Element = NonNullable<ReturnType<Document["querySelector"]>>;

function assertNativeContext(
  label: LayoutLabel,
  doc: Document,
  layout: NormalizedSchematicLayout,
) {
  const reference = required(
    layout.contextReferences?.find((r) => r.id === label.ownerId),
  );
  expect(reference.leaders).toHaveLength(2);
  const group = required(
    doc.querySelector(
      `[data-edge-key="${svgSemanticId("edge", [reference.id])}"]`,
    ),
  );
  expect(group.querySelectorAll("path.context-reference-leader")).toHaveLength(
    2,
  );
}
function assertWireCaption(
  label: LayoutLabel,
  text: Element,
  owner: LayoutEdge,
  doc: Document,
  key: string,
  layout: NormalizedSchematicLayout,
) {
  const physical = required(
    doc.querySelector(`[data-edge-key="${svgSemanticId("edge", [owner.id])}"]`),
  );
  const route = nativePath(required(physical.getAttribute("d")));
  expect(route).toEqual(
    owner.points.map((p) => ({
      x: Number(p.x.toFixed(3)),
      y: Number(p.y.toFixed(3)),
    })),
  );
  const m = printableTextMetrics(required(text.textContent)),
    scale = text.hasAttribute("textLength")
      ? Number(text.getAttribute("textLength")) / m.advance
      : 1,
    x = Number(text.getAttribute("x")) - 20,
    y = Number(text.getAttribute("y")) - 20;
  const association = printedCaptionSupport(
    {
      left: x + m.left * scale,
      right: x + m.right * scale,
      top: y - m.top,
      bottom: y - m.bottom,
    },
    route,
    foreignRoutes(doc, layout, owner.id),
  );
  const supported = association.supported;
  expect(association.clear, key + " " + text.textContent).toBe(true);
  expect(Number(text.getAttribute("font-size"))).toBe(10);
  const leaders = [...doc.querySelectorAll("[data-label-leader-owner]")].filter(
    (e) =>
      !supported &&
      e.getAttribute("data-label-leader-owner") === label.ownerId &&
      e.nextElementSibling?.nextElementSibling?.nextElementSibling === text,
  );
  expect(leaders, key + " " + text.textContent).toHaveLength(
    Number(!supported),
  );
  for (const actual of leaders) {
    expect(actual.getAttribute("stroke")).toBe("#475467");
    expect(actual.getAttribute("stroke-width")).toBe("0.5");
    expect(actual.closest("[data-wire-uid],.net-group")).toBeNull();
    const ps = points(required(actual.getAttribute("d"))).map((p) => ({
      x: p.x - 20,
      y: p.y - 20,
    }));
    expect(on(required(ps.at(-1)), route), key + " " + text.textContent).toBe(
      true,
    );
  }
}
export function assertRootedCaptionCensus(
  prepared: Prepared,
  ir: ElectricalIr,
  key: string,
) {
  const { graph, layout, titleContext } = prepared,
    emitted = emitSchematicSvg(
      graph,
      layout,
      titleContext,
      undefined,
      false,
      0.25,
      ir,
    );
  if (!emitted.ok) throw Error(JSON.stringify(emitted.error));
  const doc = parseHTML(emitted.value).document;
  const labels = layout.labels
    .filter((l) => l.ownerKind === "edge")
    .map((label) => ({
      label,
      text: required(
        doc.querySelector(
          `text[clip-path="url(#${svgSemanticId("clip", [label.id])})"]`,
        ),
      ),
    }));
  const captions = labels.filter(({ text }) => Boolean(text.textContent));
  const railReplacements = labels.filter(({ label, text }) => {
    if (text.textContent || label.role !== "net") return false;
    const edge = graph.edges.find((e) => e.id === label.ownerId);
    return (
      edge &&
      hasSourceCaption(
        graph,
        edge,
        label.text,
        ir,
        (id) =>
          doc.querySelector(
            `text[clip-path="url(#${svgSemanticId("clip", [id])})"]`,
          )?.textContent,
        "rail",
      )
    );
  });
  const owned = captions.filter(({ label }) =>
      layout.edges.some((e) => e.id === label.ownerId),
    ),
    contexts = captions.filter(
      ({ label }) => !layout.edges.some((e) => e.id === label.ownerId),
    );
  expect(owned.length + contexts.length).toBe(captions.length);
  for (const { label, text } of owned)
    assertWireCaption(
      label,
      text,
      required(layout.edges.find((e) => e.id === label.ownerId)),
      doc,
      key,
      layout,
    );
  for (const { label } of contexts) assertNativeContext(label, doc, layout);
  return {
    count: captions.length,
    railReplacements: railReplacements.length,
    nativeContexts: contexts.length,
  };
}
