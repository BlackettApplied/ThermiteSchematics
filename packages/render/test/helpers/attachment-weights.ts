import { expect } from "vitest";
import { parseHTML } from "linkedom";

/** Independent ink oracle: match each ray to its routed visual face, not just its terminal. */
export function assertRayWeights(content: string) {
  const doc = parseHTML(content).document;
  const routes = [...doc.querySelectorAll("[data-circuit-conductor]")];
  const rays = [...doc.querySelectorAll("[data-terminal-attachment]")];
  expect(rays.length).toBeGreaterThan(0);
  for (const ray of rays) {
    let port = ray.getAttribute("data-layout-port");
    if (!port) {
      const from = JSON.parse(ray.getAttribute("data-attachment-from")!);
      const owner = ray.getAttribute("data-terminal-attachment");
      const faces = [
        ...ray
          .closest("[data-layout-width]")!
          .querySelectorAll("[data-terminal-id][data-layout-port]"),
      ].filter((p) => {
        const circle = p.querySelector("circle")!;
        return (
          p.getAttribute("data-terminal-id") === owner &&
          Math.abs(Number(circle.getAttribute("cx")) - from.x) < 0.001 &&
          Math.abs(Number(circle.getAttribute("cy")) - from.y) < 0.001
        );
      });
      expect(faces, `unique visual face for ${owner}`).toHaveLength(1);
      port = faces[0]!.getAttribute("data-layout-port");
    }
    const incident = routes.filter((route) =>
      ["data-layout-source-port", "data-layout-target-port"].some(
        (key) => route.getAttribute(key) === port,
      ),
    );
    const weights = incident.flatMap((route) =>
      [...route.querySelectorAll('path[stroke="#17212b"]')].map((p) =>
        Number(p.getAttribute("stroke-width")),
      ),
    );
    expect(weights.length).toBeGreaterThanOrEqual(incident.length);
    const expected = weights.length ? Math.min(...weights) : 0.35;
    const ink = ray.querySelectorAll('path[stroke="#17212b"]');
    expect(ink.length).toBeGreaterThan(0);
    for (const path of ink)
      expect(Number(path.getAttribute("stroke-width")), `ray at ${port}`).toBe(
        expected,
      );
  }
}
