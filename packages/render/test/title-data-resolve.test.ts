import { describe, expect, it } from "vitest";
import {
  parseInternalPacket,
  parseInternalPresentation,
} from "../src/internal/title-data/parse.js";
import { resolveTitles } from "../src/internal/title-data/resolve.js";
import { parsePattern } from "../src/internal/title-data/pattern.js";
import { sheetKey } from "../src/internal/title-data/sheet-key.js";
import type {
  FinalSheet,
  PacketRequest,
  Presentation,
  ResolvedTitle,
  Result,
  Slot,
} from "../src/internal/title-data/model.js";
function required<T>(result: Result<T>): T {
  expect(result.diagnostics).toEqual([]);
  expect(result.value).toBeDefined();
  return result.value as T;
}
const presentation = (extra: object = {}) =>
  required(
    parseInternalPresentation(
      JSON.stringify({ format: "project-presentation/0.3", ...extra }),
    ),
  );
const packet = (titleData?: object, count = 1) =>
  required(
    parseInternalPacket(
      JSON.stringify({
        format: "schematic-packet-request/0.2",
        views: Array(count).fill({
          format: "documentation-view-request/0.1",
          kind: "bom",
        }),
        ...(titleData ? { titleData } : {}),
      }),
    ),
  );
const drawing: FinalSheet = {
  identity: { kind: "view", viewKey: "native-view-a" },
  partIndex: 1,
  partTotal: 1,
  viewIndex: 1,
  title: "Normalized circuit label",
};
const lookup = (title: ResolvedTitle, slot: Slot) =>
  title.fields.find((f) => f.slot === slot)!;
function resolve(
  p: Presentation = presentation(),
  q: PacketRequest = packet(),
  sheets: readonly FinalSheet[] = [drawing],
) {
  return required(resolveTitles(p, q, "Synthetic source project", sheets));
}

