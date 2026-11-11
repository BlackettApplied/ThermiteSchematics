import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { prepareSignalLoopDrawing } from "../src/signal-loop.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  directFixture,
  directPacket,
  directView,
  flows,
  roleFree,
  withDirectFieldStage,
} from "./direct-loop-fixture.js";
import { wire } from "./series-loop-fixture.js";

const note = "polarity not verified: AI1.input, TX1.signal.";
const visible = (svg: string) =>
  [...parseHTML(svg).document.querySelectorAll("text")]
    .map((t) => t.textContent)
    .join(" ")
    .replace(/\s+/g, " ");

it.each(flows)(
  "leaves output-to-actuator and auxiliary pairs free of polarity notes in %s",
  async (flow) => {
    const f = await directFixture((m) => {
      withDirectFieldStage(m, false);
      roleFree(m);
      m.types[1].symbol = "thermite:io-module";
      m.types[1].functions.signal = {
        kind: "channel",
        direction: "output",
        terminals: ["p", "n"],
      };
      m.types[2].symbol = "thermite:analog-actuator";
      m.types[2].functions.input = { kind: "other", terminals: ["p", "n"] };
      m.types[2].terminals.u = { connection_policy: "shared" };
      m.types[2].terminals.v = { connection_policy: "shared" };
      m.types[2].functions.supply = { kind: "load", terminals: ["u", "v"] };
      m.types[3].functions.aux = { kind: "other", terminals: ["3", "4"] };
      m.objects.push(
        wire(14, "TB1", "3", "AI1", "u"),
        wire(15, "TB1", "4", "AI1", "v"),
      );
    });
    try {
      const view = directView({
        flow,
        auxiliary: [
          {
            from: { device: "TB1", function: "aux" },
            to: { device: "AI1", function: "supply" },
          },
        ],
      });
      const drawing = await prepareSignalLoopDrawing(f.ir, view);
      expect(drawing).not.toHaveProperty("engineNotes");
      expect(drawing.content).not.toContain("<desc>");
      expect(drawing.note).toContain("Separate command and auxiliary nets.");
      expect(drawing.note).not.toContain("polarity not verified");
      const result = await renderSchematicPacket(f.ir, directPacket(view));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const svg = result.value.sheets[0]!.svg;
      expect(svg).not.toContain("<desc>");
      expect(svg).not.toContain("data-engine-notes");
      expect(svg).not.toContain("polarity not verified");
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "keeps verified loops free of engine-note metadata in %s",
  async (flow) => {
    const f = await directFixture();
    try {
      const d = await prepareSignalLoopDrawing(f.ir, directView({ flow }));
      expect(d).not.toHaveProperty("engineNotes");
      expect(d.content).not.toContain("<desc>");
      const r = await renderSchematicPacket(
        f.ir,
        directPacket(directView({ flow }), { index: true, layout: "compact" }),
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      for (const sheet of r.value.sheets) {
        expect(sheet.svg).not.toContain("data-engine-notes");
        expect(sheet.svg).not.toContain("polarity not verified");
      }
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "propagates the exact note to visible sheet, desc and enabled references in %s",
  async (flow) => {
    const f = await directFixture(roleFree);
    try {
      const before = JSON.stringify(f.ir);
      // Six user notes remain available; the assessment is supplied by the engine.
      const notes = Array.from({ length: 6 }, (_, i) => `User note ${i + 1}`);
      const view = directView({ flow, notes });
      const d = await prepareSignalLoopDrawing(f.ir, view);
      expect(d.engineNotes).toEqual([note]);
      expect(d.note.split("\n")).toEqual([
        "Two separate signal nets. Dashed cores are explicitly spare; connector contact numbers are not a mating-face view.",
        note,
        ...notes,
      ]);
      for (const references of [
        false,
        { appearances: "all" as const },
        { appearances: "drawings" as const },
      ]) {
        const r = await renderSchematicPacket(
          f.ir,
          directPacket(view, { index: true, references, layout: "compact" }),
        );
        expect(r.ok, JSON.stringify(r)).toBe(true);
        if (!r.ok) continue;
        const sheet = r.value.sheets.find(
          (s) =>
            s.view.format === "documentation-view/0.1" &&
            s.view.kind === "signal-loop",
        )!;
        expect(visible(sheet.svg)).toContain(note);
        const { document } = parseHTML(sheet.svg);
        expect(
          [...document.querySelectorAll("desc")]
            .map((d) => d.textContent)
            .join("\n"),
        ).toContain(note);
        expect(document.querySelector("[data-engine-notes]")).not.toBeNull();
        const refs = r.value.sheets.filter(
          (s) =>
            s.view.format === "documentation-view/0.1" &&
            s.view.kind === "references",
        );
        if (references === false) expect(refs).toHaveLength(0);
        else expect(refs.map((s) => visible(s.svg)).join(" ")).toContain(note);
        for (const user of notes) expect(visible(sheet.svg)).toContain(user);
      }
      expect(JSON.stringify(f.ir)).toBe(before);
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "escapes authored device text without changing the note's meaning in %s",
  async (flow) => {
    const f = await directFixture((m) => {
      roleFree(m);
      for (const o of m.objects) {
        if (o.kind === "device") o.designation += '<&>"';
        for (const e of o.endpoints ?? []) e.device += '<&>"';
      }
    });
    try {
      const view = directView({
        flow,
        from: { device: 'TX1<&>"', function: "signal" },
        to: { device: 'AI1<&>"', function: "input" },
      });
      const expected = 'polarity not verified: AI1<&>".input, TX1<&>".signal.';
      const r = await renderSchematicPacket(
        f.ir,
        directPacket(view, { index: true }),
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const sheet = r.value.sheets[0]!.svg;
      expect(visible(sheet)).toContain(expected);
      expect(sheet.match(/<desc>([\s\S]*?)<\/desc>/g)).toEqual([
        '<desc>polarity not verified: AI1&lt;&amp;&gt;".input, TX1&lt;&amp;&gt;".signal.</desc>',
      ]);
      expect(sheet).toContain("AI1&lt;&amp;&gt;");
      const { document } = parseHTML(sheet);
      expect(
        [...document.querySelectorAll("desc")]
          .map((d) => d.textContent)
          .join(" "),
      ).toContain(expected);
      expect(
        r.value.sheets
          .slice(1)
          .map((s) => visible(s.svg))
          .join(" "),
      ).toContain(expected);
      expect(document.querySelector("script")).toBeNull();
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "prints the note at 2.5 mm outside the diagram scale in %s",
  async (flow) => {
    const f = await directFixture(roleFree);
    try {
      const r = await renderSchematicPacket(
        f.ir,
        directPacket(directView({ flow })),
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const { document } = parseHTML(r.value.sheets[0]!.svg);
      const group = document.querySelector("[data-engine-notes]")!;
      expect(group).not.toBeNull();
      const texts = [...group.querySelectorAll("text")];
      expect(texts.map((t) => t.textContent).join(" ")).toContain(note);
      for (const t of texts) {
        expect(t.getAttribute("font-size")).toBe("2.5");
        expect(Number(t.getAttribute("y"))).toBeLessThan(
          r.value.page.heightMm - 40,
        );
        let element = t;
        while (element) {
          expect(element.getAttribute("transform") ?? "").not.toContain(
            "scale",
          );
          expect(element.getAttribute("style") ?? "").not.toMatch(
            /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|font-size/,
          );
          expect(element.getAttribute("display")).not.toBe("none");
          expect(element.getAttribute("visibility")).not.toBe("hidden");
          expect(element.getAttribute("opacity") ?? "1").not.toBe("0");
          element = element.parentElement!;
        }
      }
    } finally {
      await f.dispose();
    }
  },
);

it.each(flows)(
  "refuses unreadable direct-loop notes with its own fit message in %s",
  async (flow) => {
    const f = await directFixture((m) => {
      roleFree(m);
      for (const type of m.types)
        type.description =
          "Synthetic field interface with a complete qualification for the note-space fit reproduction";
    });
    try {
      const r = await renderSchematicPacket(
        f.ir,
        directPacket(
          directView({
            flow,
            notes: Array.from({ length: 6 }, () => "W".repeat(240)),
          }),
          { page: { size: "letter", orientation: "landscape" } },
        ),
      );
      expect(r).toMatchObject({
        ok: false,
        error: {
          code: "R006",
          reason: "unprintable-layout",
          message: expect.stringContaining(
            'Packet view[0] "TX1 - signal loop": Signal loop notes and diagram cannot fit at readable size. Try another orientation or flow, larger paper, or fewer devices or shorter notes.',
          ),
        },
      });
      expect(r).not.toHaveProperty("value");
    } finally {
      await f.dispose();
    }
  },
);
