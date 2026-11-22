import { parseHTML } from "linkedom";
import { expect } from "vitest";
import { svgGeometry, type Point } from "./source-isolation.js";
import { visibleLinkInk } from "./visible-link-ink.js";

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a: Point, b: Point) => expect(distance(a, b)).toBeLessThan(0.001);
const role = (owner: Element, name: string) => [
  ...owner.querySelectorAll(`[data-circuit-role="${name}"]`),
];

/** Read emitted coordinates through every ancestor transform. Catalog geometry,
 * reservations and renderer orientation/state claims are not used as oracles. */
export function paintedShape(root: Element, element: Element) {
  expect(element.childElementCount).toBe(0);
  let copy = element.cloneNode(true) as Element;
  for (let p = element.parentElement; p && p !== root; p = p.parentElement) {
    const parent = p.cloneNode(false) as Element;
    parent.append(copy);
    copy = parent;
  }
  const holder = parseHTML("<svg/>").document.querySelector("svg")!;
  holder.append(copy);
  const shapes = svgGeometry(holder).shapes;
  expect(shapes).toHaveLength(1);
  expect(shapes[0]!.stroke).toBeGreaterThan(0);
  return shapes[0]!;
}

const one = (root: Element, owner: Element, name: string) => {
  const elements = role(owner, name);
  expect(elements, name).toHaveLength(1);
  return { element: elements[0]!, ink: paintedShape(root, elements[0]!) };
};
const centre = (ps: readonly Point[]) => ({
  x: (ps[0]!.x + ps.at(-1)!.x) / 2,
  y: (ps[0]!.y + ps.at(-1)!.y) / 2,
});

export function auditOperatingLink(
  root: Element,
  owner: Element,
  closed: boolean,
) {
  const link = one(root, owner, "operating-link");
  const moving = one(root, owner, "contact-moving").ink.points;
  const fixed = one(root, owner, "contact-fixed").ink.points;
  expect(link.ink.points).toHaveLength(2);
  const [a, b] = link.ink.points;
  const length = distance(a!, b!);
  expect(length).toBeGreaterThanOrEqual(3);
  const direction = { x: (b!.x - a!.x) / length, y: (b!.y - a!.y) / length };
  expect(
    Math.abs(
      (moving[0]!.x - b!.x) * direction.y - (moving[0]!.y - b!.y) * direction.x,
    ),
  ).toBeLessThan(0.001);
  expect(distance(b!, moving[0]!)).toBeLessThan(1);
  const operators = role(owner, "operator").flatMap(
    (e) => paintedShape(root, e).points,
  );
  expect(Math.min(...operators.map((p) => distance(p, a!)))).toBeLessThan(1);
  visibleLinkInk(owner, a!, b!, (e) => paintedShape(root, e));
  const state = role(owner, "contact-state");
  expect(state).toHaveLength(closed ? 1 : 0);
  if (closed) {
    const slash = paintedShape(root, state[0]!).points;
    for (const bar of [moving, fixed]) {
      const v = { x: slash[1]!.x - slash[0]!.x, y: slash[1]!.y - slash[0]!.y },
        w = { x: bar[1]!.x - bar[0]!.x, y: bar[1]!.y - bar[0]!.y },
        d = { x: bar[0]!.x - slash[0]!.x, y: bar[0]!.y - slash[0]!.y },
        cross = v.x * w.y - v.y * w.x,
        t = (d.x * w.y - d.y * w.x) / cross,
        u = (d.x * v.y - d.y * v.x) / cross;
      expect(Math.abs(cross)).toBeGreaterThan(1);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
  }
  const leads = role(owner, "lead").map((e) => paintedShape(root, e).points);
  expect(leads).toHaveLength(2);
  near(leads[0]!.at(-1)!, centre(moving));
  near(leads[1]![0]!, centre(fixed));
}

export function auditEarth(root: Element, owner: Element, anchor?: Point) {
  const lead = one(root, owner, "lead").ink.points;
  const stem = role(owner, "earth-stem").flatMap(
    (e) => paintedShape(root, e).points,
  );
  const bars = role(owner, "earth-bar")
    .map((e) => paintedShape(root, e).points)
    .sort((a, b) => a[0]!.y - b[0]!.y);
  expect(bars).toHaveLength(3);
  expect(lead).toHaveLength(2);
  if (anchor) near(lead[0]!, anchor);
  if (stem.length) {
    expect(stem).toHaveLength(2);
    near(lead[1]!, stem[0]!);
  }
  const end = stem.at(-1) ?? lead.at(-1)!;
  near(end, centre(bars[0]!));
  expect(end.y).toBeGreaterThan(lead[0]!.y);
  let previousWidth = Infinity,
    previousY = lead[0]!.y;
  for (const bar of bars) {
    expect(Math.abs(bar[1]!.y - bar[0]!.y)).toBeLessThan(0.001);
    expect(bar[0]!.y).toBeGreaterThan(previousY);
    const width = distance(bar[0]!, bar[1]!);
    expect(width).toBeLessThan(previousWidth);
    previousWidth = width;
    previousY = bar[0]!.y;
  }
  const descending = stem.length ? stem : lead;
  expect(Math.abs(descending[1]!.x - descending[0]!.x)).toBeLessThan(0.001);
}