describe("TB1 source knownness and precedence", () => {
  it("keeps every unknown business field unknown without manufacturing history", () => {
    const [result] = resolve();
    expect(result).toBeDefined();
    for (const key of [
      "drawingNumber",
      "customer",
      "drawnBy",
      "date",
      "checkedBy",
      "approvedBy",
    ] as const) {
      expect(lookup(result!, key)).toMatchObject({
        text: "",
        fact: { known: false, value: null, source: null, pointer: null },
      });
    }
    expect(lookup(result!, "revision")).toMatchObject({
      text: "UNSPECIFIED",
      fact: { known: false, value: null, source: null },
    });
    expect(result!.revisionRows).toEqual({
      value: null,
      known: false,
      source: null,
      pointer: null,
    });
    expect(lookup(result!, "project")).toMatchObject({
      text: "Synthetic source project",
      fact: { known: true, source: "project", pointer: "/name" },
    });
    expect(lookup(result!, "sheetTitle")).toMatchObject({
      text: "Normalized circuit label",
      fact: { known: true, source: "title" },
    });
    expect(lookup(result!, "sheetNumber")).toMatchObject({
      text: "1 of 1",
      fact: { known: true, source: "page" },
    });
  });
  it("overrides one named field, emits in slot order and retains supplied literals", () => {
    const p = presentation({
      revision: "CURRENT",
      titleBlock: {
        fields: {
          drawnBy: {
            slot: "drawnBy",
            label: "Author",
            value: "Supplied author",
          },
          customer: {
            slot: "customer",
            label: "Client",
            value: "Supplied client",
          },
        },
      },
    });
    const [result] = resolve(p);
    expect(result!.fields.map((f) => f.slot)).toEqual([
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
    ]);
    expect(lookup(result!, "customer")).toMatchObject({
      text: "Supplied client",
      fact: { known: true, source: "presentation" },
    });
    expect(lookup(result!, "drawnBy").label).toBe("Author");
    expect(lookup(result!, "revision")).toMatchObject({
      text: "CURRENT",
      fact: { known: true, source: "presentation" },
    });
  });
  it("applies presentation, defaults, authored view and exact sheet in order", () => {
    const p = presentation({
      revision: "P",
      titleBlock: {
        fields: {
          customer: { slot: "customer", label: "Customer", value: "P" },
        },
      },
    });
    const td = {
      defaults: {
        values: { customer: "D", checkedBy: "DC" },
        revision: "D",
        sheetTitle: "Default title",
      },
      byView: [
        {
          viewIndex: 1,
          values: { customer: "V" },
          revision: "V",
          sheetTitle: "View title",
        },
      ],
      bySheet: [
        {
          sheetKey: sheetKey(drawing),
          values: { customer: "S" },
          revision: "S",
          sheetTitle: "Exact title",
        },
      ],
    };
    const expectations = [
      [{}, "P", "presentation"],
      [{ defaults: td.defaults }, "D", "request-defaults"],
      [{ defaults: td.defaults, byView: td.byView }, "V", "request-view"],
      [td, "S", "request-sheet"],
    ] as const;
    for (const [data, text, source] of expectations) {
      const [result] = resolve(p, packet(data));
      expect(lookup(result!, "customer")).toMatchObject({
        text,
        fact: { known: true, source },
      });
      expect(lookup(result!, "revision").text).toBe(text);
    }
    const [result] = resolve(p, packet(td));
    expect(lookup(result!, "sheetTitle").text).toBe("Exact title");
    expect(lookup(result!, "checkedBy")).toMatchObject({
      text: "DC",
      fact: { source: "request-defaults" },
    });
    expect(lookup(result!, "customer").fact.pointer).toBe(
      "/titleData/bySheet/0/values/customer",
    );
  });
  it.each(["defaults", "view", "sheet"])(
    "null clears inherited facts at %s",
    (level) => {
      const p = presentation({
        revision: "P",
        titleBlock: {
          fields: {
            drawnBy: { slot: "drawnBy", label: "Drawn by", value: "P" },
          },
        },
      });
      const clear = {
        values: { drawnBy: null },
        revision: null,
        sheetTitle: null,
      };
      const td =
        level === "defaults"
          ? { defaults: clear }
          : level === "view"
            ? {
                defaults: { values: { drawnBy: "D" } },
                byView: [{ viewIndex: 1, ...clear }],
              }
            : {
                byView: [{ viewIndex: 1, values: { drawnBy: "V" } }],
                bySheet: [{ sheetKey: sheetKey(drawing), ...clear }],
              };
      const [result] = resolve(p, packet(td));
      for (const slot of ["drawnBy", "sheetTitle"] as const)
        expect(lookup(result!, slot)).toMatchObject({
          text: "",
          fact: { value: null, known: false },
        });
      expect(lookup(result!, "revision")).toMatchObject({
        text: "UNSPECIFIED",
        fact: { value: null, known: false },
      });
    },
  );
  it("replaces revision arrays, preserves empty arrays and never derives current revision from history", () => {
    const td = {
      defaults: { revision: "CURRENT", revisionRows: [{ version: "D" }] },
      byView: [
        {
          viewIndex: 1,
          revisionRows: [
            { version: "HISTORICAL", comment: "Supplied comment" },
          ],
        },
      ],
      bySheet: [
        { sheetKey: sheetKey(drawing), revisionRows: [{ version: "S" }] },
      ],
    };
    const [viewResult] = resolve(
      presentation(),
      packet({ ...td, bySheet: [] }),
    );
    expect(viewResult!.revisionRows).toMatchObject({
      known: true,
      source: "request-view",
      value: [{ version: "HISTORICAL", comment: "Supplied comment" }],
    });
    const [exact] = resolve(presentation(), packet(td));
    expect(exact!.revisionRows.value).toEqual([{ version: "S" }]);
    expect(lookup(exact!, "revision").text).toBe("CURRENT");
    const [empty] = resolve(
      presentation(),
      packet({
        ...td,
        bySheet: [
          { sheetKey: sheetKey(drawing), revision: null, revisionRows: [] },
        ],
      }),
    );
    expect(empty!.revisionRows).toMatchObject({
      known: false,
      value: [],
      source: "request-sheet",
    });
    expect(lookup(empty!, "revision")).toMatchObject({
      text: "UNSPECIFIED",
      fact: { known: false },
    });
    const [historyOnly] = resolve(
      presentation(),
      packet({
        defaults: { revisionRows: [{ version: "V", date: "2000-02-29" }] },
      }),
    );
    expect(lookup(historyOnly!, "revision").fact.known).toBe(false);
    expect(lookup(historyOnly!, "date").fact.known).toBe(false);
    expect(lookup(historyOnly!, "drawnBy").fact.known).toBe(false);
  });
  it("keeps an explicitly supplied UNSPECIFIED revision unknown", () => {
    for (const [p, q] of [
      [presentation({ revision: "UNSPECIFIED" }), packet()],
      [presentation(), packet({ defaults: { revision: "UNSPECIFIED" } })],
    ] as const) {
      expect(lookup(resolve(p, q)[0]!, "revision")).toMatchObject({
        text: "UNSPECIFIED",
        fact: { known: false, value: "UNSPECIFIED" },
      });
    }
  });
  it("gives reports, companions, index and references their own title and identity", () => {
    const sheets: FinalSheet[] = [
      drawing,
      {
        identity: { kind: "document", documentId: "report" },
        partIndex: 1,
        partTotal: 1,
        viewIndex: 2,
        title: "Report label",
      },
      {
        identity: { kind: "companion", documentId: "native-companion" },
        partIndex: 1,
        partTotal: 1,
        viewIndex: 1,
        title: "Companion label",
      },
      {
        identity: { kind: "index" },
        partIndex: 1,
        partTotal: 1,
        title: "Index",
      },
      {
        identity: { kind: "references" },
        partIndex: 1,
        partTotal: 1,
        title: "References",
      },
    ];
    const result = resolve(presentation(), packet(undefined, 2), sheets);
    expect(result.map((r) => lookup(r, "sheetTitle").text)).toEqual(
      sheets.map((s) => s.title),
    );
    expect(new Set(result.map((r) => r.sheetKey)).size).toBe(5);
    expect(result.map((r) => lookup(r, "sheetNumber").text)).toEqual([
      "1 of 5",
      "2 of 5",
      "3 of 5",
      "4 of 5",
      "5 of 5",
    ]);
    const short = resolve(
      presentation(),
      packet({ byView: [{ viewIndex: 2, sheetTitle: "Short report" }] }, 2),
      sheets,
    );
    expect(lookup(short[1]!, "sheetTitle").text).toBe("Short report");
    expect(lookup(short[2]!, "sheetTitle").text).toBe("Companion label");
  });
});

