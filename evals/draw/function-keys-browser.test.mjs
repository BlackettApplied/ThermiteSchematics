import { afterAll, beforeAll, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { launch, openSheet, drawingContextOptions } from "./browser.mjs";
import { functionKeys } from "./checks.mjs";
import { renderSchematicPacket } from "../../packages/render/src/sheets.js";
import {
  directFixture,
  directPacket,
  directView,
  flows,
  roleFree,
} from "../../packages/render/test/direct-loop-fixture.js";

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

it.each(flows)(
  "exempts authored notes, retaining identical generated-key findings in %s",
  async (flow) => {
    const f = await directFixture(roleFree);
    try {
      const note = "polarity not verified: AI1.input, TX1.signal.";
      const notes = [note, "W".repeat(218) + " AI1.input TX1.signal"];
      const view = directView({ flow, notes });
      const request = directPacket(view, {
        views: [
          view,
          {
            format: "wiring-view-request/0.1",
            title: "Synthetic authored wiring notes",
            conductors: ["W10", "W11"],
            notes,
          },
          {
            format: "circuit-view-request/0.1",
            title: "Synthetic authored notes",
            flow,
            notes,
            groups: [
              {
                id: "input",
                conductors: [],
                functions: [
                  {
                    device: { by: "designation", value: "AI1" },
                    key: "input",
                  },
                ],
              },
            ],
          },
        ],
        index: false,
      });
      const result = await renderSchematicPacket(f.ir, request);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      let wrapped = false;
      const autoPages = new Set(
        result.value.navigation.autoDocuments.flatMap((d) => d.sheets),
      );
      for (const sheet of result.value.sheets.filter(
        (s) => !autoPages.has(s.number),
      )) {
        const geometry = await openSheet(page, sheet.svg);
        const authored = geometry.texts.filter(
          (t) => t.authoredText === "request-note",
        );
        expect(authored.length).toBeGreaterThanOrEqual(notes.length);
        wrapped ||= authored.length > notes.length;
        expect(authored.map((t) => t.text).join(" ")).toContain(note);
        expect(
          functionKeys(geometry, f.ir, {
            sheet,
            request,
          }),
        ).toEqual([]);
      }
      for (const sheet of result.value.sheets.filter((s) =>
        autoPages.has(s.number),
      )) {
        const geometry = await openSheet(page, sheet.svg);
        expect(
          geometry.texts.filter((t) => t.authoredText === "request-note"),
        ).toEqual([]);
        expect(functionKeys(geometry, f.ir, { sheet, request })).toEqual([]);
      }
      expect(wrapped).toBe(true);
      const { document } = parseHTML(result.value.sheets[0].svg);
      const generated = [
        ...document.querySelectorAll("[data-engine-notes] text"),
      ].find(
        (t) =>
          t.textContent.startsWith("polarity not verified") &&
          !t.hasAttribute("data-authored-text"),
      );
      expect(generated).toBeDefined();
      generated.textContent = note; // Synthetic regression, identical to the authored note.
      const geometry = await openSheet(page, document.toString());
      expect(
        functionKeys(geometry, f.ir, {
          sheet: result.value.sheets[0],
          request: { views: [view] },
        }).map((f) => f.key),
      ).toEqual(["AI1.input", "TX1.signal"]);
    } finally {
      await f.dispose();
    }
  },
);

it("does not inherit an authored-note exemption from a containing group", async () => {
  const g = await openSheet(
    page,
    `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><g data-authored-text="request-note"><text x="5" y="10" font-size="2.5">AI1.input</text></g></svg>`,
  );
  expect(g.texts[0].authoredText).toBeNull();
  expect(
    functionKeys(g, {
      devices: [{ uid: "ai", designation: "AI1" }],
      functions: [{ id: { deviceUid: "ai", functionKey: "input" } }],
      terminals: [],
    }),
  ).toHaveLength(1);
});

it("rejects nested keys split across font spans and forged request-note markers", async () => {
  const data = {
    devices: [{ uid: "k", designation: "K1" }],
    functions: [{ id: { deviceUid: "k", functionKey: "nested_key_923" } }],
    terminals: [],
  };
  const geometry = await openSheet(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><g data-authored-text="request-note"><text x="5" y="10" font-size="2.5" data-authored-text="request-note">Generated <tspan>K1.nested_</tspan><tspan font-weight="700">key_923</tspan></text></g></svg>',
  );
  expect(
    functionKeys(geometry, data, {
      sheet: { view: { title: "Synthetic", kind: "signal-loop" } },
      request: {
        views: [
          {
            title: "Synthetic",
            format: "signal-loop-view-request/0.1",
            notes: ["Unrelated authored note"],
          },
        ],
      },
    }),
  ).toMatchObject([{ key: "K1.nested_key_923" }]);
});
