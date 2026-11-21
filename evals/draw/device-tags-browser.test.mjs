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

it.each(["body", "unknown", "unowned"])(
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
  const tag = `<g data-tag-key="TB 1.X1.1" data-tag-kind="reference">${full().replaceAll('data-tag-kind="body"', 'data-tag-kind="reference"')}</g>`;
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
  expect(deviceTags(masquerade, ir, [], true).length).toBeGreaterThan(0);
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
  ).toContain("authored description"); // Alpha is sufficient, contrast is not.
  expect(await missingDescription(descriptionWith('fill="black"'))).toEqual([]);
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
it("rejects later filled occluders regardless of pointer events; permits thin crossings, white backgrounds and light veils", async () => {
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
  const reference = `<g data-tag-key="TB 1.X1.1" data-tag-kind="reference" data-tag-owner-uid="a" data-tag-block="ref">${full().replaceAll('data-tag-kind="body"', 'data-tag-kind="reference"').replaceAll('data-tag-block="a"', 'data-tag-block="ref"')}</g>`;
  const g = await openSheet(
    page,
    svg(body(text("designation", "TB 1", 20)) + reference),
  );
  expect(
    deviceTags(g, ir, refs, true).find(
      (f) => f.kind === "missing-device-tag-fields",
    ).missing,
  ).toEqual(["authored part P/1-A", "authored description"]);
  expect(
    deviceTags(
      await openSheet(page, svg(reference + qualifiedKey())),
      ir,
      refs,
      true,
    ),
  ).toEqual([]);
  expect(
    deviceTags(
      await openSheet(page, svg(body(full()) + reference)),
      ir,
      refs,
      true,
    ).some((f) => f.kind === "invalid-device-reference-key"),
  ).toBe(true);
  const onlyIdentity = reference.replace(
    /<text[^>]+data-tag-field="(?:part|description)"[^>]*>[^<]*<\/text>/g,
    "",
  );
  expect(
    deviceTags(
      await openSheet(page, svg(onlyIdentity + qualifiedKey())),
      ir,
      refs,
      true,
    )[0].missing,
  ).toEqual(["authored part P/1-A", "authored description"]);
});

it("accepts a framed rooted legend only with the exact painted local body key", async () => {
  const key = `<text x="15" y="20" font-size="2.5" data-tag-owner-uid="a" data-tag-kind="body" data-tag-block="a" data-tag-key="TB 1">TB 1</text>`;
  const entry = () =>
    `<g data-device-legend-entry="true" data-tag-owner-uid="a" data-tag-kind="legend" data-tag-block="legend:a" data-tag-key="TB 1">${["designation", "description", "part"].map((field, i) => `<text x="110" y="${30 + i * 5}" font-size="${i ? 2.5 : 2.7}" fill="#101828" data-tag-field="${field}">${["TB 1", "Field terminals", "P/1-A"][i]}</text>`).join("")}</g>`;
  const drawing = (bodyKey = key, legend = entry()) =>
    svg(body(bodyKey) + legend).replace(
      "<svg ",
      '<svg data-view-format="schematic-view/0.1" data-view-family="control" ',
    );
  expect(deviceTags(await openSheet(page, drawing()), ir, refs, true)).toEqual(
    [],
  );
  for (const [keyText, legend] of [
    ["", entry()],
    [key.replace(">TB 1<", ">WRONG<"), entry()],
    [key, entry() + entry()],
    [key, entry().replace('data-tag-key="TB 1"', 'data-tag-key="WRONG"')],
    [key, entry().replace('font-size="2.5"', 'font-size="2.4"')],
    [key, entry().replace('fill="#101828"', 'fill="white"')],
    [key, entry().replace("<g ", '<g style="display:none" ')],
  ])
    expect(
      deviceTags(
        await openSheet(page, drawing(keyText, legend)),
        ir,
        refs,
        true,
      ).length,
    ).toBeGreaterThan(0);
});