describe("TB1 closed DWG pattern grammar", () => {
  const p = (pattern: string) =>
    presentation({
      titleBlock: {
        fields: {
          drawingNumber: { slot: "drawingNumber", label: "DWG NO", pattern },
        },
      },
    });
  it.each([
    ["{drawingBase}-{sheetNumber:02}-of-{sheetTotal:03}", "D-01-of-001"],
    ["{{{drawingBase}}}-{{page}}-{sheetNumber}", "{D}-{page}-1"],
    ["{sheetTotal:02}/{sheetNumber:03}", "01/001"],
    ["literal", "literal"],
    ["{{}}", "{}"],
  ])("expands %s", (pattern, expected) =>
    expect(
      lookup(
        resolve(p(pattern), packet({ defaults: { drawingBase: "D" } }))[0]!,
        "drawingNumber",
      ).text,
    ).toBe(expected),
  );
  it.each([
    "{env.USER}",
    "{date}",
    "{drawingBase:02}",
    "{sheetNumber:04}",
    "{sheetNumber:2}",
    "{sheetTotal:01}",
    "{sheetNumber+1}",
    "{sheetNumber.toString()}",
    "{}",
    "{",
    "}",
    "{{}",
    "{sheetNumber",
    "{ sheetNumber}",
  ])("rejects pattern %s", (pattern) => {
    expect(parsePattern(pattern)).toBeUndefined();
    expect(
      parseInternalPresentation(
        JSON.stringify({
          format: "project-presentation/0.3",
          titleBlock: {
            fields: {
              drawingNumber: {
                slot: "drawingNumber",
                label: "DWG NO",
                pattern,
              },
            },
          },
        }),
      ).diagnostics,
    ).toContainEqual(
      expect.objectContaining({
        code: "E013",
        jsonPointer: "/titleBlock/fields/drawingNumber/pattern",
      }),
    );
  });
  it("makes a missing or cleared base wholly unknown and allows explicit literal/request numbers", () => {
    const unknown = resolve(p("{drawingBase}-{sheetNumber:02}"))[0]!;
    expect(lookup(unknown, "drawingNumber")).toMatchObject({
      text: "",
      fact: { known: false, value: null },
    });
    expect(
      lookup(
        resolve(
          p("{drawingBase}-{sheetNumber:02}"),
          packet({ defaults: { drawingBase: null } }),
        )[0]!,
        "drawingNumber",
      ).text,
    ).toBe("");
    expect(
      lookup(
        resolve(
          p("{drawingBase}-{sheetNumber:02}"),
          packet({ defaults: { values: { drawingNumber: "Shared drawing" } } }),
        )[0]!,
        "drawingNumber",
      ).text,
    ).toBe("Shared drawing");
  });
  it("enforces expansion bound at 160/+1 without truncating", () => {
    const pattern = "{drawingBase}" + "x".repeat(32);
    expect(
      lookup(
        resolve(
          p(pattern),
          packet({ defaults: { drawingBase: "D".repeat(128) } }),
        )[0]!,
        "drawingNumber",
      ).text.length,
    ).toBe(160);
    const result = resolveTitles(
      p(pattern + "x"),
      packet({ defaults: { drawingBase: "D".repeat(128) } }),
      "Project",
      [drawing],
    );
    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "E013",
        jsonPointer: "/titleBlock/fields/drawingNumber/pattern",
      }),
    );
  });
});

