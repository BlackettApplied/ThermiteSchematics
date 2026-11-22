import { expect } from "vitest";
import { circuitDocument } from "./junction-rays.js";
import { withoutRouteOwnershipMetadata } from "./route-ownership.js";

/** Assert current N14 ink before comparing the original reviewed geometry. */
export function reviewedTransformerInk(content: string): string {
  const document = circuitDocument(content);
  const endpoints = [
    ...document.querySelectorAll("g[data-terminal-id] > circle"),
  ];
  expect(
    endpoints.map((e) =>
      ["r", "fill", "stroke", "stroke-width"].map((a) => e.getAttribute(a)),
    ),
  ).toEqual(
    Array.from({ length: 12 }, () => [".65", "white", "#17212b", ".3"]),
  );
  const dots = [...document.querySelectorAll("[data-circuit-junction]")];
  expect(dots.map((e) => e.getAttribute("data-device-uid"))).toEqual([
    "62000000-0000-4000-8000-000000000002",
    "62000000-0000-4000-8000-000000000002",
  ]);
  expect(dots.map((e) => e.getAttribute("data-terminal-key")).sort()).toEqual([
    "X1",
    "X2",
  ]);
  expect(
    dots.map((e) => [e.getAttribute("r"), e.getAttribute("fill")]),
  ).toEqual([
    [".55", "#17212b"],
    [".55", "#17212b"],
  ]);
  return withoutRouteOwnershipMetadata(
    content
      .replace(
        /(<g [^>]*\bdata-terminal-id="[^"]*"[^>]*>\s*<circle [^>]*\bfill=")white(")/gu,
        "$1#17212b$2",
      )
      .replace(
        /(<circle data-circuit-junction="true") data-device-uid="[^"]*" data-terminal-key="[^"]*"/gu,
        "$1",
      ),
  );
}
