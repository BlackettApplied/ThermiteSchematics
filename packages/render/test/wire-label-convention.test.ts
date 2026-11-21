import { beforeAll, expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematic } from "../src/renderer.js";
import { parseHTML } from "linkedom";
import { printableTextMetrics } from "../src/text-metrics.js";
import { nativePath } from "./helpers/wire-label-support.js";
import { required } from "./fixtures.js";
let ir: Extract<Awaited<ReturnType<typeof compileProject>>, { ok: true }>["ir"];
beforeAll(async () => {
  const c = await compileProject(
    "packages/core-library/test/fixtures/dol-starter",
  );
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
});
function distance(
  ink: { left: number; right: number; top: number; bottom: number },
  points: readonly { x: number; y: number }[],
  stroke: number,
) {
  return Math.min(
    ...points.slice(1).map((b, i) => {
      const a = required(points[i]);
      return Math.max(
        0,
        Math.hypot(
          Math.max(
            Math.min(a.x, b.x) - stroke / 2 - ink.right,
            ink.left - Math.max(a.x, b.x) - stroke / 2,
            0,
          ),
          Math.max(
            Math.min(a.y, b.y) - stroke / 2 - ink.bottom,
            ink.top - Math.max(a.y, b.y) - stroke / 2,
            0,
          ),
        ),
      );
    }),
  );
}
it("places the unambiguous DOL TTB W34/W35 ink 0.5–1 mm beside its conductor, without redundant leaders", async () => {
  const r = await renderSchematic(ir, {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "K1" },
    family: "control",
    flow: "top-to-bottom",
  });
  if (!r.ok) throw Error(JSON.stringify(r.error));
  const doc = parseHTML(r.value.svg).document;
  const css = required(doc.querySelector("style")).textContent ?? "";
  const style = required(css.match(/\.net-path\{([^}]+)\}/u));
  const stroke = Number(
    required(required(style[1]).match(/stroke-width:([\d.]+)/u))[1],
  );
  expect(stroke).toBe(1.5);
  expect(style[1]).toContain("stroke-linecap:square");
  const paths = [...doc.querySelectorAll("path[data-wire-uid]")].map((e) => ({
    uid: e.getAttribute("data-wire-uid"),
    points: nativePath(required(e.getAttribute("d"))),
  }));
  for (const name of ["W34", "W35"]) {
    const w = required(ir.wires.find((w) => w.designation === name)),
      t = required(
        [...doc.querySelectorAll("text.label-conductor")].find(
          (t) => t.textContent === name,
        ),
      ),
      m = printableTextMetrics(name),
      x = Number(t.getAttribute("x")) - 20,
      y = Number(t.getAttribute("y")) - 20;
    const scale = t.hasAttribute("textLength")
      ? Number(t.getAttribute("textLength")) / m.advance
      : 1;
    const ink = {
      left: x + m.left * scale,
      right: x + m.right * scale,
      top: y - m.top,
      bottom: y - m.bottom,
    };
    const own =
      Math.min(
        ...paths
          .filter((p) => p.uid === w.uid)
          .map((p) => distance(ink, p.points, stroke)),
      ) * 0.25;
    const foreign =
      Math.min(
        ...paths
          .filter((p) => p.uid !== w.uid)
          .map((p) => distance(ink, p.points, stroke)),
      ) * 0.25;
    expect(own, name).toBeGreaterThanOrEqual(0.5);
    expect(own, name).toBeLessThanOrEqual(1);
    expect(foreign, name).toBeGreaterThan(own);
    expect(
      [...doc.querySelectorAll("[data-label-leader-owner]")].filter((e) =>
        required(e.getAttribute("data-label-leader-owner")).includes(w.uid),
      ),
    ).toHaveLength(0);
  }
});