describe("TB1 final-sheet keys and reconciliation", () => {
  it("keys native identity, part index AND total, independent of global numbering and titles", () => {
    const part = { ...drawing, partIndex: 2, partTotal: 3 };
    const key = sheetKey(part);
    expect(key).toMatch(/^sheet\/1\/[0-9a-f]{64}$/);
    expect(sheetKey({ ...part, title: "Renamed", viewIndex: 2 })).toBe(key);
    expect(sheetKey({ ...part, partIndex: 1 })).not.toBe(key);
    expect(sheetKey({ ...part, partTotal: 4 })).not.toBe(key);
    expect(
      sheetKey({ ...part, identity: { kind: "view", viewKey: "another" } }),
    ).not.toBe(key);
    expect(
      sheetKey({
        ...part,
        identity: { kind: "document", documentId: "native-view-a" },
      }),
    ).not.toBe(key);
    expect(
      sheetKey({
        ...part,
        identity: { kind: "companion", documentId: "native-view-a" },
      }),
    ).not.toBe(key);
    const identity = { viewKey: "native-view-a", kind: "view" as const };
    expect(sheetKey({ ...part, identity })).toBe(key);
  });
  it("refuses every stale part-total key while part 2 still exists", () => {
    const parts = (total: number) =>
      Array.from({ length: total }, (_, i) => ({
        ...drawing,
        partIndex: i + 1,
        partTotal: total,
      }));
    const before = parts(3),
      after = parts(4);
    for (const stale of before) {
      const request = packet({
        bySheet: [{ sheetKey: sheetKey(stale), revision: "Supplied" }],
      });
      expect(
        resolveTitles(presentation(), request, "Project", before).diagnostics,
      ).toEqual([]);
      const result = resolveTitles(presentation(), request, "Project", after);
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "R006",
          reason: "invalid-packet",
          details: { reason: "unresolved-sheet-key" },
          jsonPointer: "/titleData/bySheet/0/sheetKey",
        }),
      );
    }
  });
  it("targets identity after reordering, without touching adjacent pages", () => {
    const index: FinalSheet = {
      identity: { kind: "index" },
      partIndex: 1,
      partTotal: 1,
      title: "Index",
    };
    const q = packet({
      bySheet: [{ sheetKey: sheetKey(drawing), revision: "Exact" }],
    });
    const titles = resolve(presentation({ revision: "Default" }), q, [
      index,
      drawing,
    ]);
    expect(lookup(titles[0]!, "revision").text).toBe("Default");
    expect(lookup(titles[1]!, "revision").text).toBe("Exact");
  });
  it("refuses unused view selectors and duplicate final identities", () => {
    const result = resolveTitles(
      presentation(),
      packet({ byView: [{ viewIndex: 1, revision: "V" }] }),
      "Project",
      [
        {
          identity: { kind: "index" },
          partIndex: 1,
          partTotal: 1,
          title: "Index",
        },
      ],
    );
    expect(result.value).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({
      code: "R006",
      details: { reason: "unresolved-sheet-key" },
    });
    expect(
      resolveTitles(presentation(), packet(), "Project", [drawing, drawing])
        .diagnostics[0],
    ).toMatchObject({
      code: "R006",
      details: { reason: "unresolved-sheet-key" },
    });
  });
  it("keeps the 100-final-sheet cap and refuses invalid parts", () => {
    const sheets = Array.from({ length: 100 }, (_, i) => ({
      ...drawing,
      partIndex: i + 1,
      partTotal: 100,
    }));
    expect(resolve(presentation(), packet(), sheets)).toHaveLength(100);
    expect(
      resolveTitles(presentation(), packet(), "Project", [
        ...sheets,
        { ...drawing, identity: { kind: "index" } },
      ]).diagnostics[0],
    ).toMatchObject({ code: "R006", reason: "invalid-packet" });
    for (const part of [
      { partIndex: 0, partTotal: 1 },
      { partIndex: 2, partTotal: 1 },
      { partIndex: 1.5, partTotal: 3 },
      { partIndex: 1, partTotal: 101 },
    ])
      expect(
        resolveTitles(presentation(), packet(), "Project", [
          { ...drawing, ...part },
        ]).diagnostics[0],
      ).toMatchObject({ code: "R006" });
  });
});

