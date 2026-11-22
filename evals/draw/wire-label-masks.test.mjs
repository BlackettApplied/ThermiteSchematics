import { afterAll, beforeAll, expect, it } from "vitest";
import { wirePlacement } from "./checks.mjs";
import { drawingContextOptions, launch, openSheet } from "./browser.mjs";
import { end, nativeIr, wire } from "./tranche3-fixtures.mjs";
import { wireLabelSupportAudit } from "./wire-label-support.mjs";

let browser, page;
beforeAll(async () => {
  browser = await launch();
  page = await browser.newPage(drawingContextOptions);
  await page.emulateMedia({ media: "print" });
});
afterAll(async () => {
  await browser?.close();
});
const ir = nativeIr([
  wire("A", end("X"), end("D")),
  wire("B", end("Y"), end("D")),
]);
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="150mm" height="100mm" viewBox="0 0 150 100">${body}</svg>`;
function route(id, d) {
  const endpoints = ir.wires
    .find((w) => w.uid === id)
    .endpoints.map((e) => e.terminal);
  return `<path data-wire-uid="${id}" data-endpoints='${JSON.stringify(endpoints)}' d="${d}" fill="none" stroke="#344054" stroke-width=".35"/>`;
}
function label(id, x, y, fill = "white", extra = "", text = id) {
  return `<g data-wire-label="${id}" ${extra}><rect x="${x}" y="${y}" width="28" height="8" fill="${fill}"/><text x="${x + 1}" y="${y + 5}" font-size="2.7">${text}</text></g>`;
}
async function audit(body, facts = ir) {
  return wireLabelSupportAudit(await openSheet(page, svg(body)), facts)
    .findings;
}
const straight = route("A", "M 10 30 L 110 30");
const second = route("B", "M 10 50 L 110 50");
const masks = (findings) =>
  findings.filter((f) => f.kind === "wire-label-plate-masks-conductor");

const ring = (cx, cy) =>
  `<circle cx="${cx}" cy="${cy}" r=".7" fill="white" stroke="#344054" stroke-width=".3"/>`;
const vertical = route("A", "M 40 10 L 40 90");
const corner = route("A", "M 10 10 L 10 30 L 110 30");
const approach = label("A", 10, 26);

it.each([
  [
    "route end with 0.02 mm of ink",
    straight + label("A", 10.02, 26),
    "approach",
  ],
  [
    "plate butted against the ring",
    straight + ring(10, 30) + label("A", 10.86, 26),
    "approach",
  ],
  [
    "plate inside the ring",
    straight + ring(10, 30) + label("A", 10.5, 26),
    "approach",
  ],
  [
    "elbow with 0.02 mm of ink",
    corner + label("A", 10.02, 26),
    "elbow-or-branch",
  ],
  [
    "vertical run with 0.02 mm of ink",
    vertical +
      approach
        .replace(
          'x="10" y="26" width="28" height="8"',
          'x="36" y="10.02" width="8" height="28"',
        )
        .replace('x="11" y="31"', 'x="37" y="15.02"'),
    "approach",
  ],
  [
    "translucent plate",
    straight +
      approach.replace('fill="white"', 'fill="white" fill-opacity=".9"'),
    "approach",
  ],
  ["yellow plate", straight + label("A", 10, 26, "#ffffcc"), "approach"],
  [
    "path plate",
    straight +
      approach.replace(
        '<rect x="10" y="26" width="28" height="8"',
        '<path d="M10 26 h28 v8 h-28 z"',
      ),
    "approach",
  ],
  [
    "nested label text",
    straight +
      approach
        .replace("<text", "<g><text")
        .replace("</text></g>", "</text></g></g>"),
    "approach",
  ],
  [
    "review control: plate directly over the approach",
    straight + approach,
    "approach",
  ],
])("DQ-16 rejects %s", async (_name, body, reason) => {
  expect(masks(await audit(body))).toEqual([
    expect.objectContaining({ reason }),
  ]);
});

it("accepts the review control with a full terminal approach outside a painted ring", async () => {
  expect(await audit(straight + ring(10, 30) + label("A", 30, 26))).toEqual([]);
});

it("fails closed if the plate paint or a clip cannot be measured", async () => {
  const g = await openSheet(page, svg(straight + label("A", 30, 26)));
  delete g.tranche3.wirePlatePaint;
  expect(wireLabelSupportAudit(g, ir).findings).toContainEqual(
    expect.objectContaining({
      kind: "wire-label-mask-unmeasurable",
      reason: "missing-paint-measurement",
    }),
  );
  for (const body of [
    straight + approach.replace("<rect", '<rect clip-path="url(#missing)"'),
    straight.replace("<path", '<path clip-path="url(#missing)"') + approach,
  ])
    expect(await audit(body)).toContainEqual(
      expect.objectContaining({ kind: "wire-label-mask-unmeasurable" }),
    );
});

it.each([
  ["terminal approach", straight, 10, 26, "approach"],
  ["elbow", route("A", "M 10 10 L 10 30 L 110 30"), 10, 26, "elbow-or-branch"],
  [
    "corner-touch",
    route("A", "M 38 10 L 38 35") + second,
    10,
    46,
    "foreign-conductor",
  ],
  ["exchanged label", straight + second, 30, 46, "foreign-conductor"],
  [
    "junction",
    straight +
      '<circle data-circuit-junction="true" cx="40" cy="30" r=".65" fill="black"/>',
    30,
    26,
    "junction",
  ],
])("DQ-16 rejects a plate at the %s", async (_name, routes, x, y, reason) => {
  expect(masks(await audit(routes + label("A", x, y)))).toEqual([
    expect.objectContaining({ reason }),
  ]);
});

it("DQ-16 accepts native inline plates and separate same-text conductors", async () => {
  expect(await audit(straight + label("A", 30, 26))).toEqual([]);
  const same = structuredClone(ir);
  for (const w of same.wires) w.designation = "SAME";
  expect(
    await audit(
      straight +
        second +
        label("A", 30, 26, "white", "", "SAME") +
        label("B", 30, 46, "white", "", "SAME"),
      same,
    ),
  ).toEqual([]);
});

it("DQ-16 treats a collinear SVG subdivision as continuous straight ink", async () => {
  expect(
    await audit(route("A", "M 10 30 L 42 30 L 110 30") + label("A", 30, 26)),
  ).toEqual([]);
});

it("DQ-16 checks native text and endpoints before accepting an inline plate", async () => {
  const lie = label("A", 30, 26, "white", 'data-native-owner="A"', "B");
  expect(masks(await audit(straight + lie))).toHaveLength(1);
  const wrong = straight.replace('"terminalKey":"T"', '"terminalKey":"wrong"');
  expect(masks(await audit(wrong + label("A", 30, 26)))).toHaveLength(1);
});

it("DQ-16 sees actual paint order, fill and viewport", async () => {
  expect(masks(await audit(label("A", 10, 26) + straight))).toEqual([]);
  expect(masks(await audit(straight + label("A", 10, 26, "none")))).toEqual([]);
  expect(
    masks(
      await audit(
        straight + label("A", 10, 26).replace("<rect", '<rect opacity="0"'),
      ),
    ),
  ).toEqual([]);
});

const offsetPlate = label("A", 30, 19.25);
const leaderPath = (d, attrs = "") =>
  `<path class="wire-label-leader" data-label-leader-owner="A" d="${d}" fill="none" stroke="#475467" stroke-width=".15" stroke-dasharray=".5 .375" ${attrs}/>`;
const landing = leaderPath("M44 28 L44 30");

it("the DQ-16 distance rule accepts a measured dashed leader to the native wire", async () => {
  const g = await openSheet(page, svg(straight + offsetPlate + landing));
  expect(wirePlacement(g)).toEqual([]);
  expect(wireLabelSupportAudit(g, ir).findings).toEqual([]);
});

it.each([
  [
    "owner attribute only",
    '<g class="wire-label-leader" data-label-leader-owner="A"/>',
  ],
  ["missing paint", leaderPath("M44 28 L44 30", 'opacity="0"')],
  ["detached plate", leaderPath("M44 29.5 L44 30")],
  ["wrong tip", leaderPath("M44 28 L44 32") + route("B", "M10 32 L110 32")],
  ["disconnected leader", leaderPath("M44 28 L44 28.25 M44 29.75 L44 30")],
  [
    "clipped tip",
    leaderPath("M44 28 L44 30", 'clip-path="url(#c)"') +
      '<defs><clipPath id="c"><rect x="30" y="27" width="30" height="2.5"/></clipPath></defs>',
  ],
])("the DQ-16 distance rule rejects a %s", async (_name, invalid) => {
  const g = await openSheet(page, svg(straight + offsetPlate + invalid));
  expect(wirePlacement(g)).toContainEqual(
    expect.objectContaining({ kind: "ambiguous-wire-label", wire: "A" }),
  );
});