it.each(["blocked leader", "blocked caption"])(
  "returns an observable R004 diagnostic for a remote ambiguous caption with %s",
  async (control) => {
    const { prepareSchematicDrawing } = await import("../src/renderer.js"),
      { emitLabelInk } = await import("../src/svg/label-ink.js"),
      { SvgWriter } = await import("../src/svg/writer.js");
    const prepared = await prepareSchematicDrawing(ir, {
      format: "schematic-view-request/0.1",
      root: { by: "designation", value: "K1" },
      family: "control",
      flow: "top-to-bottom",
    });
    if (!prepared.ok) throw Error(JSON.stringify(prepared.error));
    const p = prepared.value,
      label = required(
        p.layout.labels.find(
          (l) => l.ownerKind === "edge" && l.role === "conductor",
        ),
      );
    // Isolate this caption so an unrelated R004 cannot mask a silent failure.
    const layout = {
      ...p.layout,
      labels: [label],
      edges: p.layout.edges.map((e) => ({
        ...e,
        points:
          control === "blocked caption" && e.id !== label.ownerId
            ? Array.from({ length: 8 }, (_, i) => [
                { x: i % 2 ? p.layout.width : 0, y: label.y + i * 2 },
                { x: i % 2 ? 0 : p.layout.width, y: label.y + i * 2 },
              ]).flat()
            : [
                {
                  x: label.x + label.width + (e.id === label.ownerId ? 80 : 1),
                  y: 0,
                },
                {
                  x: label.x + label.width + (e.id === label.ownerId ? 80 : 1),
                  y: p.layout.height,
                },
              ],
      })),
    };
    const output = emitLabelInk(
      new SvgWriter(),
      label,
      label.text,
      required(p.graph.edges.find((e) => e.id === label.ownerId)?.label)
        .textLength,
      layout,
      0.25,
      {},
      p.graph.view,
    );
    expect(output.ok).toBe(false);
    if (output.ok)
      throw Error("Expected the explicit caption placement diagnostic");
    expect(output.error.code).toBe("R004");
    expect(output.error.details?.reason).toBe("ambiguous-conductor-caption");
    expect(output.error.details?.ownerId).toBe(label.ownerId);
    expect(output.error.details?.caption).toBe(label.text);
  },
);

