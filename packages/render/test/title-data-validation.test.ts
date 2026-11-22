import { describe, expect, it } from "vitest";
import { createAjv2020 } from "@thermite/schema";
import {
  parseInternalPacket,
  parseInternalPresentation,
} from "../src/internal/title-data/parse.js";
import {
  packetSchema,
  presentationSchema,
} from "../src/internal/title-data/schema.js";
import { Issues, validDate } from "../src/internal/title-data/validation.js";
import {
  bindings,
  slots,
  type Result,
} from "../src/internal/title-data/model.js";
const p = (extra: object = {}) => ({
  format: "project-presentation/0.3",
  ...extra,
});
const view = { format: "documentation-view-request/0.1", kind: "bom" };
const q = (extra: object = {}) => ({
  format: "schematic-packet-request/0.2",
  views: [view],
  ...extra,
});
const pp = (extra: object = {}) =>
  parseInternalPresentation(JSON.stringify(p(extra)));
const qp = (extra: object = {}) =>
  parseInternalPacket(JSON.stringify(q(extra)));
const field = (key: string, extra: object = {}) => ({
  titleBlock: { fields: { [key]: { slot: key, label: key, ...extra } } },
});
function rejected(result: Result<unknown>, code: string, pointer: string) {
  expect(result.value).toBeUndefined();
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code, jsonPointer: pointer }),
    ]),
  );
}
const ajv = createAjv2020();
ajv.opts.allowUnionTypes = true;
const schemaP = ajv.compile(presentationSchema),
  schemaQ = ajv.compile(packetSchema);

