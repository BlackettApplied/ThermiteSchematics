import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { deviceTags } from "./checks.mjs";
const device = (uid = "a", designation = "K1", extra = {}) => ({
  uid,
  designation,
  typeId: "t",
  description: "Feed contactor",
  ...extra,
});
const data = (devices = [device()]) => ({
  devices,
  deviceTypes: [
    {
      id: "t",
      description: "Type text",
      catalog: { orderNumber: "P-1" },
      terminals: [{ key: "2" }, { key: "X1.1" }],
    },
  ],
});
const row = (field, text, extra = {}) => ({
  text,
  renderedString: text,
  tagOwnerUid: "a",
  tagKind: "body",
  tagBlock: "a",
  tagField: field,
  tagPainted: true,
  tagOwnershipValid: true,
  order: 1,
  ...extra,
});
const complete = (extra = {}) => [
  row("designation", "K1", extra),
  row("description", "Feed contactor", extra),
  row("part", "P-1", extra),
];
const geometry = (texts, extra = {}) => ({
  texts,
  devices: [],
  terminals: [],
  deviceReferences: [],
  ...extra,
});
const check = (texts, ir = data(), refs = [{ deviceUid: "a" }], extra = {}) =>
  deviceTags(geometry(texts, extra), ir, refs, true);

describe("DQ-06 independent owned-field oracle", () => {
  it("requires one complete local block per UID, not one per pole", () => {
    expect(
      check(complete(), data(), [{ deviceUid: "a" }, { deviceUid: "a" }]),
    ).toEqual([]);
    expect(check([])[0].missing).toEqual([
      "authored part P-1",
      "designation",
      "authored description",
    ]);
    expect(
      check([
        row("designation", "K1"),
        row("description", "Feed contactor", { tagBlock: "other" }),
        row("part", "P-1"),
      ])[0].missing,
    ).toEqual(["authored description"]);
  });
  it.each([
    "tagOwnerUid",
    "tagOwnershipValid",
    "tagPainted",
    "tagField",
    "tagKind",
  ])("rejects wrong %s", (field) => {
    expect(
      check(
        complete({
          [field]:
            field.startsWith("tagP") || field.endsWith("Valid")
              ? false
              : "wrong",
        }),
      ),
    ).toHaveLength(1);
  });
  it("does not borrow shared text from another device, an unowned title, or another sheet", () => {
    const ir = data([device(), device("b", "K2")]);
    expect(
      check(complete(), ir, [{ deviceUid: "a" }, { deviceUid: "b" }])[0]
        .designation,
    ).toBe("K2");
    expect(check([{ text: "K1 Feed contactor P-1" }])[0].missing).toHaveLength(
      3,
    );
    expect(check(complete())).toEqual([]);
    expect(check([], data(), [{ deviceUid: "a" }])).toHaveLength(1);
  });
  it("checks authored fallback, absent fields and explicit strings without inferred ratings", () => {
    expect(
      check(
        [
          row("designation", "K1"),
          row("description", "Type text"),
          row("part", "P-1"),
        ],
        data([device("a", "K1", { description: " \t" })]),
      ),
    ).toEqual([]);
    expect(
      check([row("designation", "K1")], {
        devices: [device("a", "K1", { description: undefined })],
      }),
    ).toEqual([]);
    expect(
      check(complete(), data([device("a", "K1", { rating: "24 V" })]))[0]
        .missing,
    ).toEqual(["rating"]);
  });
  it("reassembles only complete owned fields, retaining literal part punctuation", () => {
    const rows = [
      row("designation", "K1"),
      row("description", "Feed"),
      row("description", "contactor", { order: 2 }),
      row("part", "P-"),
      row("part", "1", { order: 2 }),
    ];
    expect(check(rows)).toEqual([]);
    expect(
      check(
        rows.map((r) => (r.text === "P-" ? { ...r, renderedString: "P" } : r)),
      )[0].missing,
    ).toContain("authored part P-1");
  });
  it.each(["TB1", "TB.1", "TB 1"])(
    "resolves exact qualified terminal identities for %s",
    (designation) => {
      const ir = data([device("a", designation)]);
      const attrs = {
        tagKind: "reference",
        tagTerminal: { deviceUid: "a", terminalKey: "2" },
      };
      const rows = [row("designation", `Off-view at ${designation}.2`, attrs)];
      expect(check(rows, ir)[0].missing).not.toContain("designation");
      for (const text of [
        `${designation}0.2`,
        `${designation}.20`,
        `${designation}.foreign`,
      ])
        expect(
          check([row("designation", text, attrs)], ir)[0].missing,
        ).toContain("designation");
      expect(
        check(
          [
            row("designation", `${designation}.2`, {
              ...attrs,
              tagTerminal: { deviceUid: "b", terminalKey: "2" },
            }),
          ],
          ir,
        )[0].missing,
      ).toContain("designation");
    },
  );
  it("validates local reference keys even with a complete tag; references cannot masquerade as appearances", () => {
    const ref = { deviceUid: "a", tagBlock: "end", tagRef: "a" };
    const endpoint = row("designation", "K1.X1.1", {
      tagKind: "reference",
      tagBlock: "end",
      tagTerminal: { deviceUid: "a", terminalKey: "X1.1" },
    });
    expect(
      check([...complete(), endpoint], data(), [], { deviceReferences: [ref] }),
    ).toEqual([]);
    expect(
      check([...complete(), endpoint], data(), [], {
        deviceReferences: [{ ...ref, tagRef: "broken" }],
      })[0].kind,
    ).toBe("invalid-device-tag-reference");
    expect(
      check(complete({ tagKind: "reference" }), data(), [], {
        devices: [{ deviceUid: "a", tagKind: "reference" }],
      }).some((f) => f.kind === "invalid-device-reference-key"),
    ).toBe(true);
  });
  it("does not let a missing packet reference hide a visible device or terminal", () => {
    expect(
      check([], data(), [], { devices: [{ deviceUid: "a" }] }),
    ).toHaveLength(1);
    expect(
      check([], data(), [], { terminals: [{ deviceUid: "a" }] }),
    ).toHaveLength(1);
  });
});