it("rejects an incorrect entry key despite correct row keys, and counts a hidden duplicate entry", async () => {
  const bodyKey = body(
    '<text x="15" y="20" font-size="2.5" data-tag-owner-uid="a" data-tag-kind="body" data-tag-key="TB 1">TB 1</text>',
  );
  const rows = full()
    .replaceAll(
      'data-tag-kind="body"',
      'data-tag-kind="legend" data-tag-key="TB 1"',
    )
    .replaceAll('x="15"', 'x="110"');
  const entry = (key) =>
    `<g data-device-legend-entry="true" data-tag-owner-uid="a" data-tag-kind="legend" data-tag-key="${key}">${rows}</g>`;
  const doc = (content) =>
    svg(bodyKey + content).replace(
      "<svg ",
      '<svg data-view-format="schematic-view/0.1" data-view-family="power" ',
    );
  expect(
    deviceTags(await openSheet(page, doc(entry("WRONG"))), ir, refs, true)
      .length,
  ).toBeGreaterThan(0);
  expect(
    deviceTags(
      await openSheet(
        page,
        doc(
          entry("TB 1") +
            entry("TB 1").replace("<g ", '<g style="display:none" '),
        ),
      ),
      ir,
      refs,
      true,
    ).some((f) => f.kind === "duplicate-device-legend-entry"),
  ).toBe(true);
});

function qualifiedKey(content = "Off-view at TB 1.X1.1", attrs = "") {
  return `<g data-tag-owner-uid="a" data-tag-kind="reference" data-tag-block="qualified" data-tag-field="designation" data-tag-terminal-id="{&quot;deviceUid&quot;:&quot;a&quot;,&quot;terminalKey&quot;:&quot;X1.1&quot;}" ${attrs}><text x="100" y="70" font-size="2.7">${content}</text></g>`;
}
const referenceEntry = () =>
  `<g data-device-reference-entry="true" data-tag-key="TB 1.X1.1" data-tag-kind="reference" data-tag-owner-uid="a" data-tag-block="entry">${full().replaceAll('data-tag-kind="body"', 'data-tag-kind="reference"').replaceAll('data-tag-block="a"', 'data-tag-block="entry"')}</g>`;