describe("TB1 internal strict presentation schema", () => {
  it("accepts the compact declarative shape and inherits named fields individually", () => {
    const fields = Object.fromEntries(
      slots.map((slot) => [
        slot,
        {
          slot,
          label: slot,
          ...(slot in bindings
            ? { bind: bindings[slot as keyof typeof bindings] }
            : {}),
        },
      ]),
    );
    expect(
      pp({
        titleBlock: {
          profile: "compact",
          fields,
          lines: ["Source supplied note"],
        },
        frame: {
          header: { text: "Custom header" },
          generatorStamp: "metadata",
          zones: {
            default: { columns: 6, rows: 4 },
            byPaper: {
              letter: { portrait: { columns: 6, rows: 4 } },
              tabloid: {},
              a4: {},
              a3: {},
            },
          },
        },
      }).diagnostics,
    ).toEqual([]);
    expect(pp().diagnostics).toEqual([]);
  });
  it.each(["extended", "unknown"])("rejects profile %s", (profile) =>
    rejected(pp({ titleBlock: { profile } }), "E014", "/titleBlock/profile"),
  );
  it.each(["logo", "staticText", "revisionTable", "geometry", "font", "path"])(
    "rejects unrendered/free-form capability %s",
    (key) =>
      rejected(pp({ titleBlock: { [key]: {} } }), "E012", `/titleBlock/${key}`),
  );
  it.each(["extra1", "extra4", "other"])("rejects unrendered slot %s", (slot) =>
    rejected(
      pp(field("customer", { slot })),
      "E014",
      "/titleBlock/fields/customer/slot",
    ),
  );
  it.each(["default", "byPaper"])("admits only 6x4 in %s", (scope) => {
    const config = (columns: number, rows: number) => ({
      frame: {
        zones:
          scope === "default"
            ? { default: { columns, rows } }
            : { byPaper: { tabloid: { landscape: { columns, rows } } } },
      },
    });
    expect(pp(config(6, 4)).diagnostics).toEqual([]);
    for (const pair of [
      [7, 4],
      [8, 4],
      [6, 5],
      [5, 4],
      [6, 3],
    ])
      rejected(
        pp(config(...(pair as [number, number]))),
        "E014",
        `/frame/zones/${scope === "default" ? "default" : "byPaper/tabloid/landscape"}/${pair[0] === 6 ? "rows" : "columns"}`,
      );
    rejected(
      pp(config(6.5, 4)),
      "E011",
      `/frame/zones/${scope === "default" ? "default" : "byPaper/tabloid/landscape"}/columns`,
    );
  });
  it.each([
    [{ surprise: true }, "/surprise"],
    [{ page: { width: 100 } }, "/page/width"],
    [
      { frame: { zones: { byPaper: { legal: {} } } } },
      "/frame/zones/byPaper/legal",
    ],
    [
      { frame: { zones: { byPaper: { a4: { upsideDown: {} } } } } },
      "/frame/zones/byPaper/a4/upsideDown",
    ],
    [
      { frame: { zones: { default: { columns: 6, rows: 4, pitch: 3 } } } },
      "/frame/zones/default/pitch",
    ],
    [
      { frame: { header: { text: "Title", font: "serif" } } },
      "/frame/header/font",
    ],
    [
      field("customer", { markup: "<b>yes</b>" }),
      "/titleBlock/fields/customer/markup",
    ],
  ])("rejects unknown properties with pointers", (extra, pointer) =>
    rejected(pp(extra), "E012", pointer as string),
  );
  it.each([
    [{ page: { size: "legal" } }, "/page/size"],
    [{ page: { orientation: "diagonal" } }, "/page/orientation"],
    [{ frame: { generatorStamp: "off" } }, "/frame/generatorStamp"],
    [
      field("customer", { bind: "system.user" }),
      "/titleBlock/fields/customer/bind",
    ],
  ])("rejects enums", (extra, pointer) =>
    rejected(pp(extra), "E014", pointer as string),
  );
  it.each([5, 25])("accepts margin boundary %s", (marginMm) =>
    expect(pp({ page: { marginMm } }).diagnostics).toEqual([]),
  );
  it.each([4.999, 25.001])("rejects margin outside boundary %s", (marginMm) =>
    rejected(pp({ page: { marginMm } }), "E015", "/page/marginMm"),
  );
  it("enforces the 64 KiB UTF-8 boundary before parsing and counts bytes", () => {
    const base = JSON.stringify(p({ frame: { header: { text: "é" } } }));
    const exact = base + " ".repeat(65536 - Buffer.byteLength(base));
    expect(parseInternalPresentation(Buffer.from(exact)).diagnostics).toEqual(
      [],
    );
    rejected(parseInternalPresentation(Buffer.from(exact + " ")), "E015", "");
    rejected(parseInternalPresentation(exact + " "), "E015", "");
  });
  it.each([
    ["label", 40, "customer", "é"],
    ["value", 80, "customer", "é"],
    ["value", 80, "drawnBy", "A"],
    ["value", 80, "checkedBy", "A"],
    ["value", 80, "approvedBy", "A"],
    ["value", 128, "drawingNumber", "D"],
    ["pattern", 160, "drawingNumber", "X"],
  ] as const)(
    "enforces code-point bound %s/%s/%s",
    (prop, limit, key, char) => {
      expect(
        pp(field(key, { [prop]: char.repeat(limit) })).diagnostics,
      ).toEqual([]);
      rejected(
        pp(field(key, { [prop]: char.repeat(limit + 1) })),
        "E013",
        `/titleBlock/fields/${key}/${prop}`,
      );
    },
  );
  it("enforces revision and authored-line lengths and line count", () => {
    expect(
      pp({
        revision: "R".repeat(128),
        titleBlock: { lines: Array(4).fill("é".repeat(160)) },
      }).diagnostics,
    ).toEqual([]);
    rejected(pp({ revision: "R".repeat(129) }), "E013", "/revision");
    rejected(pp({ revision: "" }), "E013", "/revision");
    rejected(
      pp({ titleBlock: { lines: ["é".repeat(161)] } }),
      "E013",
      "/titleBlock/lines/0",
    );
    rejected(
      pp({ titleBlock: { lines: [""] } }),
      "E013",
      "/titleBlock/lines/0",
    );
    rejected(
      pp({ titleBlock: { lines: Array(5).fill("note") } }),
      "E015",
      "/titleBlock/lines",
    );
  });
  it("accepts only the ten fixed slot keys in the closed schema", () => {
    for (const key of [
      "project",
      "sheetTitle",
      "drawingNumber",
      "customer",
      "drawnBy",
      "date",
      "checkedBy",
      "approvedBy",
      "revision",
      "sheetNumber",
    ])
      expect(
        schemaP(
          p({ titleBlock: { fields: { [key]: { slot: key, label: "X" } } } }),
        ),
      ).toBe(true);
    for (const key of [
      "custom",
      "",
      "a".repeat(32),
      "aUpper_01",
      "A",
      "a-b",
      "é",
      "a/0",
    ]) {
      expect(
        schemaP(
          p({
            titleBlock: { fields: { [key]: { slot: "customer", label: "X" } } },
          }),
        ),
      ).toBe(false);
      expect(
        schemaP.errors?.some((e) => e.keyword === "additionalProperties"),
      ).toBe(true);
    }
  });
  it.each([
    [field("project"), "/titleBlock/fields/project"],
    [
      field("sheetTitle", { bind: "project.name" }),
      "/titleBlock/fields/sheetTitle",
    ],
    [field("customer", { slot: "drawnBy" }), "/titleBlock/fields/customer"],
    [
      field("customer", { value: "X", pattern: "literal" }),
      "/titleBlock/fields/customer",
    ],
    [
      field("customer", { bind: "project.name" }),
      "/titleBlock/fields/customer/bind",
    ],
    [field("drawnBy", { pattern: "x" }), "/titleBlock/fields/drawnBy/pattern"],
    [field("customer", { value: "  " }), "/titleBlock/fields/customer/value"],
    [field("customer", { label: "  " }), "/titleBlock/fields/customer/label"],
    [
      field("customer", { value: "<b>name</b>" }),
      "/titleBlock/fields/customer/value",
    ],
  ])("rejects presentation cross-field constraints", (extra, pointer) =>
    rejected(pp(extra), "E013", pointer as string),
  );
  it("rejects repeated slots once through the key-slot invariant", () => {
    const result = pp({
      titleBlock: {
        fields: {
          customer: { slot: "customer", label: "Customer" },
          drawnBy: { slot: "customer", label: "Author" },
        },
      },
    });
    expect(result.value).toBeUndefined();
    expect(
      result.diagnostics.map((d) => ({
        code: d.code,
        jsonPointer: d.jsonPointer,
      })),
    ).toEqual([{ code: "E013", jsonPointer: "/titleBlock/fields/drawnBy" }]);
  });
  it.each([
    [{}, "E010", "/format"],
    [{ format: "x" }, "E014", "/format"],
    [{ format: "project-presentation/0.3", page: null }, "E011", "/page"],
    [
      p(field("customer", { label: 1 })),
      "E011",
      "/titleBlock/fields/customer/label",
    ],
    [
      p(field("customer", { value: 1 })),
      "E011",
      "/titleBlock/fields/customer/value",
    ],
    [
      p(field("customer", { value: "" })),
      "E013",
      "/titleBlock/fields/customer/value",
    ],
  ])("preserves E010-E014 categories", (value, code, pointer) =>
    rejected(
      parseInternalPresentation(JSON.stringify(value)),
      code as string,
      pointer as string,
    ),
  );
  it("preserves E002/E003, strict UTF-8, source positions and determinism", () => {
    rejected(parseInternalPresentation('{"format":'), "E002", "");
    rejected(
      parseInternalPresentation(
        '{"format":"project-presentation/0.3","format":"project-presentation/0.3"}',
      ),
      "E003",
      "/format",
    );
    rejected(
      parseInternalPresentation(new Uint8Array([0xc3, 0x28])),
      "E002",
      "",
    );
    const text =
      '{\n "format":"project-presentation/0.3",\n "page":{"marginMm":26}\n}';
    const result = parseInternalPresentation(text, "a\\b.json");
    expect(result).toEqual(parseInternalPresentation(text, "a\\b.json"));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "E015",
        file: "a/b.json",
        line: 3,
        column: 21,
        jsonPointer: "/page/marginMm",
      }),
    );
  });
  it.each([
    "\u0000",
    "\t",
    "\n",
    "\r",
    "\u007f",
    "\u0085",
    "\u2028",
    "\u2029",
    "\u202a",
    "\u202b",
    "\u202c",
    "\u202d",
    "\u202e",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
    "\u200e",
    "\u200f",
    "\u061c",
    "\ud800",
    "\udfff",
    "😀",
  ])("rejects unsafe/unsupported text %j as owned R005", (ch) => {
    const result = pp(field("customer", { value: `A${ch}B` }));
    rejected(result, "R005", "/titleBlock/fields/customer/value");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        ownerKind: "title-field",
        ownerId: "/titleBlock/fields/customer/value",
      }),
    );
  });
});

