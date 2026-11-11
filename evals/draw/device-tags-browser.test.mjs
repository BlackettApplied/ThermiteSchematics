import { afterAll, beforeAll, expect, it } from "vitest";
import { launch, drawingContextOptions, openSheet } from "./browser.mjs";
import { deviceTags, legibility } from "./checks.mjs";
import { classifyTextGeometry } from "./text-classification.mjs";
import { evaluateSheet } from "./evaluate.mjs";
let browser, context, page;
beforeAll(async () => {
  browser = await launch();
  context = await browser.newContext(drawingContextOptions);
  page = await context.newPage();
});
afterAll(async () => {
  await context?.close();
  await browser?.close();
});
const ir = {
  devices: [
    {
      uid: "a",
      designation: "TB 1",
      typeId: "t",
      description: "Field terminals",
    },
  ],
  deviceTypes: [
    {
      id: "t",
      catalog: { orderNumber: "P/1-A" },
      terminals: [{ key: "X1.1" }],
    },
  ],
  functions: [],
  nets: [],
};
const refs = [{ deviceUid: "a" }];
const svg = (s) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="120mm" viewBox="0 0 200 120">${s}</svg>`;
const text = (field, s, y, attrs = "") =>
  `<text x="15" y="${y}" font-size="2.7" data-tag-owner-uid="a" data-tag-kind="body" data-tag-block="a" data-tag-field="${field}" ${attrs}>${s}</text>`;
const full = () =>
  text("designation", "TB 1", 20) +
  text("description", "Field terminals", 25) +
  text("part", "P/1-A", 30);
const body = (content) =>
  `<g data-device-uid="a"><rect x="10" y="10" width="80" height="40" fill="none" stroke="black"/>${content}</g>`;

it.each(["body", "reference", "unknown", "unowned"])(
  "keeps %s tag fields primary inside a circuit relation owner",
  async (kind) => {
    const owner = (content) =>
      `<g data-device-uid="a" data-circuit-functions='["contact"]' data-related-functions='["coil"]'>${content}</g>`;
    let rows = full().replaceAll(
      'data-tag-kind="body"',
      `data-tag-kind="${kind}"`,
    );
    if (kind === "unowned")
      rows = rows.replaceAll('data-tag-owner-uid="a"', "");
    const measure = async (content) =>
      classifyTextGeometry(await openSheet(page, svg(owner(content))), ir);
    const good = await measure(
      rows
        .replaceAll('font-size="2.7"', 'font-size="2.5"')
        .replace('font-size="2.5"', 'font-size="2.7"'),
    );
    expect(good.texts.every((t) => !t.secondaryReference)).toBe(true);
    expect(legibility(good)).toEqual([]);
    // Mutate only the description em, retaining relation and C1 ownership metadata.
    const small = await measure(
      rows.replace(/<text[^>]*data-tag-field="description"[^>]*>/, (tag) =>
        tag.replace('font-size="2.7"', 'font-size="2.4"'),
      ),
    );
    expect(
      small.texts.find((t) => t.tagField === "description").secondaryReference,
    ).toBe(false);
    expect(legibility(small)).toEqual([
      expect.objectContaining({
        kind: "text-below-minimum-em",
        minimumMm: 2.5,
      }),
    ]);
    if (kind === "body") {
      expect(deviceTags(good, ir, refs, true)).toEqual([]);
      expect(deviceTags(small, ir, refs, true)[0].missing).toContain(
        "authored description",
      );
    }
  },
);

it("measures owned fields without introducing appearances, joins or terminals", async () => {
  const g = await openSheet(page, svg(body(full())));
  expect(deviceTags(g, ir, refs, true)).toEqual([]);
  expect(g.devices).toHaveLength(1);
  expect(g.terminals).toHaveLength(0);
  const bare = await openSheet(
    page,
    svg(body(full().replaceAll(/ data-tag-[a-z-]+="[^"]*"/g, ""))),
  );
  expect(g.shapes.map((s) => [s.points, s.bbox, s.conductor])).toEqual(
    bare.shapes.map((s) => [s.points, s.bbox, s.conductor]),
  );
  expect(deviceTags(bare, ir, refs, true)[0].missing).toHaveLength(3);
});
it.each([
  ['style="display:none"', ""],
  ['style="visibility:hidden"', ""],
  ['style="opacity:0"', ""],
  ['fill="none"', ""],
  [
    'clip-path="url(#cut)"',
    '<defs><clipPath id="cut"><rect x="15" y="23" width="1" height="4"/></clipPath></defs>',
  ],
])(
  "rejects invisible or partially clipped authored text: %s",
  async (attrs, defs) => {
    const content =
      text("designation", "TB 1", 20) +
      text("description", "Field terminals", 25, attrs) +
      text("part", "P/1-A", 30);
    const g = await openSheet(page, svg(defs + body(content)));
    expect(deviceTags(g, ir, refs, true)[0].missing).toContain(
      "authored description",
    );
  },
);
it("rejects ancestor clipping and a foreign declared owner, even with shared text", async () => {
  const clipped = `<defs><clipPath id="cut"><rect width="1" height="1"/></clipPath></defs><g clip-path="url(#cut)">${body(full())}</g>`;
  expect(
    deviceTags(await openSheet(page, svg(clipped)), ir, refs, true)[0].missing,
  ).toHaveLength(3);
  const foreign = body(full()).replace(
    'data-device-uid="a"',
    'data-device-uid="b"',
  );
  expect(
    deviceTags(
      await openSheet(page, svg(foreign)),
      {
        ...ir,
        devices: [
          ...ir.devices,
          { ...ir.devices[0], uid: "b", designation: "TB 2" },
        ],
      },
      refs,
      true,
    ).find((f) => f.designation === "TB 1").missing,
  ).toHaveLength(3);
});
it("does not accept a title or another sheet's tag", async () => {
  await openSheet(page, svg(body(full())));
  const other = await openSheet(
    page,
    svg(body("<title>TB 1 Field terminals P/1-A</title>")),
  );
  expect(deviceTags(other, ir, refs, true)[0].missing).toHaveLength(3);
});
it("resolves fixed qualified references and local keys, retaining reference-only semantics", async () => {
  const terminal =
    "{&quot;deviceUid&quot;:&quot;a&quot;,&quot;terminalKey&quot;:&quot;X1.1&quot;}";
  const ref = `<g data-tag-owner-uid="a" data-tag-kind="reference" data-tag-block="end" data-tag-field="designation" data-tag-terminal-id="${terminal}" data-tag-ref="a"><text x="100" y="20" font-size="2.7">Off-view at TB 1.X1.1</text></g>`;
  const tag = `<g data-device-uid="a" data-tag-kind="reference">${full().replaceAll('data-tag-kind="body"', 'data-tag-kind="reference"')}</g>`;
  const g = await openSheet(page, svg(tag + ref));
  expect(g.devices).toHaveLength(0);
  expect(g.terminals).toHaveLength(0);
  expect(deviceTags(g, ir, [], true)).toEqual([]);
  const bad = await openSheet(
    page,
    svg(tag + ref.replace('data-tag-ref="a"', 'data-tag-ref="broken"')),
  );
  expect(
    deviceTags(bad, ir, [], true).some(
      (f) => f.kind === "invalid-device-tag-reference",
    ),
  ).toBe(true);
  const masquerade = await openSheet(
    page,
    svg(
      tag.replace(
        "</g>",
        '<rect x="10" y="10" width="10" height="10"/><circle data-terminal-key="X1.1" cx="10" cy="10" r="1"/></g>',
      ),
    ),
  );
  expect(deviceTags(masquerade, ir, [], true)).toEqual([]);
  expect(masquerade.devices).toHaveLength(0);
  expect(masquerade.terminals).toHaveLength(0);
});
it.each(["communication", "connector-assembly"])(
  "assesses %s drawings instead of returning an empty tag check",
  async (kind) => {
    const g = await openSheet(page, svg(body(text("designation", "TB 1", 20))));
    const sheet = {
      number: 1,
      view: { format: "documentation-view/0.1", kind },
      references: refs,
      continuations: [],
    };
    const results = evaluateSheet(
      { id: "tags" },
      sheet,
      { sheets: [sheet] },
      g,
      ir,
      [],
      [],
      [],
    );
    expect(
      results.find((r) => r.dq === "DQ-06").evidence.findings[0].missing,
    ).toContain("authored description");
  },
);

it("excludes reference copies outside the current sheet viewport", async () => {
  const terminal =
    "{&quot;deviceUid&quot;:&quot;b&quot;,&quot;terminalKey&quot;:&quot;X1.1&quot;}";
  const outside = `<g transform="translate(300 0)" data-tag-owner-uid="b" data-tag-kind="reference" data-tag-field="designation" data-tag-block="outside" data-tag-terminal-id="${terminal}"><text x="10" y="20">TB 2.X1.1</text></g>`;
  const g = await openSheet(page, svg(body(full()) + outside));
  expect(g.deviceReferences).toHaveLength(0);
  const data = {
    ...ir,
    devices: [
      ...ir.devices,
      { ...ir.devices[0], uid: "b", designation: "TB 2" },
    ],
  };
  expect(deviceTags(g, data, [], true)).toEqual([]);
});

it("refuses forged body rows inside a reference annotation and malformed terminal IDs", async () => {
  const forged = `<g data-device-uid="a" data-tag-kind="reference">${full()}</g>`;
  const g = await openSheet(
    page,
    svg(body(text("designation", "TB 1", 20)) + forged),
  );
  expect(deviceTags(g, ir, refs, true)[0].missing).toContain(
    "authored description",
  );
  const malformed = `<g data-tag-owner-uid="a" data-tag-kind="reference" data-tag-block="bad" data-tag-field="designation" data-tag-terminal-id="bad-json"><text x="100" y="20">TB 1.X1.1</text></g>`;
  const invalid = await openSheet(page, svg(body(full()) + malformed));
  expect(
    deviceTags(invalid, ir, refs, true).some(
      (f) => f.kind === "invalid-device-tag-reference",
    ),
  ).toBe(true);
});

it("keeps repeated device appearances as separate physical blocks", async () => {
  const repeated = await openSheet(
    page,
    svg(body(full()) + `<g transform="translate(90 0)">${body(full())}</g>`),
  );
  expect(deviceTags(repeated, ir, refs, true)).toEqual([]);
  const split = await openSheet(
    page,
    svg(
      body(
        text("designation", "TB 1", 20) +
          text("description", "Field terminals", 25),
      ) +
        `<g transform="translate(90 0)">${body(text("part", "P/1-A", 30))}</g>`,
    ),
  );
  expect(deviceTags(split, ir, refs, true)[0].missing).toContain(
    "authored part P/1-A",
  );
});

// Round-2 negative controls: these all falsely passed under checker 4.3.
const descriptionWith = (attrs = "", wrap = (s) => s) =>
  text("designation", "TB 1", 20) +
  wrap(text("description", "Field terminals", 25, attrs)) +
  text("part", "P/1-A", 30);
const missingDescription = async (content) => {
  const g = await openSheet(page, svg(body(content)));
  return deviceTags(g, ir, refs, true).flatMap((f) => f.missing ?? []);
};
it.each(["clipPath", "mask", "symbol", "pattern", "marker"])(
  "excludes uninstantiated text in %s outside defs",
  async (container) => {
    expect(
      await missingDescription(
        descriptionWith(
          "",
          (s) => `<${container} id="unused">${s}</${container}>`,
        ),
      ),
    ).toContain("authored description");
    expect(await missingDescription(descriptionWith())).toEqual([]);
  },
);
it.each([
  "#fff0",
  "#ff000000",
  "rgba(255, 0, 0, 0)",
  "rgb(255 0 0 / 10%)",
  "hsla(120, 100%, 50%, 0.1)",
  "hsl(120 100% 50% / 10%)",
  "transparent",
  "color(srgb 1 0 0 / 0.1)",
  "lab(50% 0 0 / 0.1)",
  "lch(50% 0 0 / 0.1)",
  "oklab(50% 0 0 / 0.1)",
  "oklch(50% 0 0 / 0.1)",
  "white",
  "#fff",
  "#ffffffff",
  "hsl(0 0% 100%)",
])("excludes invisible/background paint %s", async (fill) => {
  expect(await missingDescription(descriptionWith(`fill="${fill}"`))).toContain(
    "authored description",
  );
  expect(await missingDescription(descriptionWith('fill="#111f"'))).toEqual([]);
});
it("multiplies colour alpha, fill opacity and every ancestor opacity", async () => {
  const wrap = (s) => `<g opacity="0.5"><g opacity="0.5">${s}</g></g>`;
  expect(
    await missingDescription(
      descriptionWith('fill="rgba(255,0,0,0.8)" fill-opacity="0.9"', wrap),
    ),
  ).toContain("authored description");
  expect(
    await missingDescription(
      descriptionWith('fill="rgba(255,0,0,0.8)" fill-opacity="1"', wrap),
    ),
  ).toEqual([]);
  expect(
    await missingDescription(
      descriptionWith("", (s) => `<g opacity="0.001">${s}</g>`),
    ),
  ).toContain("authored description");
});
it("uses the existing physical em floor including transforms", async () => {
  expect(
    await missingDescription(
      descriptionWith(
        "",
        (s) => `<g transform="translate(15 25) scale(0.02)">${s}</g>`,
      ),
    ),
  ).toContain("authored description");
  expect(
    await missingDescription(descriptionWith('style="font-size:2.46px"')),
  ).toContain("authored description");
  expect(
    await missingDescription(descriptionWith('style="font-size:2.5px"')),
  ).toEqual([]);
});
it("rejects later filled occluders regardless of pointer events; ignores strokes, earlier fills and translucent shapes", async () => {
  const cover = (attrs) =>
    `<rect x="12" y="21" width="60" height="5" ${attrs}/>`;
  for (const attrs of [
    'fill="white"',
    'fill="black" pointer-events="none"',
    'fill="rgba(255,255,255,0.99)"',
  ])
    expect(
      await missingDescription(descriptionWith() + cover(attrs)),
    ).toContain("authored description");
  for (const content of [
    cover('fill="white"') + descriptionWith(),
    descriptionWith() + cover('fill="none" stroke="black" stroke-width="0.2"'),
    descriptionWith() +
      '<path d="M12 24 L75 24" fill="none" stroke="black" stroke-width="0.2"/>',
    descriptionWith() + cover('fill="white" opacity="0.1"'),
    descriptionWith() + '<circle cx="17" cy="24" r="1" fill="white"/>',
    descriptionWith() +
      '<path d="M12 21 L12 22 L75 22 L75 21 Z" fill="white"/>',
  ])
    expect(await missingDescription(content)).toEqual([]);
});
it("requires a body-owned block when a body is drawn, and a full reference block otherwise", async () => {
  const reference = `<g data-tag-kind="reference" data-tag-owner-uid="a" data-tag-block="ref">${full().replaceAll('data-tag-kind="body"', 'data-tag-kind="reference"').replaceAll('data-tag-block="a"', 'data-tag-block="ref"')}</g>`;
  const g = await openSheet(
    page,
    svg(body(text("designation", "TB 1", 20)) + reference),
  );
  expect(deviceTags(g, ir, refs, true)[0].missing).toEqual([
    "authored part P/1-A",
    "authored description",
  ]);
  expect(
    deviceTags(await openSheet(page, svg(reference)), ir, refs, true),
  ).toEqual([]);
  expect(
    deviceTags(
      await openSheet(page, svg(body(full()) + reference)),
      ir,
      refs,
      true,
    ),
  ).toEqual([]);
  const onlyIdentity = reference.replace(
    /<text[^>]+data-tag-field="(?:part|description)"[^>]*>[^<]*<\/text>/g,
    "",
  );
  expect(
    deviceTags(await openSheet(page, svg(onlyIdentity)), ir, refs, true)[0]
      .missing,
  ).toEqual(["authored part P/1-A", "authored description"]);
});
