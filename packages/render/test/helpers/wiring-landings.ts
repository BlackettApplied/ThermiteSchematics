import { expect } from "vitest";
import type { parseHTML } from "linkedom";
import type { ElectricalIr, TerminalId } from "@thermite/compiler";
import { required } from "../fixtures.js";
import { points } from "./route-quality.js";

export type Point = { x: number; y: number };
function physicalMark(
  doc: ReturnType<typeof parseHTML>["document"],
  terminal: TerminalId,
) {
  const body = required(
    doc.querySelector(`[data-device-uid="${terminal.deviceUid}"]`),
  );
  const marks = [
    ...body.querySelectorAll(
      `circle[data-terminal-key="${terminal.terminalKey}"]`,
    ),
  ].filter(
    (m) =>
      Number(m.getAttribute("r")) > 0 &&
      (m.getAttribute("fill") !== "none" ||
        (m.hasAttribute("stroke") && m.getAttribute("stroke") !== "none")),
  );
  expect(marks).toHaveLength(1);
  const mark = required(marks[0]);
  const shift = required(
    required(body.getAttribute("transform")).match(
      /translate\(([-\d.]+) ([-\d.]+)\)/u,
    ),
  );
  return {
    x: Number(shift[1]) + Number(mark.getAttribute("cx")),
    y: Number(shift[2]) + Number(mark.getAttribute("cy")),
    radius: Number(mark.getAttribute("r")),
  };
}
export function physicalRoutes(
  doc: ReturnType<typeof parseHTML>["document"],
  ir: Readonly<ElectricalIr>,
) {
  return [...doc.querySelectorAll("g[data-wiring-conductor]")].map((g) => {
    const id = required(g.getAttribute("data-wiring-conductor"));
    const wire = required(ir.wires.find((w) => w.uid === id));
    expect(
      required(required(g.querySelector("title")).textContent).startsWith(
        wire.designation,
      ),
    ).toBe(true);
    expect(g.querySelectorAll("path")).toHaveLength(1);
    const ps = points(
      required(required(g.querySelector("path")).getAttribute("d")),
    );
    const first = required(ps[0]),
      last = required(ps.at(-1));
    const ends = wire.endpoints.map((e) => physicalMark(doc, e.terminal));
    const distance = (p: Point, mark: (typeof ends)[number]) =>
      Math.hypot(p.x - mark.x, p.y - mark.y) - mark.radius;
    const a = required(ends[0]),
      b = required(ends[1]);
    expect(
      Math.min(
        Math.max(distance(first, a), distance(last, b)),
        Math.max(distance(first, b), distance(last, a)),
      ),
    ).toBeLessThanOrEqual(0.0011);
    return {
      id,
      ends: wire.endpoints.map((e) => JSON.stringify(e.terminal)),
      ps,
    };
  });
}
export function sharedLengths(a: readonly Point[], b: readonly Point[]) {
  const lengths: number[] = [];
  for (let i = 1; i < a.length; i++)
    for (let j = 1; j < b.length; j++) {
      const p = required(a[i - 1]),
        q = required(a[i]),
        r = required(b[j - 1]),
        s = required(b[j]);
      for (const [axis, cross] of [
        ["x", "y"],
        ["y", "x"],
      ] as const) {
        if (
          Math.abs(p[cross] - q[cross]) > 1e-7 ||
          Math.abs(r[cross] - s[cross]) > 1e-7 ||
          Math.abs(p[cross] - r[cross]) > 1e-7
        )
          continue;
        const length =
          Math.min(Math.max(p[axis], q[axis]), Math.max(r[axis], s[axis])) -
          Math.max(Math.min(p[axis], q[axis]), Math.min(r[axis], s[axis]));
        if (length > 1e-7) lengths.push(length);
      }
    }
  return lengths;
}
