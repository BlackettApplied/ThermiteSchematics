import { expect, it } from "vitest";
import { createTerminalIr } from "../../query/test/fixtures.js";
import { appendPinRows } from "../src/signal-loop/pin-rows.js";
import { measureText, wrapText } from "../src/text-metrics.js";
import { wrapCaptionQualifier } from "../src/signal-loop/caption-qualifier.js";

it("keeps the authored slash qualifier with its caption without adding height", () => {
  const ir = createTerminalIr([
    { uid: "caption-owner", designation: "PT1", terminalKeys: ["2"] },
  ]);
  const type = ir.deviceTypes[0];
  if (!type?.terminals[0]) throw Error("Missing fixture terminal");
  type.terminals[0].key = "2";
  type.terminals[0].description = "Loop return / I";
  const value = "2: Loop return / I";
  const width = measureText("2: Loop return /", 2.7).width + 0.01;
  const original = wrapText(value, width, 2.7);
  expect(original.at(-1)?.trim()).toBe("I");
  const caption: string[] = [];
  const rows = appendPinRows(caption, type, ["2"], "caption-owner", width);
  expect(caption.at(-1)?.trim()).toBe("return / I");
  expect(caption.join(" ").replace(/\s+/gu, " ")).toBe(value);
  expect(caption.length).toBeLessThanOrEqual(original.length);
  expect(caption.every((line) => measureText(line, 2.7).width <= width)).toBe(
    true,
  );
  expect([...rows]).toEqual([[0, '["caption-owner","2"]']]);
});

it("retains the native caption when grouping its qualifier needs another row", () => {
  const value = "AB CD / E FG",
    width = 11.5;
  const original = wrapText(value, width, 2.7);
  expect(original).toEqual(["AB CD ", "/ E FG"]);
  expect(measureText("CD / E", 2.7).width).toBeLessThanOrEqual(width);
  expect(wrapCaptionQualifier(value, width)).toEqual(original);
});

it("keeps a command polarity with its word and the signed range with its unit", () => {
  const value = "2  Command + / +/-10 V",
    width = 28;
  const lines = wrapCaptionQualifier(value, width);
  expect(lines.some((line) => line.includes("Command +"))).toBe(true);
  expect(lines.some((line) => line.includes("+/-10 V"))).toBe(true);
  expect(lines.join("")).toBe(value);
  expect(lines.length).toBeLessThanOrEqual(wrapText(value, width, 2.7).length);
});
