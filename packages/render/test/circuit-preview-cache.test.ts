import { afterEach, expect, it, vi } from "vitest";
import type { ElectricalIr } from "@thermite/compiler";
import type { Draft } from "../src/packet/types.js";
import * as legend from "../src/packet/device-legend.js";
import { circuitPreviewSheets } from "../src/layout/circuit-preview-cache.js";
import {
  circuitInlineContext,
  circuitLayoutContext,
} from "../src/layout/circuit-inline-context.js";
import { documentPaper } from "./document-fixture.js";
import { offViewFixture } from "./off-view-fixtures.js";
import { renderSchematicPacket } from "../src/sheets.js";
import { failure } from "../src/packet/errors.js";
import { useCompactFrame } from "../src/packet/frame-profile.js";
import { configureTitleFrame } from "../src/internal/title-data/frame-context.js";

afterEach(() => vi.restoreAllMocks());

const inputs = () =>
  [
    {} as ElectricalIr,
    [{ content: "native" }] as Draft[],
    documentPaper(),
  ] as const;
const result = () =>
  ({
    ok: true,
    value: [{ svg: "original" }],
    navigation: { annotations: [{ text: "original" }] },
  }) as unknown as ReturnType<typeof legend.legendSheets>;

it("remeasures the identity-only compact frame selection", () => {
  const [ir, drafts, page] = inputs();
  const work = vi.spyOn(legend, "legendSheets").mockImplementation(result);
  circuitInlineContext.run(circuitLayoutContext(), () => {
    circuitPreviewSheets(ir, drafts, page);
    const compact = { ...page };
    useCompactFrame(compact);
    circuitPreviewSheets(ir, drafts, compact);
    expect(work).toHaveBeenCalledTimes(2);
  });
});

it("remeasures page-owned title metadata with equal serialized paper", () => {
  const [ir, drafts, page] = inputs();
  const work = vi.spyOn(legend, "legendSheets").mockImplementation(result);
  circuitInlineContext.run(circuitLayoutContext(), () => {
    for (const text of ["FIRST", "SECOND"]) {
      const selected = { ...page };
      configureTitleFrame(selected, {
        presentation: {
          format: "project-presentation/0.3",
          frame: { header: { text } },
        },
        request: { format: "schematic-packet-request/0.2", views: [] },
      });
      circuitPreviewSheets(ir, drafts, selected);
    }
    expect(work).toHaveBeenCalledTimes(2);
  });
});

it("reuses identical previews and protects saved and returned measurements", () => {
  const args = inputs(),
    work = vi.spyOn(legend, "legendSheets").mockImplementation(result);
  circuitInlineContext.run(circuitLayoutContext(), () => {
    const first = circuitPreviewSheets(...args);
    if (!first.ok) throw Error("preview");
    first.value[0]!.svg = "changed assembly";
    first.navigation!.annotations[0]!.text = "changed caption";
    const second = circuitPreviewSheets(...args);
    expect(second).toEqual(result());
    if (!second.ok) throw Error("preview");
    second.navigation!.annotations[0]!.text = "changed later caller";
    expect(circuitPreviewSheets(...args)).toEqual(result());
    expect(work).toHaveBeenCalledTimes(1);
  });
});

it.each(["ir", "drafts", "page"])("remeasures changed %s", (field) => {
  const [ir, drafts, page] = inputs(),
    work = vi.spyOn(legend, "legendSheets").mockImplementation(result);
  circuitInlineContext.run(circuitLayoutContext(), () => {
    circuitPreviewSheets(ir, drafts, page);
    if (field === "drafts") drafts[0]!.content = "changed native geometry";
    circuitPreviewSheets(
      field === "ir" ? ({} as ElectricalIr) : ir,
      drafts,
      field === "page" ? { ...page, widthMm: page.widthMm + 1 } : page,
    );
    expect(work).toHaveBeenCalledTimes(2);
  });
});

