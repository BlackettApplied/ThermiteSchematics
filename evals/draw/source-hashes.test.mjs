import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureSources,
  pinnedSource,
  assertSourceBytes,
  SOURCE_HASH_FORMAT,
} from "./source-hashes.mjs";
import { hash } from "./support.mjs";
const t = {
  scope: { case: "example", medium: "svg", sheet: "view:wiring" },
  physicalSheet: 1,
  markerId: "marker",
};
const fixture = () => ({
  sourceHashes: {
    format: SOURCE_HASH_FORMAT,
    sheets: [
      {
        case: "example",
        sheet: 1,
        svg: {
          path: "example/sheet-001.svg",
          sha256: hash("<text>W-C11</text>"),
        },
      },
    ],
  },
});
it("pins literal delivered SVG and packet bytes for each physical sheet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "source-hashes-"));
  try {
    await writeFile(join(dir, "sheet-001.svg"), "SVG one");
    await writeFile(join(dir, "sheet-002.svg"), "SVG two");
    await writeFile(join(dir, "packet.html.gz"), Buffer.from([1, 2, 3]));
    const s = await captureSources(dir, "example", [1, 2], "packet.html.gz");
    expect(s.map((x) => x.svg.sha256)).toEqual([
      hash("SVG one"),
      hash("SVG two"),
    ]);
    expect(s.map((x) => x.html.sha256)).toEqual([
      hash(Buffer.from([1, 2, 3])),
      hash(Buffer.from([1, 2, 3])),
    ]);
    expect(s[1].svg.path).toBe("example/sheet-002.svg");
    expect(
      pinnedSource(
        { sourceHashes: { format: SOURCE_HASH_FORMAT, sheets: s } },
        t,
      ),
    ).toEqual(s[0].svg);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(["missing", "format", "sheets"])(
  "refuses pre-pin or malformed reports: %s",
  (mode) => {
    const r = fixture();
    if (mode === "missing") delete r.sourceHashes;
    if (mode === "format") r.sourceHashes.format = "invented";
    if (mode === "sheets") r.sourceHashes.sheets = {};
    expect(() => pinnedSource(r, t)).toThrow(/fresh C1.*source hashes/);
  },
);
it.each(["missing sheet", "wrong case", "wrong sheet", "duplicate", "bad sha"])(
  "refuses an ambiguous or missing sheet pin: %s",
  (mode) => {
    const r = fixture(),
      s = r.sourceHashes.sheets[0];
    if (mode === "missing sheet") r.sourceHashes.sheets = [];
    if (mode === "wrong case") s.case = "other";
    if (mode === "wrong sheet") s.sheet = 2;
    if (mode === "duplicate") r.sourceHashes.sheets.push({ ...s });
    if (mode === "bad sha") s.svg.sha256 = "typed";
    expect(() => pinnedSource(r, t)).toThrow(
      /Missing or ambiguous pinned source/,
    );
  },
);
it("refuses a pin naming a different case or physical source path", () => {
  const r = fixture();
  r.sourceHashes.sheets[0].svg.path = "other/sheet-001.svg";
  expect(() => pinnedSource(r, t)).toThrow(/Pinned source path differs/);
});
it("refuses W-C11 to W-C17 in a substituted source folder", () => {
  const ref = pinnedSource(fixture(), t);
  expect(() =>
    assertSourceBytes(Buffer.from("<text>W-C11</text>"), ref),
  ).not.toThrow();
  expect(() =>
    assertSourceBytes(Buffer.from("<text>W-C17</text>"), ref),
  ).toThrow(/hash differs from C1 report/);
});
it("adds exact PDF byte and physical-page pins without changing SVG/HTML pins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "source-pdf-hashes-"));
  try {
    await writeFile(join(dir, "sheet-001.svg"), "SVG");
    await writeFile(join(dir, "sheet-002.svg"), "SVG two");
    await writeFile(join(dir, "packet.html"), "HTML");
    const page = {
        number: 1,
        view: [0, 0, 720, 360],
        userUnit: 1,
        rotation: 0,
        widthMm: 254,
        heightMm: 127,
      },
      bytes = Buffer.from("%PDF-fixture");
    const old = await captureSources(dir, "example", [1, 2], "packet.html"),
      pins = await captureSources(dir, "example", [1, 2], "packet.html", {
        bytes,
        pdfjsVersion: "6.5.438",
        pages: [
          page,
          { ...page, number: 2, rotation: 90, widthMm: 127, heightMm: 254 },
        ],
      });
    expect(pins[0].svg).toEqual(old[0].svg);
    expect(pins[0].html).toEqual(old[0].html);
    expect(pins[1].pdf.page).toMatchObject({
      number: 2,
      rotation: 90,
      widthMm: 127,
      heightMm: 254,
    });
    expect(pins[0].pdf).toEqual({
      path: "example/packet.pdf",
      sha256: hash(bytes),
      backend: "pdf.js",
      pdfjsVersion: "6.5.438",
      page,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
