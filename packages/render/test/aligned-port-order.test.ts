import { expect, it } from "vitest";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import { circuitPortOrderGuard } from "../src/layout/circuit-port-order.js";

function graph(dx: number, dy: number, shift = 0): ElkNode {
  return {
    id: "native-graph",
    children: [
      {
        id: "native-a",
        x: shift,
        y: shift,
        ports: [{ id: "native-port-a", x: 0, y: 0 }],
      },
      {
        id: "native-b",
        x: shift + dx,
        y: shift + dy,
        ports: [{ id: "native-port-b", x: 0, y: 0 }],
      },
    ],
  };
}
const groups = [["native-port-a", "native-port-b"]];
it.each(["x", "y"] as const)(
  "preserves original alignment on %s under coherent translation",
  (axis) => {
    const x = axis === "x" ? 0 : 20,
      y = axis === "y" ? 0 : 20;
    expect(circuitPortOrderGuard(graph(x, y, 50), graph(x, y), groups)).toBe(
      true,
    );
  },
);
it.each(["x", "y"] as const)(
  "rejects splitting originally aligned ports in either %s order",
  (axis) => {
    const x = axis === "x" ? 0 : 20,
      y = axis === "y" ? 0 : 20;
    for (const split of [-0.1, 0.1])
      expect(
        circuitPortOrderGuard(
          graph(axis === "x" ? split : x, axis === "y" ? split : y),
          graph(x, y),
          groups,
        ),
      ).toBe(false);
  },
);
it("keeps the existing alignment tolerance and the independent orthogonal order", () => {
  expect(
    circuitPortOrderGuard(graph(0.00000009, 20), graph(0, 20), groups),
  ).toBe(true);
  expect(
    circuitPortOrderGuard(graph(0.00000011, 20), graph(0, 20), groups),
  ).toBe(false);
  expect(circuitPortOrderGuard(graph(0, -20), graph(0, 20), groups)).toBe(
    false,
  );
});