describe("TB1 default frame settings", () => {
  it("keeps declarative controls and resolves only engine-owned defaults", async () => {
    const { presentationSettings } =
      await import("../src/internal/title-data/defaults.js");
    expect(presentationSettings(presentation())).toEqual({
      backgroundColor: "#ffffff",
      page: { size: "tabloid", orientation: "landscape", marginMm: 10 },
      profile: "compact",
      lines: [],
      zones: { default: { columns: 6, rows: 4 } },
      header: { text: "THERMITE / ELECTRICAL" },
      generatorStamp: "border",
    });
    expect(
      presentationSettings(
        presentation({
          backgroundColor: "#abcdef",
          page: { size: "a4", orientation: "portrait", marginMm: 25 },
          frame: {
            header: { text: "Custom header" },
            generatorStamp: "title",
            zones: { byPaper: { a4: { portrait: { columns: 6, rows: 4 } } } },
          },
          titleBlock: { lines: ["Authored note"] },
        }),
      ),
    ).toEqual({
      backgroundColor: "#abcdef",
      page: { size: "a4", orientation: "portrait", marginMm: 25 },
      profile: "compact",
      lines: ["Authored note"],
      zones: { byPaper: { a4: { portrait: { columns: 6, rows: 4 } } } },
      header: { text: "Custom header" },
      generatorStamp: "title",
    });
  });
  it("records DWG pattern inputs in the knownness ledger", () => {
    const p = presentation({
      titleBlock: {
        fields: {
          drawingNumber: {
            slot: "drawingNumber",
            label: "DWG NO",
            pattern: "{drawingBase}-{sheetNumber}",
          },
        },
      },
    });
    const f = lookup(
      resolve(p, packet({ defaults: { drawingBase: "USER-BASE" } }))[0]!,
      "drawingNumber",
    );
    expect(f.fact.inputs).toEqual([
      {
        value: "USER-BASE",
        known: true,
        source: "request-defaults",
        pointer: "/titleData/defaults/drawingBase",
      },
      { value: "1", known: true, source: "page", pointer: "/sheetNumber" },
      { value: "1", known: true, source: "page", pointer: "/sheetTotal" },
    ]);
  });
});