it("retains a real leader for a necessarily ambiguous caption and binds its actual tip to the owned conductor", async () => {
  const { prepareSchematicDrawing } = await import("../src/renderer.js"),
    { emitLabelInk } = await import("../src/svg/label-ink.js"),
    { SvgWriter } = await import("../src/svg/writer.js"),
    { on } = await import("./helpers/wire-label-support.js");
  const prepared = await prepareSchematicDrawing(ir, {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "K1" },
    family: "control",
    flow: "top-to-bottom",
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw Error(JSON.stringify(prepared.error));
  const original = required(
      prepared.value.layout.labels.find(
        (l) => l.text === "W34" && l.ownerKind === "edge",
      ),
    ),
    owner = required(
      prepared.value.layout.edges.find((e) => e.id === original.ownerId),
    ),
    other = required(
      prepared.value.layout.edges.find((e) => e.id !== owner.id),
    ),
    m = printableTextMetrics("W34");
  const label = {
      ...original,
      x: 20,
      y: 10,
      width: m.right - m.left,
      height: m.top - m.bottom,
    },
    right = label.x + label.width,
    own = [
      { x: right + 5, y: 0 },
      { x: right + 5, y: 100 },
    ],
    foreign = [
      { x: label.x - 5, y: 0 },
      { x: label.x - 5, y: 100 },
    ];
  const layout = forcedLeaderLayout(
      prepared.value.layout,
      label,
      owner,
      other,
      own,
      foreign,
    ),
    writer = new SvgWriter();
  const result = emitLabelInk(
    writer,
    label,
    "W34",
    m.advance,
    layout,
    0.25,
    {},
    layout.view,
  );
  expect(result.ok).toBe(true);
  const doc = parseHTML(`<svg>${writer.finish()}</svg>`).document,
    leaders = [...doc.querySelectorAll("path.wire-label-leader")];
  expect(leaders).toHaveLength(1);
  const leader = required(leaders[0]);
  expect(leader.getAttribute("data-label-leader-owner")).toBe(owner.id);
  expect(leader.getAttribute("stroke")).toBe("#475467");
  assertLeaderTip(leader, own, foreign, on);
});

function forcedLeaderLayout(
  layout: import("../src/types.js").NormalizedSchematicLayout,
  label: import("../src/types.js").LayoutLabel,
  owner: import("../src/types.js").LayoutEdge,
  other: import("../src/types.js").LayoutEdge,
  own: { x: number; y: number }[],
  foreign: { x: number; y: number }[],
) {
  return {
    ...layout,
    width: 200,
    height: 200,
    nodes: [],
    labels: [label],
    edges: [
      { ...owner, points: own },
      { ...other, points: foreign },
    ],
  };
}

function assertLeaderTip(
  leader: Element,
  own: { x: number; y: number }[],
  foreign: { x: number; y: number }[],
  on: typeof import("./helpers/wire-label-support.js").on,
) {
  const points = nativePath(required(leader.getAttribute("d")));
  expect(on(required(points.at(-1)), own)).toBe(true);
  expect(on(required(points.at(-1)), foreign)).toBe(false);
}

it("retains the existing self-loop BRIDGE inline plate only on a complete owned vertical run clear of foreign ink", async () => {
  const { prepareCircuitView } = await import("../src/circuit.js"),
    { readFile } = await import("node:fs/promises"),
    { points } = await import("./helpers/route-quality.js"),
    c = await compileProject("examples/self-loop-labels");
  expect(c.ok).toBe(true);
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  const request = JSON.parse(
      await readFile("examples/self-loop-labels/packet.json", "utf8"),
    ).views[0],
    pending = prepareCircuitView(c.ir, { ...request, flow: "top-to-bottom" });
  await expect(pending).resolves.toHaveProperty("groups");
  const result = await pending,
    doc = parseHTML(required(result.groups[0]).content).document,
    text = required(
      [...doc.querySelectorAll("[data-wire-label] text")].find(
        (t) => t.textContent === "BRIDGE",
      ),
    ),
    plate = required(text.closest("[data-wire-label]")),
    id = required(plate.getAttribute("data-wire-label")),
    rect = required(plate.querySelector("rect")),
    m = printableTextMetrics("BRIDGE", 2.5),
    ink = {
      left: Number(text.getAttribute("x")) + m.left,
      right: Number(text.getAttribute("x")) + m.right,
      top: Number(text.getAttribute("y")) - m.top,
      bottom: Number(text.getAttribute("y")) - m.bottom,
    },
    own = points(
      required(
        required(
          doc.querySelector(
            `[data-circuit-conductor="${id}"] path[stroke="#17212b"]`,
          ),
        ).getAttribute("d"),
      ),
    );
  expect(rect.getAttribute("fill")).toBe("white");
  expect(
    own.slice(1).some((b, i) => {
      const a = required(own[i]);
      return (
        a.x === b.x &&
        a.x > ink.left &&
        a.x < ink.right &&
        Math.min(a.y, b.y) <= ink.top &&
        Math.max(a.y, b.y) >= ink.bottom
      );
    }),
  ).toBe(true);
  for (const path of doc.querySelectorAll(
    `[data-circuit-conductor]:not([data-circuit-conductor="${id}"]) path[stroke="#17212b"]`,
  ))
    expect(
      distance(
        ink,
        points(required(path.getAttribute("d"))),
        Number(path.getAttribute("stroke-width")),
      ),
    ).toBeGreaterThan(0);
});

it("propagates an unplaceable caption diagnostic through the public SVG emitter", async () => {
  const { prepareSchematicDrawing } = await import("../src/renderer.js"),
    { emitSchematicSvg } = await import("../src/svg/emitter.js");
  const prepared = await prepareSchematicDrawing(ir, {
    format: "schematic-view-request/0.1",
    root: { by: "designation", value: "K1" },
    family: "control",
    flow: "top-to-bottom",
  });
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw Error(JSON.stringify(prepared.error));
  const p = prepared.value,
    layout = {
      ...p.layout,
      edges: p.layout.edges.map((e, i) => ({
        ...e,
        points: [
          { x: p.layout.width + 80 + i * 10, y: 0 },
          { x: p.layout.width + 80 + i * 10, y: p.layout.height },
        ],
      })),
    },
    output = emitSchematicSvg(
      p.graph,
      layout,
      p.titleContext,
      undefined,
      false,
      0.25,
      ir,
    );
  expect(output.ok).toBe(false);
  if (output.ok) throw Error("Expected the emitted caption diagnostic");
  expect(output.error.code).toBe("R004");
  expect(output.error.details?.reason).toBe("ambiguous-conductor-caption");
});