it.each(["undefined", "aliases", "property order"])(
  "keeps exact %s distinctions in preview inputs",
  (change) => {
    const [ir, drafts, page] = inputs(),
      work = vi.spyOn(legend, "legendSheets").mockImplementation(result);
    const item = { text: "native" };
    const before =
      change === "undefined"
        ? { content: "native", referenceNotes: undefined }
        : change === "aliases"
          ? { content: "native", references: [item, item] }
          : { content: "native", note: "native" };
    const after =
      change === "undefined"
        ? { content: "native" }
        : change === "aliases"
          ? { content: "native", references: [item, { ...item }] }
          : { note: "native", content: "native" };
    circuitInlineContext.run(circuitLayoutContext(), () => {
      circuitPreviewSheets(ir, [before] as Draft[], page);
      circuitPreviewSheets(ir, [after] as Draft[], page);
      expect(work).toHaveBeenCalledTimes(2);
      expect(drafts[0]!.content).toBe("native");
    });
  },
);

it.each(["notice", "packet documents", "standalone documents"])(
  "always re-finalizes %s through the original export",
  (mode) => {
    const [ir, drafts, page] = inputs(),
      work = vi.spyOn(legend, "legendSheets").mockImplementation(result);
    circuitInlineContext.run(circuitLayoutContext(), () => {
      circuitPreviewSheets(ir, drafts, page);
      for (let i = 0; i < 2; i++)
        circuitPreviewSheets(
          ir,
          drafts,
          page,
          mode === "notice",
          mode === "notice"
            ? undefined
            : {
                presentation: undefined,
                standalone: mode.startsWith("standalone"),
              },
        );
      expect(work).toHaveBeenCalledTimes(3);
    });
  },
);

it("isolates searches and leaves unscoped work unchanged", () => {
  const args = inputs(),
    work = vi.spyOn(legend, "legendSheets").mockImplementation(result);
  for (const c of [circuitLayoutContext(), circuitLayoutContext()])
    circuitInlineContext.run(c, () => {
      circuitPreviewSheets(...args);
      circuitPreviewSheets(...args);
    });
  expect(work).toHaveBeenCalledTimes(2);
  circuitPreviewSheets(...args);
  circuitPreviewSheets(...args);
  expect(work).toHaveBeenCalledTimes(4);
});

it("does not retain failed previews and preserves programming errors", () => {
  const args = inputs(),
    work = vi
      .spyOn(legend, "legendSheets")
      .mockReturnValue(failure("unprintable-layout", "synthetic fit failure"));
  circuitInlineContext.run(circuitLayoutContext(), () => {
    circuitPreviewSheets(...args);
    circuitPreviewSheets(...args);
    expect(work).toHaveBeenCalledTimes(2);
    work.mockImplementation(() => {
      throw Error("synthetic preview bug");
    });
    expect(() => circuitPreviewSheets(...args)).toThrow(
      "synthetic preview bug",
    );
  });
});

it.each(["prototype", "map", "accessor"])(
  "leaves unsupported %s inputs to the original export without reading accessors",
  (kind) => {
    const [ir, , page] = inputs(),
      work = vi.spyOn(legend, "legendSheets").mockImplementation(result),
      getter = vi.fn(() => "native");
    const d =
      kind === "prototype"
        ? Object.assign(Object.create({ inherited: "native" }), {
            content: "native",
          })
        : kind === "map"
          ? { content: "native", references: new Map() }
          : Object.defineProperty({}, "content", {
              get: getter,
              enumerable: true,
            });
    circuitInlineContext.run(circuitLayoutContext(), () => {
      circuitPreviewSheets(ir, [d], page);
      circuitPreviewSheets(ir, [d], page);
      expect(work).toHaveBeenCalledTimes(2);
      expect(getter).not.toHaveBeenCalled();
    });
  },
);

it("reuses fitting/index preview work while running final document finalization", async () => {
  const source = await offViewFixture();
  try {
    const request = {
      format: "schematic-packet-request/0.1" as const,
      index: true,
      views: [
        {
          format: "documentation-view-request/0.1" as const,
          kind: "wires" as const,
        },
      ],
    };
    const work = vi.spyOn(legend, "legendSheets");
    const original = await renderSchematicPacket(source.ir, request);
    expect(original.ok).toBe(true);
    expect(work).toHaveBeenCalledTimes(3);
    work.mockClear();
    const reused = await circuitInlineContext.run(circuitLayoutContext(), () =>
      renderSchematicPacket(source.ir, request),
    );
    expect(JSON.stringify(reused)).toBe(JSON.stringify(original));
    expect(work).toHaveBeenCalledTimes(2);
    expect(
      work.mock.calls.filter(([, , , notice, docs]) => notice && docs),
    ).toHaveLength(1);
  } finally {
    await source.dispose();
  }
});