const pilotTypes = new URL(
  "../../libraries/siemens-et200pro-pilot/types/",
  import.meta.url,
);
const spacedTypes = readdirSync(pilotTypes)
  .flatMap(
    (name) => JSON.parse(readFileSync(new URL(name, pilotTypes), "utf8")).types,
  )
  .filter((t) => t.catalog.orderNumber.includes(" + "));
it.each(spacedTypes)(
  "matches wrapped spaced Siemens order number $id literally",
  (type) => {
    const part = type.catalog.orderNumber;
    const ir = {
      devices: [device("a", "K1", { description: undefined })],
      deviceTypes: [{ ...type, id: "t", description: undefined }],
    };
    const rows = (parts) => [
      row("designation", "K1"),
      ...parts.map((s, i) => row("part", s, { order: i + 2 })),
    ];
    expect(check(rows([part]), ir)).toEqual([]);
    expect(
      check(
        rows(part.split(" + ").map((s, i) => (i === 0 ? s + " +" : s))),
        ir,
      ),
    ).toEqual([]);
    expect(
      check(
        rows(part.split(" + ").map((s, i) => (i === 0 ? s + " + " : s))),
        ir,
      ),
    ).toEqual([]);
    for (const wrong of [
      part.replace(" + ", "+"),
      part.replace(" + ", "  + "),
      part.replace("-", "/"),
      part.toLowerCase(),
    ])
      expect(check(rows([wrong]), ir)[0].missing).toContain(
        `authored part ${part}`,
      );
  },
);
it("requires body-owned fields if the sheet has a body appearance", () => {
  const reference = [
    ...complete({ tagKind: "reference", tagBlock: "ref", tagKey: "K1.2" }),
    row("designation", "K1.2", {
      tagKind: "reference",
      tagBlock: "endpoint",
      tagTerminal: { deviceUid: "a", terminalKey: "2" },
    }),
  ];
  expect(check(reference, data(), [{ deviceUid: "a" }])).toEqual([]);
  expect(
    check(reference, data(), [], { devices: [{ deviceUid: "a" }] }).find(
      (f) => f.kind === "missing-device-tag-fields",
    ).missing,
  ).toHaveLength(3);
  expect(
    check([...complete(), ...reference], data(), [], {
      devices: [{ deviceUid: "a" }],
    }).some((f) => f.kind === "invalid-device-reference-key"),
  ).toBe(true);
});
it("does not Unicode-normalise literal parts or descriptions", () => {
  const ir = data([device("a", "K1", { description: "Café" })]);
  expect(
    check(
      [
        row("designation", "K1"),
        row("part", "P-1"),
        row("description", "Cafe\u0301"),
      ],
      ir,
    )[0].missing,
  ).toEqual(["authored description"]);
  expect(
    check(
      [
        row("designation", "K1"),
        row("part", "P-1"),
        row("description", "Café"),
      ],
      ir,
    ),
  ).toEqual([]);
});

