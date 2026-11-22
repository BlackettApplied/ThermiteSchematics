import { compactFindings } from "./frame-census/findings.mjs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { startCensus } from "./frame-census/text.mjs";
import { extendedInk } from "./frame-census/shapes.mjs";
import { embedPrintableFont } from "../../packages/cli/dist/printable-font.js";
let census;
beforeAll(async () => {
  census = await startCensus();
});
afterAll(async () => {
  await census?.close();
});
// Literal geometry, independent of FramePlan and renderer flags. All four strips
// are mirrored; extra drawing A/1 characters remain separate target paint.
function fixture(extra = "", digitOffset = 0) {
  const text = (x, y, s, anchor = "start") =>
    `<text x="${x}" y="${y}" font-family="Thermite Sans" font-size="2.5" text-anchor="${anchor}" fill="black">${s}</text>`;
  const path = (d) =>
    `<path d="${d}" stroke="black" stroke-width=".3" fill="none"/>`;
  const out = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">',
    '<rect width="210" height="297" fill="white"/>',
    '<rect x="10" y="10" width="190" height="277" fill="none" stroke="black" stroke-width=".4"/>',
    path("M 10 18 L 200 18"),
    path("M 10 259 L 200 259"),
  ];
  for (let col = 0; col < 6; col++)
    out.push(
      text(28 + (154 * (col + 0.5)) / 6, 22, String(col + 1), "middle"),
      text(
        28 + (154 * (col + 0.5)) / 6,
        258 + digitOffset,
        String(col + 1),
        "middle",
      ),
    );
  for (let row = 0; row < 4; row++)
    out.push(
      text(10.6, 31 + (214 * (row + 0.5)) / 4, "ABCD"[row]),
      text(199.4, 31 + (214 * (row + 0.5)) / 4, "ABCD"[row], "end"),
    );
  for (let col = 0; col <= 6; col++) {
    const x = 28 + (154 * col) / 6;
    out.push(path(`M ${x} 18 L ${x} 20`), path(`M ${x} 257 L ${x} 259`));
  }
  for (let row = 0; row <= 4; row++) {
    const y = 31 + (214 * row) / 4;
    out.push(path(`M 10 ${y} L 11.5 ${y}`), path(`M 198.5 ${y} L 200 ${y}`));
  }
  out.push(
    '<a data-continuation-id="C011" data-continuation-end="0"><path d="M 155 100 L 157 100" stroke="black" stroke-width=".3" fill="none"/>',
    text(158.15, 101, "C011 / 04.B1 / SYNTHETIC-WIRE"),
    "</a>",
    extra,
    "</svg>",
  );
  return embedPrintableFont(out.join(""));
}
const shapes = async (svg) => extendedInk(census.page, svg);
it("measures complete strips and a clean bottom-digit gap without flags", async () => {
  const svg = fixture();
  const a = await census.measure(svg);
  expect(a.zones).toBe(44);
  expect(a.inkCollisions).toEqual([]);
  expect(a.titleRuleCollisions).toEqual([]);
  const b = await shapes(svg);
  expect(b.zoneShapeCollisions).toEqual([]);
  expect(b.labelWireCollisions).toEqual([]);
  expect(b.bottomRuleClearanceMm).toBeGreaterThanOrEqual(0.5);
});
it("fails closed when a mirrored tick is missing", async () => {
  const svg = fixture().replace(
    '<path d="M 28 18 L 28 20" stroke="black" stroke-width=".3" fill="none"/>',
    "",
  );
  await expect(census.measure(svg)).rejects.toThrow(/ticks/);
});
it.each([
  ["A", 198.7, 57.95],
  ["1", 41.13333333333333, 258.2],
])(
  "retains the drawing %s as a target in a zone strip",
  async (value, x, y) => {
    const r = await census.measure(
      fixture(
        `<text x="${x}" y="${y}" font-family="Thermite Sans" font-size="2.5" fill="red">${value}</text>`,
      ),
      { lanes: false },
    );
    expect(
      r.inkCollisions.concat(r.nearInk).some((h) => h.text === value),
    ).toBe(true);
  },
);
it.each(["path", "circle"])("detects zone against %s paint", async (tag) => {
  const extra =
    tag === "path"
      ? '<path d="M 195 57.2 L 201 57.2" stroke="black" stroke-width=".4"/>'
      : '<circle cx="198.6" cy="57" r="1" fill="black"/>';
  expect(
    (await shapes(fixture(extra))).zoneShapeCollisions.length,
  ).toBeGreaterThan(0);
});
it.each(["stub", "wire", "duplicate wires"])(
  "detects continuation text against %s",
  async (mode) => {
    let svg = fixture();
    if (mode === "stub")
      svg = svg.replace('x="158.15" y="101"', 'x="156" y="101"');
    else {
      const p =
        '<path d="M 160 100 L 190 100" stroke="black" stroke-width=".4"/>';
      svg = fixture(p.repeat(mode === "wire" ? 1 : 2));
    }
    expect(
      (await shapes(svg)).labelWireCollisions.some((h) => h.cid === "C011"),
    ).toBe(true);
  },
);
it.each(["viewport", "clipPath", "white cover", "hidden", "zero opacity"])(
  "respects %s when testing conductor paint",
  async (mode) => {
    const wire =
      '<path d="M 195 57.2 L 201 57.2" stroke="black" stroke-width=".4"/>';
    const extra =
      mode === "viewport"
        ? `<svg width="5" height="5" overflow="hidden">${wire}</svg>`
        : mode === "clipPath"
          ? `<defs><clipPath id="outside"><rect width="5" height="5"/></clipPath></defs><g clip-path="url(#outside)">${wire}</g>`
          : mode === "white cover"
            ? wire + '<rect x="194" y="54" width="8" height="7" fill="white"/>'
            : `<g ${mode === "hidden" ? 'display="none"' : 'opacity="0"'}>${wire}</g>`;
    expect((await shapes(fixture(extra))).zoneShapeCollisions).toEqual([]);
  },
);
it("rejects bottom digits with less than half a millimetre of painted clearance", async () => {
  // A 0.3 mm shift leaves 0.533 mm on Linux; cross the gate beyond a raster pixel.
  expect((await shapes(fixture("", 0.5))).bottomRuleClearanceMm).toBeLessThan(
    0.5,
  );
});