it("keeps each missing history cell unknown without turning it into a supplied value", () => {
  const [result] = resolve(
    presentation(),
    packet({ defaults: { revisionRows: [{ version: "V" }] } }),
  );
  expect(result!.history).toEqual([
    {
      version: {
        value: "V",
        known: true,
        source: "request-defaults",
        pointer: "/titleData/defaults/revisionRows/0/version",
      },
      comment: { value: null, known: false, source: null, pointer: null },
      date: { value: null, known: false, source: null, pointer: null },
      drawnBy: { value: null, known: false, source: null, pointer: null },
    },
  ]);
});
it("requires a known drawing base for every opt-in pattern", () => {
  const p = presentation({
    titleBlock: {
      fields: {
        drawingNumber: {
          slot: "drawingNumber",
          label: "DWG NO",
          pattern: "{sheetNumber}",
        },
      },
    },
  });
  expect(lookup(resolve(p)[0]!, "drawingNumber")).toMatchObject({
    text: "",
    fact: { known: false },
  });
});

it("does not inherit a circuit short title on automatic companion documents", () => {
  const companion: FinalSheet = {
    identity: { kind: "companion", documentId: "own-native-document" },
    partIndex: 1,
    partTotal: 1,
    viewIndex: 1,
    title: "Native companion title",
  };
  const result = resolve(
    presentation(),
    packet({ byView: [{ viewIndex: 1, sheetTitle: "Circuit short title" }] }),
    [drawing, companion],
  );
  expect(lookup(result[0]!, "sheetTitle").text).toBe("Circuit short title");
  expect(lookup(result[1]!, "sheetTitle").text).toBe("Native companion title");
});

it("separates a document and companion with the same native documentId", () => {
  const doc: FinalSheet = {
    identity: { kind: "document", documentId: "shared-id" },
    partIndex: 1,
    partTotal: 1,
    viewIndex: 1,
    title: "Report",
  };
  const comp: FinalSheet = {
    ...doc,
    identity: { kind: "companion", documentId: "shared-id" },
    title: "Companion",
  };
  expect(sheetKey(doc)).not.toBe(sheetKey(comp));
  const result = resolve(
    presentation(),
    packet({
      bySheet: [
        { sheetKey: sheetKey(doc), revision: "REPORT" },
        { sheetKey: sheetKey(comp), revision: "COMPANION" },
      ],
    }),
    [doc, comp],
  );
  expect(result.map((t) => lookup(t, "revision").text)).toEqual([
    "REPORT",
    "COMPANION",
  ]);
});
it("rejects inconsistent totals for one native identity", () => {
  const sheets = [
    { ...drawing, partIndex: 1, partTotal: 2 },
    { ...drawing, partIndex: 2, partTotal: 3 },
  ];
  const result = resolveTitles(presentation(), packet(), "Project", sheets);
  expect(result.value).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "R006",
      reason: "invalid-packet",
      details: { reason: "unresolved-sheet-key" },
    }),
  );
});
it("inherits a sole owner's metadata on companions, keeping their own title", () => {
  const comp: FinalSheet = {
    identity: { kind: "companion", documentId: "one-owner" },
    partIndex: 1,
    partTotal: 1,
    ownerViewIndexes: [1],
    title: "Native companion",
  };
  const data = {
    defaults: {
      values: { customer: "DEFAULT", drawnBy: "Default author" },
      revision: "D",
      revisionRows: [{ version: "D" }],
    },
    byView: [
      {
        viewIndex: 1,
        sheetTitle: "Circuit short",
        values: { customer: "VIEW", drawnBy: null },
        revision: null,
        revisionRows: [{ version: "V" }],
      },
    ],
  };
  const result = resolve(presentation(), packet(data), [drawing, comp]);
  expect(lookup(result[1]!, "customer")).toMatchObject({
    text: "VIEW",
    fact: { source: "request-view" },
  });
  expect(lookup(result[1]!, "drawnBy")).toMatchObject({
    text: "",
    fact: { known: false, source: "request-view" },
  });
  expect(lookup(result[1]!, "revision")).toMatchObject({
    text: "UNSPECIFIED",
    fact: { known: false, source: "request-view" },
  });
  expect(result[1]!.revisionRows.value).toEqual([{ version: "V" }]);
  expect(lookup(result[1]!, "sheetTitle").text).toBe("Native companion");
});
it("uses defaults for shared companions and applies exact sheet metadata to their own key", () => {
  const comp: FinalSheet = {
    identity: { kind: "companion", documentId: "many-owners" },
    partIndex: 1,
    partTotal: 1,
    ownerViewIndexes: [1, 2],
    title: "Shared native title",
  };
  const second: FinalSheet = {
    ...drawing,
    identity: { kind: "view", viewKey: "view-two" },
    viewIndex: 2,
    title: "Second",
  };
  const data = {
    defaults: {
      values: { customer: "DEFAULT" },
      revision: "D",
      revisionRows: [{ version: "D" }],
    },
    byView: [
      { viewIndex: 1, values: { customer: "ONE" }, revision: "ONE" },
      { viewIndex: 2, values: { customer: "TWO" }, revision: "TWO" },
    ],
  };
  const sheets = [drawing, second, comp];
  const base = resolve(presentation(), packet(data, 2), sheets)[2]!;
  expect(lookup(base, "customer").text).toBe("DEFAULT");
  expect(lookup(base, "revision").text).toBe("D");
  expect(base.revisionRows.value).toEqual([{ version: "D" }]);
  expect(lookup(base, "sheetTitle").text).toBe("Shared native title");
  const exact = resolve(
    presentation(),
    packet(
      {
        ...data,
        bySheet: [
          {
            sheetKey: sheetKey(comp),
            values: { customer: "EXACT" },
            revision: "S",
            sheetTitle: "Exact companion",
          },
        ],
      },
      2,
    ),
    sheets,
  )[2]!;
  expect(lookup(exact, "customer").text).toBe("EXACT");
  expect(lookup(exact, "revision").text).toBe("S");
  expect(lookup(exact, "sheetTitle").text).toBe("Exact companion");
});
it.each(["project", "sheetTitle"] as const)(
  "reports derived %s overflow as R006 capacity on the correct sheet",
  (field) => {
    const long = "T".repeat(161);
    const result = resolveTitles(
      presentation(),
      packet(),
      field === "project" ? long : "Project",
      [{ ...drawing, title: field === "sheetTitle" ? long : drawing.title }],
    );
    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "R006",
        reason: "unprintable-layout",
        details: expect.objectContaining({
          sheet: 1,
          field,
          requiredCodePoints: 161,
          availableCodePoints: 160,
        }),
      }),
    );
    expect(result.diagnostics.some((d) => d.code === "E013")).toBe(false);
    expect(result.diagnostics[0]?.jsonPointer).not.toContain("/titleBlock/");
    expect(result.diagnostics[0]?.message).toContain(`Sheet 1 field ${field}`);
    const bound = resolveTitles(
      presentation(),
      packet(),
      field === "project" ? "T".repeat(160) : "Project",
      [
        {
          ...drawing,
          title: field === "sheetTitle" ? "T".repeat(160) : drawing.title,
        },
      ],
    );
    expect(bound.diagnostics).toEqual([]);
  },
);