describe("TB1 packet title metadata", () => {
  it.each([
    ["sheetTitle", 160],
    ["revision", 128],
    ["drawingBase", 128],
  ] as const)("enforces defaults %s length", (key, bound) => {
    expect(
      qp({ titleData: { defaults: { [key]: "é".repeat(bound) } } }).diagnostics,
    ).toEqual([]);
    rejected(
      qp({ titleData: { defaults: { [key]: "é".repeat(bound + 1) } } }),
      "E013",
      `/titleData/defaults/${key}`,
    );
  });
  it.each(["version", "comment", "drawnBy"])(
    "enforces revision row %s limits",
    (key) => {
      const bound = key === "version" ? 32 : key === "comment" ? 160 : 80;
      const row = (n: number) => ({ version: "V", [key]: "é".repeat(n) });
      expect(
        qp({ titleData: { defaults: { revisionRows: [row(bound)] } } })
          .diagnostics,
      ).toEqual([]);
      rejected(
        qp({ titleData: { defaults: { revisionRows: [row(bound + 1)] } } }),
        "E013",
        `/titleData/defaults/revisionRows/0/${key}`,
      );
    },
  );
  it("validates Gregorian dates without using the clock", () => {
    for (const date of [
      "0001-01-01",
      "2000-02-29",
      "2024-02-29",
      "9999-12-31",
    ]) {
      expect(validDate(date)).toBe(true);
      expect(pp(field("date", { value: date })).diagnostics).toEqual([]);
      expect(
        qp({
          titleData: {
            defaults: {
              values: { date },
              revisionRows: [{ version: "V", date }],
            },
          },
        }).diagnostics,
      ).toEqual([]);
    }
    for (const date of [
      "0000-01-01",
      "1900-02-29",
      "2023-02-29",
      "2024-02-30",
      "2024-04-31",
      "2024-00-01",
      "2024-13-01",
      "2024-01-00",
      "2024-01-32",
      "2024-1-01",
      "2024-01-011",
    ]) {
      expect(validDate(date)).toBe(false);
      rejected(
        pp(field("date", { value: date })),
        "E013",
        "/titleBlock/fields/date/value",
      );
      rejected(
        qp({
          titleData: { defaults: { revisionRows: [{ version: "V", date }] } },
        }),
        "E013",
        "/titleData/defaults/revisionRows/0/date",
      );
    }
  });
  it("preserves 40 views, 6 history rows, 100 exact selectors and rejects +1", () => {
    expect(
      qp({
        views: Array(40).fill(view),
        titleData: {
          defaults: { revisionRows: Array(6).fill({ version: "V" }) },
        },
      }).diagnostics,
    ).toEqual([]);
    rejected(qp({ views: Array(41).fill(view) }), "E015", "/views");
    rejected(qp({ views: [] }), "E015", "/views");
    rejected(
      qp({
        titleData: {
          defaults: { revisionRows: Array(7).fill({ version: "V" }) },
        },
      }),
      "E015",
      "/titleData/defaults/revisionRows",
    );
    const exact = Array.from({ length: 101 }, (_, i) => ({
      sheetKey: `sheet/1/${i.toString(16).padStart(64, "0")}`,
    }));
    expect(
      qp({ titleData: { bySheet: exact.slice(0, 100) } }).diagnostics,
    ).toEqual([]);
    rejected(
      qp({ titleData: { bySheet: exact } }),
      "E015",
      "/titleData/bySheet",
    );
    const views = Array.from({ length: 41 }, (_, i) => ({ viewIndex: i + 1 }));
    expect(
      qp({
        views: Array(40).fill(view),
        titleData: { byView: views.slice(0, 40) },
      }).diagnostics,
    ).toEqual([]);
    rejected(
      qp({ views: Array(40).fill(view), titleData: { byView: views } }),
      "E015",
      "/titleData/byView",
    );
  });
  it.each([0, 41, 1.5])("rejects viewIndex %s", (viewIndex) =>
    rejected(
      qp({ titleData: { byView: [{ viewIndex }] } }),
      viewIndex === 1.5 ? "E011" : "E015",
      "/titleData/byView/0/viewIndex",
    ),
  );
  it("rejects duplicate and unused selectors and bound/unknown values", () => {
    for (const by of ["byView", "bySheet"]) {
      const entry =
        by === "byView"
          ? { viewIndex: 1 }
          : { sheetKey: `sheet/1/${"0".repeat(64)}` };
      rejected(
        qp({ titleData: { [by]: [entry, entry] } }),
        "R006",
        `/titleData/${by}/1`,
      );
    }
    rejected(
      qp({ titleData: { byView: [{ viewIndex: 2 }] } }),
      "R006",
      "/titleData/byView/0/viewIndex",
    );
    for (const key of [
      "project",
      "sheetNumber",
      "sheetTitle",
      "revision",
      "unknown",
    ])
      rejected(
        qp({ titleData: { defaults: { values: { [key]: "value" } } } }),
        "R006",
        `/titleData/defaults/values/${key}`,
      );
  });
  it.each([
    [{ titleData: { unknown: 1 } }, "/titleData/unknown"],
    [
      { titleData: { defaults: { project: "X" } } },
      "/titleData/defaults/project",
    ],
    [{ titleData: { defaults: { page: {} } } }, "/titleData/defaults/page"],
    [
      { titleData: { byView: [{ viewIndex: 1, drawingBase: "X" }] } },
      "/titleData/byView/0/drawingBase",
    ],
    [
      {
        titleData: {
          bySheet: [{ sheetKey: `sheet/1/${"0".repeat(64)}`, extra: true }],
        },
      },
      "/titleData/bySheet/0/extra",
    ],
    [
      {
        titleData: {
          defaults: { revisionRows: [{ version: "V", approvedBy: "X" }] },
        },
      },
      "/titleData/defaults/revisionRows/0/approvedBy",
    ],
  ])("rejects unknown metadata fields", (extra, pointer) =>
    rejected(qp(extra), "E012", pointer as string),
  );
  it("validates required selector/row fields, types, keys, null and text", () => {
    rejected(
      qp({ titleData: { byView: [{}] } }),
      "E010",
      "/titleData/byView/0/viewIndex",
    );
    rejected(
      qp({ titleData: { bySheet: [{}] } }),
      "E010",
      "/titleData/bySheet/0/sheetKey",
    );
    rejected(
      qp({ titleData: { bySheet: [{ sheetKey: "sheet 1" }] } }),
      "E013",
      "/titleData/bySheet/0/sheetKey",
    );
    rejected(
      qp({ titleData: { defaults: { revisionRows: [{}] } } }),
      "E010",
      "/titleData/defaults/revisionRows/0/version",
    );
    rejected(
      qp({ titleData: { defaults: { values: { drawnBy: 12 } } } }),
      "E011",
      "/titleData/defaults/values/drawnBy",
    );
    rejected(
      qp({ titleData: { defaults: { revisionRows: null } } }),
      "E011",
      "/titleData/defaults/revisionRows",
    );
    rejected(
      qp({ titleData: { defaults: { values: { drawnBy: "x\u202e" } } } }),
      "R005",
      "/titleData/defaults/values/drawnBy",
    );
    expect(
      qp({
        titleData: {
          defaults: {
            values: { drawnBy: null },
            drawingBase: null,
            sheetTitle: null,
            revision: null,
            revisionRows: [],
          },
        },
      }).diagnostics,
    ).toEqual([]);
    for (const key of ["a".repeat(32), "a".repeat(33)])
      expect(
        schemaQ(q({ titleData: { defaults: { values: { [key]: null } } } })),
      ).toBe(key.length === 32);
  });
});