it("enforces the half-millimetre gate independently of zero overlap counts", () => {
  const clean = {
    nativeCutFindings: [],
    inkCollisions: [],
    nearInk: [],
    laneViolations: [],
    titleRuleCollisions: [],
    zoneShapeCollisions: [],
    labelWireCollisions: [],
    cutGapFailures: 0,
    raggedBanks: [],
    bottomRuleClearanceMm: 0.5,
  };
  expect(compactFindings(clean)).toBe(0);
  expect(
    compactFindings({
      ...clean,
      nativeCutFindings: [{ kind: "stub-not-on-visible-owned-route" }],
    }),
  ).toBe(1);
  expect(compactFindings({ ...clean, nativeCutFindings: undefined })).toBe(1);
  expect(compactFindings({ ...clean, bottomRuleClearanceMm: 0.499 })).toBe(1);
  expect(compactFindings({ ...clean, bottomRuleClearanceMm: NaN })).toBe(1);
});

const nativeCutFixture = (
  y = 60,
  extra = "",
) => `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">
<svg x="30" y="40" width="100" height="80" viewBox="0 0 100 80" overflow="hidden">
<path data-wire-uid="owned" d="M 0 20 L 100 20" stroke="black" stroke-width=".3"/>
<path data-wire-uid="other" d="M 0 50 L 100 50" stroke="black" stroke-width=".3"/>
</svg><a data-continuation-id="C001" data-continuation-end="0" ${extra}><path d="M 130 ${y} L 132 ${y}" stroke="black" stroke-width=".3"/></a></svg>`;
const ownedEnd = [
  { id: "C001", end: 0, provenance: { kind: "wire", uid: "owned" } },
];
it("rejects a stub on another conductor's visible cut point at the same viewport edge", async () => {
  const { continuationGeometry } =
    await import("./frame-census/continuations.mjs");
  expect(
    (await continuationGeometry(census.page, nativeCutFixture(), ownedEnd))
      .findings,
  ).toEqual([]);
  expect(
    (await continuationGeometry(census.page, nativeCutFixture(90), ownedEnd))
      .findings,
  ).toEqual([
    {
      id: "C001",
      end: 0,
      kind: "stub-not-on-visible-owned-route",
      cut: { x: 130, y: 90 },
      provenance: ownedEnd[0].provenance,
    },
  ]);
});
it("fails a painted stub without a sheet continuation entry", async () => {
  const { continuationGeometry } =
    await import("./frame-census/continuations.mjs");
  expect(
    (await continuationGeometry(census.page, nativeCutFixture(), [])).findings,
  ).toEqual([{ id: "C001", end: 0, kind: "unlisted-painted-stub" }]);
  expect(
    (
      await continuationGeometry(
        census.page,
        nativeCutFixture(60, 'opacity="0"'),
        [],
      )
    ).findings,
  ).toEqual([]);
});
it("imports census helpers from outside the checkout working directory", async () => {
  const { execFileSync } = await import("node:child_process"),
    { tmpdir } = await import("node:os");
  const modules = ["./frame-census/text.mjs", "./frame-census/shapes.mjs"].map(
    (p) => new URL(p, import.meta.url).href,
  );
  expect(() =>
    execFileSync(
      process.execPath,
      [
        "-e",
        `for (const url of ${JSON.stringify(modules)}) await import(url);`,
      ],
      { cwd: tmpdir(), stdio: "pipe" },
    ),
  ).not.toThrow();
});