it.each(["rooted legend frames", "cable end blocks"])(
  "rejects different reference keys for one UID across %s",
  async (kind) => {
    const input = structuredClone(ir);
    input.deviceTypes[0].terminals.push({ key: "X1.2" });
    const entry = referenceEntry().replace(
      'data-device-reference-entry="true"',
      'data-device-legend-entry="true" data-device-reference-entry="true"',
    );
    const other = entry
      .replaceAll("X1.1", "X1.2")
      .replaceAll('data-tag-block="entry"', 'data-tag-block="entry-2"');
    const keys =
      qualifiedKey() +
      qualifiedKey().replaceAll("X1.1", "X1.2").replace('y="70"', 'y="85"');
    const block = (content, x) =>
      `<g data-device-legend="${kind}" transform="translate(${x} 0)">${content}</g>`;
    const good = await openSheet(page, svg(block(entry, 0) + keys));
    expect(deviceTags(good, input, refs, true)).toEqual([]);
    expect(good.deviceLegendEntries).toHaveLength(1);
    expect(good.deviceReferenceEntries).toHaveLength(1);
    const sharedOnly = await openSheet(
      page,
      svg(
        block(entry.replace('data-device-reference-entry="true"', ""), 0) +
          keys,
      ),
    );
    expect(sharedOnly.deviceReferenceEntries).toEqual([]);
    expect(deviceTags(sharedOnly, input, refs, true)).toEqual([]);
    for (const second of [
      other,
      other.replace("<g ", '<g style="display:none" '),
    ]) {
      const bad = await openSheet(
        page,
        svg(block(entry, 0) + block(second, 80) + keys),
      );
      expect(deviceTags(bad, input, refs, true)).toContainEqual(
        expect.objectContaining({
          kind: "duplicate-device-reference-entry",
          designation: "TB 1",
          entries: 2,
        }),
      );
      expect(bad.devices).toEqual([]);
      expect(bad.terminals).toEqual([]);
    }
  },
);
it("requires exact same-sheet owned qualified reference keys and rejects hidden duplicates without adding electrical appearances", async () => {
  const g = await openSheet(page, svg(referenceEntry() + qualifiedKey()));
  expect(deviceTags(g, ir, refs, true)).toEqual([]);
  expect(g.devices).toEqual([]);
  expect(g.terminals).toEqual([]);
  for (const key of [
    "",
    qualifiedKey("TB 10.X1.1"),
    qualifiedKey("TB 1.X1.10"),
    qualifiedKey("TB 1."),
    qualifiedKey().replace(
      "deviceUid&quot;:&quot;a",
      "deviceUid&quot;:&quot;foreign",
    ),
    qualifiedKey(undefined, 'opacity="0"'),
    qualifiedKey(undefined, 'transform="translate(300 0)"'),
    qualifiedKey(undefined, 'fill="white"'),
  ]) {
    const bad = await openSheet(page, svg(referenceEntry() + key));
    expect(
      deviceTags(bad, ir, refs, true).some(
        (f) => f.kind === "invalid-device-reference-key",
      ),
    ).toBe(true);
  }
  await openSheet(page, svg(qualifiedKey()));
  expect(
    deviceTags(await openSheet(page, svg(referenceEntry())), ir, refs, true)
      .length,
  ).toBeGreaterThan(0);
  const duplicate = await openSheet(
    page,
    svg(
      referenceEntry() +
        referenceEntry().replace("<g ", '<g style="display:none" ') +
        qualifiedKey(),
    ),
  );
  expect(
    deviceTags(duplicate, ir, refs, true).some(
      (f) => f.kind === "duplicate-device-reference-entry",
    ),
  ).toBe(true);
  const onlyDesignation = referenceEntry().replace(
    /<text[^>]+data-tag-field="(?:part|description)"[^>]*>[^<]*<\/text>/g,
    "",
  );
  expect(
    deviceTags(
      await openSheet(page, svg(onlyDesignation + qualifiedKey())),
      ir,
      refs,
      true,
    ).flatMap((f) => f.missing ?? []),
  ).toEqual(["authored part P/1-A", "authored description"]);
});