describe("TB1 schema boundary probes", () => {
  it("bounds the published customer value at the semantic limit", () => {
    expect(schemaP(p(field("customer", { value: "é".repeat(80) })))).toBe(true);
    expect(schemaP(p(field("customer", { value: "é".repeat(81) })))).toBe(
      false,
    );
  });
  it("bounds each packet value, including specialized names and DWG numbers", () => {
    for (const [key, bound] of [
      ["customer", 80],
      ["drawnBy", 80],
      ["checkedBy", 80],
      ["approvedBy", 80],
      ["drawingNumber", 128],
    ] as const) {
      expect(
        qp({
          titleData: { defaults: { values: { [key]: "é".repeat(bound) } } },
        }).diagnostics,
      ).toEqual([]);
      rejected(
        qp({
          titleData: { defaults: { values: { [key]: "é".repeat(bound + 1) } } },
        }),
        "E013",
        `/titleData/defaults/values/${key}`,
      );
    }
    expect(
      schemaQ(
        q({
          titleData: { defaults: { values: { customer: "é".repeat(160) } } },
        }),
      ),
    ).toBe(true);
    expect(
      schemaQ(
        q({
          titleData: { defaults: { values: { customer: "é".repeat(161) } } },
        }),
      ),
    ).toBe(false);
  });
  it("rejects blank/minimum strings and incorrect types without ignoring them", () => {
    rejected(
      pp(field("customer", { label: "" })),
      "E013",
      "/titleBlock/fields/customer/label",
    );
    rejected(
      pp(field("drawingNumber", { pattern: "" })),
      "E013",
      "/titleBlock/fields/drawingNumber/pattern",
    );
    for (const key of ["sheetTitle", "revision", "drawingBase"])
      rejected(
        qp({ titleData: { defaults: { [key]: "" } } }),
        "E013",
        `/titleData/defaults/${key}`,
      );
    for (const [key, value] of [
      ["version", ""],
      ["drawnBy", ""],
      ["date", null],
    ] as const)
      rejected(
        qp({
          titleData: {
            defaults: { revisionRows: [{ version: "V", [key]: value }] },
          },
        }),
        key === "date" ? "E011" : "E013",
        `/titleData/defaults/revisionRows/0/${key}`,
      );
    expect(
      qp({
        titleData: {
          defaults: { revisionRows: [{ version: "V", comment: "" }] },
        },
      }).diagnostics,
    ).toEqual([]);
    for (const [extra, pointer] of [
      [{ titleData: [] }, "/titleData"],
      [
        { titleData: { defaults: { values: [] } } },
        "/titleData/defaults/values",
      ],
      [{ index: 1 }, "/index"],
      [{ views: [null] }, "/views/0"],
      [{ layout: 1 }, "/layout"],
    ] as const)
      rejected(qp(extra), pointer === "/layout" ? "E014" : "E011", pointer);
    rejected(
      parseInternalPresentation(
        '{"format":"project-presentation/0.3","page":{"marginMm":1e400}}',
      ),
      "E011",
      "/page/marginMm",
    );
  });
  it("rejects all deferred capabilities even when their future-limit values are bounded", () => {
    for (const text of [
      "x".repeat(700),
      "x".repeat(701),
      Array(8).fill("line").join("\n"),
      Array(9).fill("line").join("\n"),
    ])
      rejected(
        pp({ titleBlock: { staticText: { text } } }),
        "E012",
        "/titleBlock/staticText",
      );
  });
});

