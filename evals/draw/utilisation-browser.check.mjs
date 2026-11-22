import { parseReportBytes } from "./report-file.mjs";
// Explicit Chromium acceptance; portable unit/mutation tests remain browser-free.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  launch,
  drawingContextOptions,
  openSheet,
  evaluateSheetGeometry,
} from "./browser.mjs";
import { utilisation, visibleShapeBounds } from "./utilisation.mjs";
import { evaluateSheet, evaluatePacket } from "./evaluate.mjs";
import { hash } from "./support.mjs";
const { values } = parseArgs({ options: { report: { type: "string" } } });
const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="250mm" viewBox="0 0 300 250">${body}</svg>`;
const rect = (x, y, w, h) =>
  `<rect data-symbol-id="test" x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>`;
const viewport = (x, y, w, h, body) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden">${body}</svg>`;
const cases = [
  [
    "off-sheet-origin conductor remains eligible after clipping",
    viewport(
      30,
      40,
      200,
      100,
      '<path class="net-path" d="M-158 20H202.6V46" stroke="black" fill="none"/>',
    ),
    [30, 60, 200, 0],
  ],
  [
    "compact arc flags",
    viewport(
      30,
      40,
      100,
      100,
      '<path class="net-path" d="M10 50a5 5 0 001 1L150 51" stroke="black" fill="none"/>',
    ),
    [40, 90, 90, 1],
  ],
  [
    "path turning outside strip",
    viewport(
      30,
      40,
      100,
      100,
      '<path class="net-path" d="M10 20H180V140" stroke="black" fill="none"/>',
    ),
    [40, 60, 90, 0],
  ],
  [
    "disjoint subpaths",
    viewport(
      30,
      40,
      100,
      100,
      '<path class="net-path" d="M10 20H27.333M180 140H200" stroke="black" fill="none"/>',
    ),
    [40, 60, 17.333, 0],
  ],
  ["unfolded", rect(40, 50, 80, 40), [40, 50, 80, 40]],
  [
    "partial viewport",
    viewport(30, 40, 100, 100, rect(50, 20, 180, 30)),
    [80, 60, 50, 30],
  ],
  [
    "nested viewports",
    viewport(
      30,
      40,
      180,
      150,
      viewport(20, 20, 80, 70, rect(-10, -5, 200, 150)),
    ),
    [50, 60, 80, 70],
  ],
  [
    "nested clip paths",
    `<defs><clipPath id="a"><rect x="50" y="60" width="100" height="90"/></clipPath><clipPath id="b"><rect x="70" y="80" width="40" height="30"/></clipPath></defs><g clip-path="url(#a)"><g clip-path="url(#b)">${rect(30, 40, 200, 150)}</g></g>`,
    [70, 80, 40, 30],
  ],
  [
    "multiple viewports",
    viewport(30, 40, 100, 100, rect(-9, -10, 200, 60)) +
      viewport(150, 140, 80, 50, rect(-20, -20, 200, 90)),
    [30, 40, 200, 150],
  ],
  [
    "transformed clip",
    `<defs><clipPath id="a"><rect x="10" y="10" width="20" height="15"/></clipPath></defs><g transform="translate(30 40) scale(2)" clip-path="url(#a)">${rect(0, 0, 100, 80)}</g>`,
    [50, 60, 40, 30],
  ],
  [
    "object bounding box clip",
    `<defs><clipPath id="a" clipPathUnits="objectBoundingBox"><rect x=".25" y=".25" width=".5" height=".5"/></clipPath></defs><g clip-path="url(#a)">${rect(40, 50, 100, 80)}</g>`,
    [65, 70, 50, 40],
  ],
];
const browser = await launch();
try {
  const context = await browser.newContext(drawingContextOptions),
    page = await context.newPage();
  await context.route("**/*", (r) => r.abort());
  await page.emulateMedia({ media: "print" });
  for (const [name, body, expected] of cases) {
    for (const medium of ["svg", "html"]) {
      let g;
      if (medium === "svg") g = await openSheet(page, svg(body));
      else {
        await page.setContent(`<section id="sheet-1">${svg(body)}</section>`);
        g = await evaluateSheetGeometry(page, { selector: "#sheet-1>svg" });
      }
      assert.equal(g.utilisationErrors, undefined, `${name}/${medium}`);
      const result = utilisation(g);
      for (const [i, key] of ["x", "y", "w", "h"].entries())
        assert(
          Math.abs(result.bbox[key] - expected[i]) < 0.001,
          `${name}/${medium}: ${key} ${result.bbox[key]} != ${expected[i]}`,
        );
      assert(result.fraction >= 0 && result.fraction <= 1);
    }
  }
  assert.equal(
    utilisation(
      await openSheet(
        page,
        svg(`<g opacity="0">${rect(30, 40, 100, 100)}</g>`),
      ),
    ),
    null,
  );
  const refusals = [
    [
      "unsupported clip path",
      `<defs><clipPath id="a"><circle cx="60" cy="60" r="30"/></clipPath></defs><g clip-path="url(#a)">${rect(30, 40, 100, 100)}</g>`,
    ],
    [
      "unsupported mask",
      `<defs><mask id="a"><rect width="300" height="250" fill="black"/></mask></defs><g mask="url(#a)">${rect(30, 40, 100, 100)}</g>`,
    ],
    [
      "unsupported mask",
      `<g style="mask-image: linear-gradient(black, transparent)">${rect(30, 40, 100, 100)}</g>`,
    ],
    [
      "unsupported mask",
      rect(30, 40, 100, 100).replace(
        'fill="black"',
        'fill="black" mask="url(#missing)"',
      ),
    ],
    ["unsupported mask", rect(30, 40, 100, 100), true],
    [
      "invalid SVG path",
      viewport(
        30,
        40,
        100,
        100,
        '<path class="net-path" d="M10 20H180V140 L" stroke="black" fill="none"/>',
      ),
    ],
  ];
  const spec = { id: "refusal", flow: "left-to-right" },
    sheet = {
      number: 1,
      view: { format: "documentation-view/0.1", kind: "drawing" },
      references: [],
      continuations: [],
    },
    packet = { sheets: [sheet] },
    ir = { devices: [], nets: [], functions: [] };
  for (const [reason, body, htmlAncestor] of refusals) {
    let g;
    await assert.doesNotReject(async () => {
      if (htmlAncestor) {
        await page.setContent(
          `<section style="mask-image: linear-gradient(black, transparent)">${svg(body)}</section>`,
        );
        g = await evaluateSheetGeometry(page);
      } else g = await openSheet(page, svg(body));
    }, "DQ-12 refusals must not abort shared geometry extraction");
    assert(g.shapes.length, "Other checks must retain the original geometry");
    assert(
      g.utilisationErrors?.some((e) => e.reason.includes(reason)),
      reason,
    );
    assert.throws(() => utilisation(g), /DQ-12 /);
    const rows = evaluateSheet(spec, sheet, packet, g, ir, [], [], []),
      control = evaluateSheet(
        spec,
        sheet,
        packet,
        { ...g, utilisationErrors: [] },
        ir,
        [],
        [],
        [],
      );
    assert.deepEqual(
      rows.filter((r) => r.dq !== "DQ-12"),
      control.filter((r) => r.dq !== "DQ-12"),
    );
    assert(
      rows.some((r) => r.dq === "DQ-13" && r.status !== "infrastructure-error"),
    );
    assert.equal(
      rows.find((r) => r.dq === "DQ-12").status,
      "infrastructure-error",
    );
    assert(
      !evaluatePacket(spec, packet, [g]).some((r) =>
        r.id.endsWith("/packet-median"),
      ),
    );
  }
  if (values.report) {
    const report = parseReportBytes(await readFile(resolve(values.report))),
      root = dirname(resolve(values.report));
    const witness = report.sourceHashes.sheets.find(
      (s) =>
        s.case === "sweep-motor-starter-a3-portrait-compact-left-to-right" &&
        s.sheet === 1,
    );
    assert(witness, "Missing A3 sheet 1 witness");
    const bytes = await readFile(resolve(root, witness.svg.path));
    assert.equal(hash(bytes), witness.svg.sha256);
    const g = await openSheet(page, bytes.toString("utf8")),
      conductor = g.shapes.find(
        (s) => s.conductor && Math.abs(s.bbox.x + 128) < 0.1,
      ),
      b =
        conductor &&
        visibleShapeBounds(conductor, { x: 0, y: 0, w: g.width, h: g.height });
    assert(
      b &&
        Math.abs(b.x - 28) < 0.1 &&
        Math.abs(b.y - 233) < 0.1 &&
        Math.abs(b.w - 204.5) < 0.1 &&
        Math.abs(b.h - 26) < 0.1,
      "Review witness must contribute its visible bounds",
    );
    const envelope = utilisation(g).bbox;
    assert(
      envelope.x <= b.x &&
        envelope.y <= b.y &&
        envelope.x + envelope.w >= b.x + b.w &&
        envelope.y + envelope.h >= b.y + b.h,
    );
    for (const id of [
      "sweep-motor-starter-letter-landscape-compact-left-to-right",
      "sweep-motor-starter-letter-portrait-compact-left-to-right",
      "conveyor-line-left-to-right",
    ]) {
      const fractions = [];
      for (const pin of report.sourceHashes.sheets.filter(
        (s) => s.case === id,
      )) {
        const bytes = await readFile(resolve(root, pin.svg.path));
        assert.equal(hash(bytes), pin.svg.sha256);
        const result = utilisation(
          await openSheet(page, bytes.toString("utf8")),
        );
        if (result) {
          assert(result.fraction >= 0 && result.fraction <= 1);
          fractions.push(result.fraction);
        }
      }
      assert(fractions.length, "Missing regression packet: " + id);
      fractions.sort((a, b) => a - b);
      const n = fractions.length,
        median =
          n % 2
            ? fractions[(n - 1) / 2]
            : (fractions[n / 2 - 1] + fractions[n / 2]) / 2;
      assert(median < 0.4, "False threshold pass remains: " + id);
      console.log(id + ": " + (100 * median).toFixed(5) + "%");
    }
  }
  await context.close();
  console.log(
    `DQ-12 Chromium: ${cases.length * 2} SVG/HTML clipping controls, hidden geometry and ${refusals.length} DQ-12-only refusals passed.`,
  );
} finally {
  await browser.close();
}
