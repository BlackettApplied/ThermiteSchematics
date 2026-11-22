import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { renderSchematicPacket } from "../src/sheets.js";
import { navigationGeometry } from "../src/packet/navigation-walk.js";
import { printableTextMetrics } from "../src/text-metrics.js";
import type { SvgNode } from "../src/device-legend/svg-tree.js";

type Box = { x: number; y: number; w: number; h: number };
function projected(b: Box, m: readonly number[]): Box {
  const points = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([x, y]) => ({
    x: m[0]! * x! + m[2]! * y! + m[4]!,
    y: m[1]! * x! + m[3]! * y! + m[5]!,
  }));
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    w: Math.max(...points.map((p) => p.x)) - x,
    h: Math.max(...points.map((p) => p.y)) - y,
  };
}
const gap = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(a.x - b.x - b.w, b.x - a.x - a.w, 0),
    Math.max(a.y - b.y - b.h, b.y - a.y - a.h, 0),
  );

it("keeps all self-loop LTR repeat ink nearest its own drawn frame or self-locates", async () => {
  const c = await compileProject("examples/self-loop-labels");
  if (!c.ok) throw Error(JSON.stringify(c));
  const request = JSON.parse(
    await readFile("examples/self-loop-labels/packet.json", "utf8"),
  );
  const r = await renderSchematicPacket(c.ir, request, c.presentation);
  if (!r.ok) throw Error(JSON.stringify(r.error));
  const nav = r.value.navigation!;
  expect(nav.annotations).toHaveLength(4);
  for (const sheet of r.value.sheets) {
    const all = navigationGeometry(sheet.svg),
      parents = new Map<SvgNode, SvgNode>();
    for (const g of all)
      for (const child of g.node.children) parents.set(child, g.node);
    const ancestor = (node: SvgNode, key: string): string | undefined => {
      for (let n: SvgNode | undefined = node; n; n = parents.get(n))
        if (n.attrs[key]) return n.attrs[key];
      return undefined;
    };
    // Scan native rects flat, independently of frameCandidates' group traversal.
    const frames = all
      .filter(
        (g) =>
          g.node.name === "rect" &&
          /device-frame/.test(g.node.attrs.class ?? ""),
      )
      .map((g) => ({
        uid: ancestor(g.node, "data-device-uid"),
        box: projected(
          {
            x: +(g.node.attrs.x ?? 0),
            y: +(g.node.attrs.y ?? 0),
            w: +g.node.attrs.width!,
            h: +g.node.attrs.height!,
          },
          g.matrix,
        ),
      }));
    for (const a of nav.annotations.filter(
      (a) =>
        nav.reservations.find((s) => s.id === a.reservationId)!.allocatedMm!
          .sheet === sheet.number,
    )) {
      const tag = ["S1", "D1"].find((tag) => a.text.startsWith(tag))!;
      const uid = c.ir.devices.find((d) => d.designation === tag)!.uid;
      const lines = all.filter(
        (g) =>
          g.node.name === "text" &&
          ancestor(g.node, "data-navigation-annotation") === a.id,
      );
      expect(lines.length).toBeGreaterThan(0);
      const boxes = lines.map((g) => {
        const m = printableTextMetrics(
          g.node.text,
          +g.node.attrs["font-size"]!,
        );
        return projected(
          {
            x: +g.node.attrs.x! + m.left,
            y: +g.node.attrs.y! - m.top,
            w: m.right - m.left,
            h: m.top - m.bottom,
          },
          g.matrix,
        );
      });
      const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
      const ink = {
        x,
        y,
        w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
        h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
      };
      const own = frames.find((f) => f.uid === uid)!;
      expect(own).toBeDefined();
      if (a.locality!.mode === "local") {
        for (const f of frames.filter((f) => f !== own))
          expect(gap(ink, own.box)).toBeLessThan(gap(ink, f.box) - 0.001);
      } else
        expect(a.text.replace(/\n/g, " ")).toContain(
          `${tag} (${String(sheet.number).padStart(2, "0")}.${tag === "S1" ? "A1" : "A2"}):`,
        );
    }
  }
});