it("rejects malformed UTF-8 inside an otherwise valid string before glyph validation", () => {
  const prefix = Buffer.from(
    '{"format":"project-presentation/0.3","titleBlock":{"fields":{"customer":{"slot":"customer","label":"Customer","value":"',
  );
  const suffix = Buffer.from('"}}}}');
  rejected(
    parseInternalPresentation(
      Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), suffix]),
    ),
    "E002",
    "",
  );
});

it("counts Unicode code points independently from printable-glyph admission", async () => {
  const { checkLiteral } =
    await import("../src/internal/title-data/validation.js");
  for (const [n, over] of [
    [80, false],
    [81, true],
  ] as const) {
    const issues = new Issues("presentation.json");
    checkLiteral("😀".repeat(n), "drawnBy", "/value", issues);
    expect(issues.diagnostics.some((d) => d.code === "E013")).toBe(over);
  }
  expect(schemaP(p(field("customer", { value: "😀".repeat(80) })))).toBe(true);
  expect(schemaP(p(field("customer", { value: "😀".repeat(81) })))).toBe(false);
});
it("reports packet semantic reasons beneath invalid-packet", () => {
  const cases = [
    [
      qp({ titleData: { byView: [{ viewIndex: 1 }, { viewIndex: 1 }] } }),
      "duplicate-title-slot",
    ],
    [
      qp({ titleData: { defaults: { values: { unknown: "X" } } } }),
      "unknown-title-field",
    ],
    [qp({ titleData: { byView: [{ viewIndex: 2 }] } }), "unresolved-sheet-key"],
  ] as const;
  for (const [result, reason] of cases)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "R006",
        reason: "invalid-packet",
        details: { reason },
      }),
    );
});