it.each([[1, 1], [99], [1.5], [0], []].map((owners) => ({ owners })))(
  "rejects invalid native companion owners $owners",
  ({ owners }) => {
    const companion: FinalSheet = {
      identity: { kind: "companion", documentId: "invalid-owner" },
      ownerViewIndexes: owners,
      partIndex: 1,
      partTotal: 1,
      title: "Companion",
    };
    const result = resolveTitles(
      presentation(),
      packet(undefined, 2),
      "Source",
      [drawing, companion],
    );
    expect(result.value).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "R006",
          details: expect.objectContaining({ reason: "unresolved-sheet-key" }),
        }),
      ]),
    );
  },
);
it("ignores scalar companion viewIndex rather than inheriting its metadata", () => {
  const companion: FinalSheet = {
    identity: { kind: "companion", documentId: "scalar-is-not-owner" },
    viewIndex: 1,
    partIndex: 1,
    partTotal: 1,
    title: "Companion",
  };
  const titles = resolve(
    presentation(),
    packet({
      defaults: { values: { drawnBy: "DEFAULT" } },
      byView: [{ viewIndex: 1, values: { drawnBy: "VIEW" } }],
    }),
    [drawing, companion],
  );
  const first = titles[0],
    companionTitle = titles[1];
  if (!first || !companionTitle)
    throw Error("Missing ownership fixture titles.");
  expect(lookup(first, "drawnBy").text).toBe("VIEW");
  expect(lookup(companionTitle, "drawnBy").text).toBe("DEFAULT");
});