it.each([
  ['fill="#fafafa"', (s) => s],
  [
    'fill="black"',
    (s) => '<rect x="12" y="21" width="65" height="5" fill="black"/>' + s,
  ],
  ["", (s) => `<g style="filter:opacity(0)">${s}</g>`],
  ['style="filter:blur(2px)"', (s) => s],
  ["", (s) => `<g transform="scale(0.05 1)">${s}</g>`],
  ['textLength="0.5" lengthAdjust="spacingAndGlyphs"', (s) => s],
  ['stroke="white" stroke-width="4" paint-order="fill stroke"', (s) => s],
])(
  "#206 refuses invisible, filtered or squeezed row %s",
  async (attrs, wrap) => {
    expect(await missingDescription(descriptionWith(attrs, wrap))).toContain(
      "authored description",
    );
  },
);
it.each([
  '<image x="12" y="21" width="65" height="5" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22white%22/%3E%3C/svg%3E"/>',
  '<foreignObject x="12" y="21" width="65" height="5"><div xmlns="http://www.w3.org/1999/xhtml" style="background:white;width:100%;height:100%">cover</div></foreignObject>',
  '<defs><linearGradient id="cover"><stop stop-color="white"/></linearGradient></defs><rect x="12" y="21" width="65" height="5" fill="url(#cover)"/>',
  '<path d="M12 24 L77 24" stroke="white" stroke-width="6"/>',
  '<text x="15" y="25" font-size="2.7" fill="white">Field terminals</text>',
])("#206 later paint covers owned text: %s", async (cover) => {
  expect(await missingDescription(descriptionWith() + cover)).toContain(
    "authored description",
  );
});
it("#206 white text on the actual dark band passes; a paint server underneath fails closed", async () => {
  const band = '<rect x="12" y="21" width="65" height="5" fill="black"/>';
  expect(
    await missingDescription(band + descriptionWith('fill="white"')),
  ).toEqual([]);
  const pattern =
    '<defs><pattern id="p" width="1" height="1" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="black"/></pattern></defs>';
  expect(
    await missingDescription(
      pattern +
        band.replace('fill="black"', 'fill="url(#p)"') +
        descriptionWith('fill="white"'),
    ),
  ).toContain("authored description");
});
it("#206 reference tag rows use the 2.3 mm vertical floor", async () => {
  const source = svg(
    referenceEntry().replaceAll('font-size="2.7"', 'font-size="2.3"') +
      qualifiedKey(),
  );
  const g = classifyTextGeometry(await openSheet(page, source), ir);
  expect(
    g.texts
      .filter((t) => t.tagKind === "reference")
      .every((t) => t.secondaryReference),
  ).toBe(true);
  expect(deviceTags(g, ir, refs, true)).toEqual([]);
  const small = classifyTextGeometry(
    await openSheet(
      page,
      source.replaceAll('font-size="2.3"', 'font-size="2.2"'),
    ),
    ir,
  );
  expect(deviceTags(small, ir, refs, true).length).toBeGreaterThan(0);
});

it("#206 contrast follows translucent later paint and the final opaque background", async () => {
  const cover =
    '<rect x="12" y="21" width="65" height="5" fill="white" opacity="0.9"/>';
  expect(await missingDescription(descriptionWith() + cover)).toContain(
    "authored description",
  );
  const server =
    '<defs><pattern id="old" width="1" height="1"><rect width="1" height="1" fill="black"/></pattern></defs><rect x="12" y="21" width="65" height="5" fill="url(#old)"/>';
  const white = '<rect x="12" y="21" width="65" height="5" fill="white"/>';
  expect(await missingDescription(server + white + descriptionWith())).toEqual(
    [],
  );
  expect(await missingDescription(server + descriptionWith())).toContain(
    "authored description",
  );
});
it("#206 a same-colour own stroke preserves contrasting lettering", async () => {
  expect(
    await missingDescription(
      descriptionWith('stroke="black" stroke-width="1"'),
    ),
  ).toEqual([]);
});
it("#206 reference roles require native qualified ink, not just a reference flag", async () => {
  const source = svg(
    referenceEntry().replaceAll('font-size="2.7"', 'font-size="2.3"') +
      qualifiedKey("FOREIGN.X1.1"),
  );
  const g = classifyTextGeometry(await openSheet(page, source), ir);
  expect(
    g.texts
      .filter((t) => t.tagBlock === "entry")
      .every((t) => !t.secondaryReference),
  ).toBe(true);
  expect(deviceTags(g, ir, refs, true).length).toBeGreaterThan(0);
});

it("#206 erased earlier glyphs cannot provide a contrasting background", async () => {
  const earlier =
    '<text x="15" y="25" font-size="2.7" fill="black">Field terminals</text>';
  expect(
    await missingDescription(earlier + descriptionWith('fill="white"')),
  ).toContain("authored description");
});

it("#206 natural font advance differences do not shrink the physical em", async () => {
  const input = structuredClone(ir);
  input.devices[0].description = "OL1";
  const source = svg(
    body(
      full()
        .replace("Field terminals", "OL1")
        .replace(/<text[^>]*data-tag-field="description"[^>]*>/, (tag) =>
          tag
            .replace('font-size="2.7"', 'font-size="2.5"')
            .replace("<text ", '<text letter-spacing="-0.05" '),
        ),
    ),
  ).replace(
    "<svg ",
    '<svg font-family="Thermite Sans, Thermite Math, sans-serif" ',
  );
  const g = await openSheet(page, source);
  const row = g.texts.find((t) => t.tagField === "description");
  expect(row.fontSize).toBeCloseTo(2.5, 5);
  expect(deviceTags(g, input, refs, true)).toEqual([]);
});

