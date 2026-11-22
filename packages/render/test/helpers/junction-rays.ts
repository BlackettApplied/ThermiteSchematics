import { DOMParser } from "linkedom";

export const circuitDocument = (content: string) =>
  new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`,
    "image/svg+xml",
  );

/** Independent paint/ownership observer: white halos and missing routes grant no ray. */
export function nativeJunctionRays(dot: Element, document: Document) {
  const p = {
    x: Number(dot.getAttribute("cx")),
    y: Number(dot.getAttribute("cy")),
  };
  const terminal = dot.getAttribute("data-terminal-key");
  const deviceUid = dot.getAttribute("data-device-uid");
  const rays = new Set<string>();
  for (const route of document.querySelectorAll("[data-circuit-conductor]")) {
    const ends: { deviceUid: string; terminalKey: string }[] = JSON.parse(
      route.getAttribute("data-endpoints") ?? "[]",
    );
    if (
      !ends.some((e) => e.deviceUid === deviceUid && e.terminalKey === terminal)
    )
      continue;
    for (const path of route.querySelectorAll('path[stroke="#17212b"]')) {
      const n =
        (path.getAttribute("d") ?? "")
          .match(/-?\d+(?:\.\d+)?/gu)
          ?.map(Number) ?? [];
      for (let i = 2; i < n.length; i += 2) {
        const ax = n[i - 2],
          ay = n[i - 1],
          bx = n[i],
          by = n[i + 1];
        if (
          ax === undefined ||
          ay === undefined ||
          bx === undefined ||
          by === undefined
        )
          continue;
        if (
          p.x < Math.min(ax, bx) - 0.001 ||
          p.x > Math.max(ax, bx) + 0.001 ||
          p.y < Math.min(ay, by) - 0.001 ||
          p.y > Math.max(ay, by) + 0.001
        )
          continue;
        if (Math.abs(ay - by) < 0.001 && Math.abs(ay - p.y) < 0.001) {
          if (Math.min(ax, bx) < p.x - 0.56) rays.add("west");
          if (Math.max(ax, bx) > p.x + 0.56) rays.add("east");
        }
        if (Math.abs(ax - bx) < 0.001 && Math.abs(ax - p.x) < 0.001) {
          if (Math.min(ay, by) < p.y - 0.56) rays.add("north");
          if (Math.max(ay, by) > p.y + 0.56) rays.add("south");
        }
      }
    }
  }
  return [...rays].sort();
}
