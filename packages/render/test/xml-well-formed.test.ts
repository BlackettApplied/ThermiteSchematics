import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkRestrictedSvgXml } from "./xml-checker.js";

const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
const goldenRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "goldens",
  "motor-starter",
);

describe("restricted SVG XML checker", () => {
  it.each([
    "k1-control-left-to-right.svg",
    "m1-power-left-to-right.svg",
    "ls1-to-plc1-include-power-left-to-right.svg",
    "cbl1-conductors-left-to-right.svg",
    "ps1-loads-left-to-right.svg",
  ])("accepts baseline renderer golden %s", async (filename) => {
    const svg = await readFile(join(goldenRoot, filename), "utf8");
    expect(checkRestrictedSvgXml(svg).ids.length).toBeGreaterThan(0);
  });

  it("accepts the complete frozen subset with a resolved one-to-one clip", () => {
    const svg = `${declaration}<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 10 10" width="10" height="10">\n  <title>A &amp; B</title>\n  <desc>legal &#x9; text</desc>\n  <style>.x{fill:#fff}</style>\n  <defs>\n    <clipPath id="clip-0061" clipPathUnits="userSpaceOnUse">\n      <rect x="0" y="0" width="10" height="10"/>\n    </clipPath>\n  </defs>\n  <text clip-path="url(#clip-0061)" x="0" y="5" textLength="4" lengthAdjust="spacingAndGlyphs">A</text>\n</svg>\n`;
    expect(checkRestrictedSvgXml(svg)).toMatchObject({
      clipIds: ["clip-0061"],
      clipReferences: ["clip-0061"],
    });
  });

  it.each([
    [
      "unquoted attribute",
      '<svg xmlns="http://www.w3.org/2000/svg" version=1.1></svg>',
    ],
    [
      "unbalanced tags",
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1"><g></svg>',
    ],
    [
      "unknown element",
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1"><ellipse/></svg>',
    ],
    [
      "unknown attribute",
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" onclick="x"></svg>',
    ],
    [
      "bad entity",
      '<svg xmlns="http://www.w3.org/2000/svg" version="1.1"><title>&bad;</title></svg>',
    ],
  ])("rejects %s", (_name, body) => {
    expect(() => checkRestrictedSvgXml(`${declaration}${body}\n`)).toThrow(
      "Restricted XML check failed",
    );
  });

  it("rejects unresolved, reused, and structurally invalid label clips", () => {
    const unresolved = `${declaration}<svg xmlns="http://www.w3.org/2000/svg" version="1.1"><text clip-path="url(#missing)">A</text></svg>\n`;
    expect(() => checkRestrictedSvgXml(unresolved)).toThrow();
    const empty = `${declaration}<svg xmlns="http://www.w3.org/2000/svg" version="1.1"><defs><clipPath id="clip-0061" clipPathUnits="userSpaceOnUse"></clipPath></defs></svg>\n`;
    expect(() => checkRestrictedSvgXml(empty)).toThrow();
  });

  it("rejects literal control bytes and duplicate IDs", () => {
    const duplicate = `${declaration}<svg xmlns="http://www.w3.org/2000/svg" version="1.1"><g id="device-0061"/><g id="device-0061"/></svg>\n`;
    expect(() => checkRestrictedSvgXml(duplicate)).toThrow();
    expect(() =>
      checkRestrictedSvgXml(duplicate.replace("<g", "\t<g")),
    ).toThrow();
    expect(() =>
      checkRestrictedSvgXml(duplicate.replace("\n", "\r\n")),
    ).toThrow();
  });
});