it("rejects two otherwise valid DWG value mechanisms", () =>
  rejected(
    pp(field("drawingNumber", { value: "D", pattern: "{drawingBase}" })),
    "E013",
    "/titleBlock/fields/drawingNumber",
  ));

it.each(slots)("rejects every missing policy on built-in %s", (slot) => {
  for (const missing of ["blank", "unspecified", "omit"]) {
    const bind = bindings[slot as keyof typeof bindings];
    rejected(
      pp(field(slot, { ...(bind ? { bind } : {}), missing })),
      "E012",
      `/titleBlock/fields/${slot}/missing`,
    );
  }
});
it("gates null headers and bounds nonblank header text at 160/+1", () => {
  for (const text of ["Header", "é".repeat(160)])
    expect(pp({ frame: { header: { text } } }).diagnostics).toEqual([]);
  rejected(
    pp({ frame: { header: { text: null } } }),
    "E011",
    "/frame/header/text",
  );
  for (const text of ["", "  ", "é".repeat(161), "X".repeat(5000)])
    rejected(pp({ frame: { header: { text } } }), "E013", "/frame/header/text");
});
it.each(["\u00ad", "\u2060", "\u200b", "\u200c", "\u200d", "\ufeff", "\u202e"])(
  "rejects Cf format character %j in all title sources",
  (ch) => {
    rejected(pp({ revision: `A${ch}B` }), "R005", "/revision");
    rejected(
      pp({ frame: { header: { text: `A${ch}B` } } }),
      "R005",
      "/frame/header/text",
    );
    rejected(
      qp({ titleData: { defaults: { values: { drawnBy: `A${ch}B` } } } }),
      "R005",
      "/titleData/defaults/values/drawnBy",
    );
  },
);
it.each(["A<B and C>D", "x < y and z > w", "R<5 ohm"])(
  "accepts literal comparisons %s",
  (value) => expect(pp(field("customer", { value })).diagnostics).toEqual([]),
);
it.each([
  "<b>name</b>",
  '<g id="test"/>',
  "<input disabled>",
  "<script>alert(1)</script>",
])("rejects tag syntax %s", (value) =>
  rejected(
    pp(field("customer", { value })),
    "E013",
    "/titleBlock/fields/customer/value",
  ),
);
it("keeps structural presentation validation below render and glyph coverage in render", async () => {
  const { parsePresentationStructure } =
    await import("../../schema/src/internal/title-data/presentation.js");
  const input = JSON.stringify(p(field("customer", { value: "中" })));
  expect(parsePresentationStructure(input).diagnostics).toEqual([]);
  rejected(
    parseInternalPresentation(input),
    "R005",
    "/titleBlock/fields/customer/value",
  );
});

it("preserves source locations across the structural/font validation split", () => {
  const input = '{\n "format":"project-presentation/0.3",\n "revision":"中"\n}';
  expect(parseInternalPresentation(input).diagnostics).toContainEqual(
    expect.objectContaining({
      code: "R005",
      jsonPointer: "/revision",
      line: 3,
      column: 13,
    }),
  );
});