describe("DQ-06 keyed rooted sheet legend", () => {
  const legend = () =>
    complete({
      tagKind: "legend",
      tagBlock: "legend:a",
      tagContainer: "entry-1",
      tagKey: "K1",
      fontSize: 2.7,
    });
  const context = {
    devices: [{ deviceUid: "a" }],
    viewFormat: "schematic-view/0.1",
    viewFamily: "control",
  };
  const key = () =>
    row(undefined, "K1", { tagKey: "K1", tagContainer: "body", fontSize: 2.5 });
  it("accepts exactly one complete legend with a painted owned local body key", () => {
    expect(
      check([key(), ...legend()], data(), [{ deviceUid: "a" }], context),
    ).toEqual([]);
    expect(
      check([key(), ...legend()], data(), [{ deviceUid: "a" }], {
        ...context,
        viewFamily: "power",
      }),
    ).toEqual([]);
  });
  it("requires the exact key on this body's sheet, never another sheet or a reference", () => {
    for (const keys of [
      [],
      [row("designation", "OTHER")],
      [row("designation", "K1", { tagOwnerUid: "foreign" })],
      [row("designation", "K1", { tagKind: "reference" })],
      [row("designation", "K1", { tagPainted: false })],
    ])
      expect(
        check(
          [...keys, ...legend()],
          data(),
          [{ deviceUid: "a" }],
          context,
        ).some((f) => f.kind === "invalid-device-legend-key"),
      ).toBe(true);
    const first = check([key()], data(), [{ deviceUid: "a" }], context),
      second = check(legend(), data(), [{ deviceUid: "a" }], context);
    expect(first.length).toBeGreaterThan(0);
    expect(second.some((f) => f.kind === "invalid-device-legend-key")).toBe(
      true,
    );
  });
  it("rejects a wrong legend key, duplicate entry and use in another drawing family", () => {
    expect(
      check(
        [key(), ...legend().map((t) => ({ ...t, tagKey: "K2" }))],
        data(),
        [{ deviceUid: "a" }],
        context,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      check(
        [
          key(),
          ...legend(),
          ...legend().map((t) => ({ ...t, tagContainer: "entry-2" })),
        ],
        data(),
        [{ deviceUid: "a" }],
        context,
      ).some((f) => f.kind === "duplicate-device-legend-entry"),
    ).toBe(true);
    expect(
      check([key(), ...legend()], data(), [{ deviceUid: "a" }], {
        ...context,
        viewFormat: "documentation-view/0.1",
        viewFamily: "wiring",
      }).length,
    ).toBeGreaterThan(0);
  });
  it("rejects absent/hidden/small/incomplete fields and preserves the body/reference rule", () => {
    for (const rows of [
      legend().filter((t) => t.tagField !== "part"),
      legend().map((t) => ({ ...t, tagPainted: false })),
      legend().map((t) => ({ ...t, fontSize: 2.4 })),
      legend().map((t) => ({ ...t, tagKind: "reference" })),
    ])
      expect(
        check([key(), ...rows], data(), [{ deviceUid: "a" }], context).length,
      ).toBeGreaterThan(0);
  });
});

it.each(["TB1", "TB.1", "TB 1"])(
  "requires an exact qualified key for a complete reference entry owned by %s",
  (designation) => {
    const ir = data([device("a", designation)]),
      entry = complete({
        tagKind: "reference",
        tagBlock: "entry",
        tagContainer: "entry-1",
        tagKey: `${designation}.2`,
      }).map((r) =>
        r.tagField === "designation"
          ? { ...r, text: designation, renderedString: designation }
          : r,
      ),
      endpoint = (text) =>
        row("designation", text, {
          tagKind: "reference",
          tagBlock: "endpoint",
          tagTerminal: { deviceUid: "a", terminalKey: "2" },
        });
    expect(check([...entry, endpoint(`${designation}.2`)], ir)).toEqual([]);
    for (const text of [
      `${designation}0.2`,
      `${designation}.20`,
      `${designation}.`,
    ])
      expect(
        check([...entry, endpoint(text)], ir).some(
          (f) => f.kind === "invalid-device-reference-key",
        ),
      ).toBe(true);
    expect(
      check(
        [...entry, endpoint(`${designation}.2`)],
        ir,
        [{ deviceUid: "a" }],
        {
          deviceReferenceEntries: [
            {
              deviceUid: "a",
              container: "entry-1",
              key: "WRONG",
              kind: "reference",
            },
          ],
        },
      ).some((f) => f.kind === "invalid-device-reference-key"),
    ).toBe(true);
  },
);

it.each(["rooted legend", "cable end blocks"])(
  "counts two qualified keys for one UID as duplicate entries across %s",
  (context) => {
    const ir = data([device("a", "TB 1")]);
    ir.deviceTypes[0].terminals.push({ key: "X1.2" });
    const endpoint = (terminalKey) =>
      row("designation", `Off-view at TB 1.${terminalKey}`, {
        tagKind: "reference",
        tagBlock: terminalKey,
        tagTerminal: { deviceUid: "a", terminalKey },
      });
    const entry = (terminalKey) =>
      complete({
        tagKind: "reference",
        tagBlock: `entry-${terminalKey}`,
        tagContainer: `${context}-${terminalKey}`,
        tagKey: `TB 1.${terminalKey}`,
        tagReferenceEntry: true,
      }).map((r) =>
        r.tagField === "designation"
          ? { ...r, text: "TB 1", renderedString: "TB 1" }
          : r,
      );
    const declaration = (terminalKey) => ({
      deviceUid: "a",
      kind: "reference",
      key: `TB 1.${terminalKey}`,
      container: `${context}-${terminalKey}`,
    });
    const keys = [endpoint("X1.1"), endpoint("X1.2")];
    const declarations = [declaration("X1.1")];
    const extra = (entries) => ({
      viewFamily: "control",
      viewIntent: context === "cable end blocks" ? "conductors" : undefined,
      deviceLegendEntries: entries,
      deviceReferenceEntries: entries,
    });
    expect(
      check(
        [...entry("X1.1"), ...keys],
        ir,
        [{ deviceUid: "a" }],
        extra(declarations),
      ),
    ).toEqual([]);
    expect(
      check(
        [...entry("X1.1"), ...entry("X1.2"), ...keys],
        ir,
        [{ deviceUid: "a" }],
        extra([...declarations, declaration("X1.2")]),
      ),
    ).toContainEqual(
      expect.objectContaining({
        kind: "duplicate-device-reference-entry",
        designation: "TB 1",
        entries: 2,
      }),
    );
  },
);

it("checks trimmed wrap rows against complete independent source spans, including literal whitespace", () => {
  const ir = data([device("a", "K1", { description: "Feed contactor" })]);
  ir.deviceTypes[0].catalog.orderNumber = "P-  1";
  const rows = [
    row("designation", "K1", { tagRowStart: 0, tagRowEnd: 2 }),
    row("description", "Feed", { tagRowStart: 0, tagRowEnd: 5 }),
    row("description", "contactor", {
      tagRowStart: 5,
      tagRowEnd: 14,
      order: 2,
    }),
    row("part", "P-", { tagRowStart: 0, tagRowEnd: 4 }),
    row("part", "1", { tagRowStart: 4, tagRowEnd: 5, order: 2 }),
  ];
  expect(check(rows, ir)).toEqual([]);
  for (const mutation of [
    (r) =>
      r.tagField === "part" && r.text === "P-"
        ? { ...r, renderedString: "P" }
        : r,
    (r) => (r.text === "1" ? { ...r, tagRowStart: 3 } : r),
    (r) => (r.text === "1" ? { ...r, tagRowEnd: 6 } : r),
  ])
    expect(
      check(rows.map(mutation), ir).flatMap((f) => f.missing ?? []),
    ).toContain("authored part P-  1");
});