it.each(["fallback", "embedded"])(
  "R2 painted horizontal factors use the actual %s face and both SVG adjustment mechanisms",
  async (face) => {
    const deliver = async (content) => {
      content = content.replace(
        /<text[^>]*data-tag-field="description"[^>]*>/,
        (tag) => tag.replace('font-size="2.7"', 'font-size="2.5"'),
      );
      const source = svg(body(content)).replace(
        "<svg ",
        `<svg font-family="${face === "embedded" ? "Thermite Sans, Thermite Math, sans-serif" : "Arial, sans-serif"}" `,
      );
      if (face === "fallback") return source;
      const { embedPrintableFont } =
        await import("../../packages/cli/dist/printable-font.js");
      return embedPrintableFont(source);
    };
    await openSheet(page, await deliver(descriptionWith()));
    const nativeAdvance = await page.evaluate(() =>
      document
        .querySelector('[data-tag-field="description"]')
        .getComputedTextLength(),
    );
    for (const mechanism of [
      "transform",
      "relative-transform",
      "textLength",
      "parent-textLength",
      "leaf-span-textLength",
    ]) {
      for (const [factor, allowed] of [
        [0.5, false],
        [0.95, true],
        [1.05, false],
        [0.909, false],
        [0.9091, true],
        [0.91, true],
        [1, true],
      ]) {
        let content = mechanism.includes("transform")
          ? descriptionWith("", (s) => {
              const vertical = mechanism === "relative-transform" ? 1.2 : 1;
              return `<g transform="translate(15 25) scale(${factor * vertical} ${vertical}) translate(-15 -25)">${s}</g>`;
            })
          : descriptionWith(
              `textLength="${nativeAdvance * factor}" lengthAdjust="spacingAndGlyphs"`,
            );
        if (mechanism === "parent-textLength")
          content = content.replace(
            ">Field terminals<",
            "><tspan>Field terminals</tspan><",
          );
        if (mechanism === "leaf-span-textLength") {
          content = descriptionWith().replace(
            ">Field terminals<",
            `><tspan textLength="${nativeAdvance * factor}" lengthAdjust="spacingAndGlyphs">Field terminals</tspan><`,
          );
        }
        const g = await openSheet(page, await deliver(content));
        const findings = deviceTags(g, ir, refs, true);
        expect(findings.length === 0, `${face} ${mechanism} ${factor}`).toBe(
          allowed,
        );
        expect(
          g.texts.find((t) => t.tagField === "description").tagHorizontalFactor,
        ).toBeCloseTo(factor, 4);
      }
    }
  },
);

it("R2 uniform root scale on fractional CSS pixels is not horizontal stretching", async () => {
  const pageSize = (content) =>
    svg(body(content))
      .replace('width="200mm"', 'width="420mm"')
      .replace('height="120mm"', 'height="297mm"')
      .replace('viewBox="0 0 200 120"', 'viewBox="0 0 420 297"');
  const good = await openSheet(page, pageSize(descriptionWith()));
  expect(deviceTags(good, ir, refs, true)).toEqual([]);
  expect(
    good.texts.find((t) => t.tagField === "description").tagHorizontalFactor,
  ).toBeCloseTo(1, 6);
  const stretched = await openSheet(
    page,
    pageSize(
      descriptionWith(
        "",
        (s) =>
          `<g transform="translate(15 25) scale(1.05 1) translate(-15 -25)">${s}</g>`,
      ),
    ),
  );
  expect(
    deviceTags(stretched, ir, refs, true).flatMap((f) => f.missing ?? []),
  ).toContain("authored description");
});
