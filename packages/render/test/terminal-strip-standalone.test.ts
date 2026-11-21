import { beforeAll, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseHTML } from "linkedom";
import { compileProject, type ElectricalIr } from "@thermite/compiler";
import { buildDocumentation } from "@thermite/query";
import {
  renderSchematicPacket,
  renderSchematicSheets,
  type RenderedPacket,
} from "../src/sheets.js";
import { longStrip } from "./terminal-strip-pagination-fixture.js";

const view = {
  format: "documentation-view-request/0.1" as const,
  kind: "terminals" as const,
  device: "TB1",
};
let ir: ElectricalIr, nativeKeys: string[];
beforeAll(async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
  ir = c.ir;
  nativeKeys = buildDocumentation(ir, view).rows.map((r) => r.key);
  expect(nativeKeys).toHaveLength(8);
});
function reciprocal(svg: string) {
  const doc = parseHTML(svg).document;
  const terminals = [...doc.querySelectorAll("[data-strip-terminal]")];
  const references = [...doc.querySelectorAll("[data-strip-row]")];
  expect(terminals.map((t) => t.getAttribute("data-strip-terminal"))).toEqual(
    nativeKeys,
  );
  expect(references.map((r) => r.getAttribute("data-strip-row"))).toEqual(
    nativeKeys,
  );
  for (const t of terminals) {
    const key = t.getAttribute("data-strip-terminal");
    const row = references.find(
      (r) => r.getAttribute("data-strip-row") === key,
    )!;
    expect(t.getAttribute("data-inventory-row")).toBe(key);
    expect(t.getAttribute("data-strip-ref")).toBe(row.textContent);
    expect(t.textContent).toContain(row.textContent);
  }
}
it.each(["standalone", "packet", "CLI report"] as const)(
  "draws all native TB1 terminals with reciprocal row references through %s",
  async (mode) => {
    const original = JSON.stringify(ir);
    let packet: RenderedPacket;
    if (mode === "CLI report") {
      packet = JSON.parse(
        execFileSync(
          process.execPath,
          [
            resolve("thermite.mjs"),
            "report",
            "terminals",
            "--device",
            "TB1",
            "--project",
            "examples/motor-starter",
            "--json",
          ],
          {
            encoding: "utf8",
            maxBuffer: 5_000_000,
            stdio: ["ignore", "pipe", "pipe"],
          },
        ),
      );
    } else {
      const result =
        mode === "standalone"
          ? await renderSchematicSheets(ir, view)
          : await renderSchematicPacket(ir, {
              format: "schematic-packet-request/0.1",
              index: false,
              views: [view],
            });
      if (!result.ok) throw Error(JSON.stringify(result.error));
      packet = result.value;
    }
    reciprocal(packet.sheets.map((s) => s.svg).join("\n"));
    expect(JSON.stringify(ir)).toBe(original);
  },
);
it("retains a multi-sheet native strip and its split jumper through the standalone entry point", async () => {
  const { ir, keys } = longStrip();
  const result = await renderSchematicSheets(
    ir,
    { ...view, device: "XT-LONG" },
    undefined,
    { size: "letter", orientation: "landscape" },
  );
  if (!result.ok) throw Error(JSON.stringify(result.error));
  const strips = result.value.sheets.filter(
    (s) => s.view.kind === "terminal-strip",
  );
  expect(strips.length).toBeGreaterThan(1);
  const doc = parseHTML(strips.map((s) => s.svg).join("\n")).document;
  expect(
    [...doc.querySelectorAll("[data-strip-terminal]")].map(
      (t) => JSON.parse(t.getAttribute("data-strip-terminal")!)[1],
    ),
  ).toEqual(keys);
  expect(
    doc.querySelectorAll("[data-strip-continuation]").length,
  ).toBeGreaterThan(0);
  expect(
    doc.querySelectorAll('[data-strip-jumper="native-cross-sheet-jumper"]'),
  ).toHaveLength(2);
});

it("preserves a successful single-sheet terminal SVG without orphan strip references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thermite-terminal-svg-"));
  try {
    const output = join(directory, "terminal.svg");
    execFileSync(
      process.execPath,
      [
        resolve("thermite.mjs"),
        "report",
        "terminals",
        "--device",
        "TB1",
        "--project",
        "examples/motor-starter",
        "-o",
        output,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const doc = parseHTML(await readFile(output, "utf8")).document;
    expect(
      [...doc.querySelectorAll("[data-report-row]")].map((r) =>
        r.getAttribute("data-report-row"),
      ),
    ).toEqual(nativeKeys);
    expect(
      doc.querySelectorAll("[data-strip-row],[data-strip-ref]"),
    ).toHaveLength(0);
    expect(doc.querySelectorAll("[data-strip-terminal]")).toHaveLength(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
