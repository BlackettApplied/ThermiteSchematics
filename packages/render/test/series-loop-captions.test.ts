import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { measureText } from "../src/text-metrics.js";
import { seriesFixture, request, uid } from "./series-loop-fixture.js";
import {
  fieldSeriesFixture,
  fieldRequest,
} from "./series-loop-library-fixture.js";

function caption(content: string, device: string) {
  const { document } = parseHTML(`<svg>${content}</svg>`),
    node = document.querySelector(`[data-device-uid="${device}"]`)!;
  return {
    width: Number(node.getAttribute("data-body-width")),
    lines: [...node.children]
      .filter((e) => e.localName === "text")
      .map((e) => e.textContent!),
  };
}

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps AI1's complete order number intact at readable size in %s",
  async (flow) => {
    const f = await fieldSeriesFixture();
    try {
      const d = await prepareSignalLoopDrawing(f.ir, { ...fieldRequest, flow }),
        c = caption(d.content, uid(4)),
        orderNumber = "6ES7134-6GD01-0BA1";
      const doc = parseHTML(`<svg>${d.content}</svg>`).document;
      expect(
        [
          ...doc.querySelectorAll(
            `[data-tag-owner-uid="${uid(4)}"][data-tag-field="part"]`,
          ),
        ]
          .map((e) => e.textContent)
          .join(""),
      ).toBe(orderNumber);
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "keeps a designation containing whitespace inside its caption box in %s",
  async (flow) => {
    const designation = "AI LONG DEVICE 1",
      f = await seriesFixture((m) => {
        m.objects.find((o) => o.designation === "AI1").designation =
          designation;
        for (const o of m.objects)
          for (const end of o.endpoints ?? [])
            if (end.device === "AI1") end.device = designation;
      });
    try {
      const d = await prepareSignalLoopDrawing(
          f.ir,
          request({ flow, to: { device: uid(3), function: "input" } }),
        ),
        c = caption(d.content, uid(3));
      expect(c.lines[0]).toBe(designation);
      expect(c.width - 6 + 0.001).toBeGreaterThanOrEqual(
        measureText(designation, 2.7).width,
      );
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "preserves every character of an overlong description in %s",
  async (flow) => {
    const orderNumber = "6ES7134-6GD01-0BA1-6ES7134-6GD01-0BA1",
      f = await seriesFixture((m) => {
        m.types[2].description = orderNumber;
      });
    try {
      const d = await prepareSignalLoopDrawing(f.ir, request({ flow })),
        doc = parseHTML(`<svg>${d.content}</svg>`).document,
        parts = [
          ...doc.querySelectorAll(
            `[data-tag-owner-uid="${uid(3)}"][data-tag-field="description"]`,
          ),
        ].map((e) => e.textContent!);
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.join("")).toBe(orderNumber);
      for (const line of parts)
        expect(measureText(line, 2.7).width).toBeLessThanOrEqual(44);
    } finally {
      await f.dispose();
    }
  },
);

it.each(["left-to-right", "top-to-bottom"] as const)(
  "wraps uninterrupted description tokens without losing characters in %s",
  async (flow) => {
    const f = await seriesFixture((m) => {
      m.types[2].description = "X".repeat(40);
    });
    try {
      const d = await prepareSignalLoopDrawing(f.ir, request({ flow }));
      const doc = parseHTML(`<svg>${d.content}</svg>`).document;
      const rows = [
        ...doc.querySelectorAll(
          `[data-tag-owner-uid="${uid(3)}"][data-tag-field="description"]`,
        ),
      ];
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.map((e) => e.textContent).join("")).toBe("X".repeat(40));
    } finally {
      await f.dispose();
    }
  },
);
