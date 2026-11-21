import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { selectSignalLoop } from "../src/signal-loop.js";
import { loopFunctionReference } from "../src/signal-loop/polarity.js";
import { renderSchematicPacket } from "../src/sheets.js";
import {
  directFixture,
  directPacket,
  directView,
  flows,
  roleFree,
} from "./direct-loop-fixture.js";

it.each(flows)(
  "never prints unlabeled selector keys in direct-loop notes in %s",
  async (flow) => {
    const hidden = ["unlabeled_transmitter_228", "unlabeled_channel_228"];
    const f = await directFixture((m) => {
      roleFree(m);
      for (const [i, old, key] of [
        [1, "signal", hidden[0]!],
        [2, "input", hidden[1]!],
      ] as const) {
        m.types[i].functions[key] = m.types[i].functions[old];
        delete m.types[i].functions[old];
      }
    });
    try {
      const view = directView({
        flow,
        from: { device: "TX1", function: hidden[0]! },
        to: { device: "AI1", function: hidden[1]! },
      });
      const result = await renderSchematicPacket(f.ir, directPacket(view));
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      for (const sheet of result.value.sheets) {
        const { document } = parseHTML(sheet.svg);
        const text = [...document.querySelectorAll("text, desc")]
          .map((e) => e.textContent)
          .join(" ");
        for (const key of hidden) expect(text).not.toContain(key);
      }
      expect(result.value.sheets[0]!.svg).toContain(
        "polarity not verified: AI1 terminals p–n, TX1 terminals p–n.",
      );
    } finally {
      await f.dispose();
    }
  },
);

it("uses only bound terminals in authored order, falling back to the designation", async () => {
  const f = await directFixture(roleFree);
  try {
    const endpoint = selectSignalLoop(f.ir, directView()).to;
    const reference = (keys: string[]) =>
      loopFunctionReference({
        ...endpoint,
        function: {
          ...endpoint.function,
          terminals: keys.map((terminalKey) => ({
            deviceUid: endpoint.device.uid,
            terminalKey,
          })),
        },
      });
    expect(reference(["9", "13"])).toBe("AI1 terminals 9 / 13");
    expect(reference(["13", "9"])).toBe("AI1 terminals 13 / 9");
    expect(reference(["3"])).toBe("AI1 terminal 3");
    expect(reference(["3", "5", "7"])).toBe("AI1 terminals 3 / 5 / 7");
    expect(reference(["1/2", "2/1"])).toBe("AI1 terminals 1/2–2/1");
    expect(reference(["1/2", "3"])).toBe("AI1 terminals 1/2–3");
    expect(reference(["1/2"])).toBe("AI1 terminal 1/2");
    expect(reference([])).toBe("AI1");
  } finally {
    await f.dispose();
  }
});

it.each(flows)(
  "escapes special characters in authored terminal bindings in %s",
  async (flow) => {
    const terminal = '3<&>"';
    const f = await directFixture((m) => {
      roleFree(m);
      for (const i of [1, 2]) {
        const type = m.types[i];
        type.terminals[terminal] = type.terminals.p;
        delete type.terminals.p;
        for (const fn of Object.values(type.functions) as {
          terminals: string[];
        }[])
          fn.terminals = fn.terminals.map((t) => (t === "p" ? terminal : t));
      }
      for (const o of m.objects)
        for (const endpoint of o.endpoints ?? [])
          if (endpoint.terminal === "p") endpoint.terminal = terminal;
    });
    try {
      const result = await renderSchematicPacket(
        f.ir,
        directPacket(directView({ flow })),
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) return;
      const svg = result.value.sheets[0]!.svg;
      const { document } = parseHTML(svg);
      const note = `polarity not verified: AI1 terminals ${terminal}–n, TX1 terminals ${terminal}–n.`;
      expect(document.querySelector("desc")!.textContent).toBe(note);
      expect(
        [...document.querySelectorAll("[data-engine-notes] text")]
          .map((t) => t.textContent)
          .join(" "),
      ).toContain(note);
      expect(svg).toContain('3&lt;&amp;&gt;"–n');
      expect(svg).not.toContain(terminal);
    } finally {
      await f.dispose();
    }
  },
);
