import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { create } from "fontkit";
import { compileProject } from "@thermite/compiler";
import { renderSchematic } from "@thermite/render";
import { runRender } from "../src/index.js";
import { inflateSync } from "node:zlib";
import { printableTextMetrics } from "../../render/src/symbols/printable-font.js";
import {
  subsetPrintableFont,
  printableFontStyle,
} from "../src/printable-font.js";
const specimen = "AV To office ffi á Å Ω 3~ → ⏚";
function woffTables(w: Buffer) {
  const result = new Map<string, Buffer>();
  for (let i = 0; i < w.readUInt16BE(12); i++) {
    const p = 44 + 20 * i,
      at = w.readUInt32BE(p + 4),
      length = w.readUInt32BE(p + 8),
      raw = w.subarray(at, at + length);
    result.set(
      w.toString("ascii", p, p + 4),
      length < w.readUInt32BE(p + 12) ? inflateSync(raw) : raw,
    );
  }
  return result;
}
it("delivers only cmap/outline/advance tables, no shaping or hinting, with byte-identical hmtx", async () => {
  const pins = [
    "5fc28e450ceb3fb11312a062d8f4a8da1b73480e149b8978179ca7159e43a008",
    "eb156658d5903ce6cbe39e15216f213b4e2c457d0c4e7df3c744a9d022367dab",
    "f9830f7fb352956d02835d1a56f13e8486a900f08222a75fdc39308c77e59149",
  ];
  for (const [index, face] of [
    "NotoSans-Regular",
    "NotoSans-Bold",
    "NotoSansMath-Regular",
  ].entries()) {
    const original = create(
      await readFile(`packages/render/assets/fonts/${face}.ttf`),
    );
    const bytes = subsetPrintableFont(face, specimen),
      delivered = create(bytes),
      tables = woffTables(bytes);
    if (!("unitsPerEm" in original) || !("unitsPerEm" in delivered))
      throw Error();
    expect([...tables.keys()].sort()).toEqual(
      [
        "OS/2",
        "STAT",
        "cmap",
        "glyf",
        "head",
        "hhea",
        "hmtx",
        "loca",
        "maxp",
        "name",
        "post",
      ]
        .filter((t) => t !== "STAT" || tables.has("STAT"))
        .sort(),
    );
    // Captured from the pre-hint-removal R4 encoder, including its unused-glyph zeros.
    expect(createHash("sha256").update(tables.get("hmtx")!).digest("hex")).toBe(
      pins[index],
    );
    const loca = tables.get("loca")!,
      glyf = tables.get("glyf")!;
    for (let i = 0; i < tables.get("maxp")!.readUInt16BE(4); i++) {
      const at = loca.readUInt32BE(i * 4),
        end = loca.readUInt32BE((i + 1) * 4);
      if (at === end) continue;
      const contours = glyf.readInt16BE(at);
      if (contours >= 0)
        expect(glyf.readUInt16BE(at + 10 + contours * 2)).toBe(0);
      else {
        let p = at + 10,
          flags: number;
        do {
          flags = glyf.readUInt16BE(p);
          expect(flags & 0x100).toBe(0);
          p +=
            4 +
            (flags & 1 ? 4 : 2) +
            (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        } while (flags & 0x20);
      }
    }
    const hmtx = tables.get("hmtx")!,
      metrics = tables.get("hhea")!.readUInt16BE(34);
    const sum = [...specimen.normalize("NFC")].reduce((total, c) => {
      const id = original.glyphForCodePoint(c.codePointAt(0)!).id;
      return total + hmtx.readUInt16BE(Math.min(id, metrics - 1) * 4);
    }, 0);
    expect(sum).toBe(
      [...specimen.normalize("NFC")].reduce(
        (total, c) =>
          total + original.glyphForCodePoint(c.codePointAt(0)!).advanceWidth,
        0,
      ),
    );
    if (face === "NotoSans-Regular") {
      const plain = "AV office Å Ω";
      const sum = [...plain].reduce((n, c) => {
        const id = original.glyphForCodePoint(c.codePointAt(0)!).id;
        return n + hmtx.readUInt16BE(Math.min(id, metrics - 1) * 4);
      }, 0);
      expect(printableTextMetrics(plain).advance).toBeCloseTo(
        (sum / original.unitsPerEm) * 10,
        8,
      );
    }
  }
});
it("pins the full regular, bold and mathematical delivery block", () => {
  const doc =
    '<svg><text font-weight="400">AV office Ω ⏚</text><text font-weight="700">M1 ffi →</text></svg>';
  const a = printableFontStyle(doc),
    b = printableFontStyle(doc);
  expect(a).toBe(b);
  expect(createHash("sha256").update(a).digest("hex")).toBe(
    "4de4bed0cfdcb767ee48b34d6589433cd202727aaf3c5f9012e8a3a3cd3e49fa",
  );
  expect(a.match(/@font-face/gu)).toHaveLength(3);
});

const range = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)).join(
    "",
  );
it("exports the review's multilingual title-block glyph inventory within 60 KiB", () => {
  const text =
    range(32, 126) +
    range(0x410, 0x44f) +
    "Ёё" +
    range(0x391, 0x3a9).replace("΢", "") +
    range(0x3b1, 0x3c9) +
    "ĄąĆćĘęŁłŃńÓóŚśŹźŻżÄäÖöÜüßÀÂÆÇÈÉÊËÎÏÔŒÙÛÜŸàâæçèéêëîïôœùûüÿ";
  const doc = `<svg><text>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text><text font-weight="700">M1</text></svg>`;
  expect(new Set(text).size).toBe(265);
  expect(Buffer.byteLength(printableFontStyle(doc))).toBeLessThanOrEqual(61440);
});

it("exports a valid multilingual K1 title block through the built CLI", async () => {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-multilingual-"),
  );
  try {
    await cp("examples/motor-starter", root, { recursive: true });
    const text =
      range(32, 126) +
      range(0x410, 0x44f) +
      "Ёё" +
      range(0x391, 0x3a9).replace("΢", "") +
      range(0x3b1, 0x3c9) +
      "ĄąĆćĘęŁłŃńÓóŚśŹźŻżÄäÖöÜüßÀÂÆÇÈÉÊËÎÏÔŒÙÛÜŸàâæçèéêëîïôœùûüÿ";
    const p = JSON.parse(
      await readFile(join(root, "presentation.json"), "utf8"),
    );
    p.titleBlock.lines = [...text].reduce<string[]>((lines, c, i) => {
      if (i % 90 === 0) lines.push("");
      lines[lines.length - 1] += c;
      return lines;
    }, []);
    await writeFile(join(root, "presentation.json"), JSON.stringify(p));
    const output = join(root, "k1.svg");
    const r = spawnSync(
      process.execPath,
      [
        resolve("thermite.mjs"),
        "view",
        "K1",
        "--actuation",
        "--project",
        root,
        "-o",
        output,
      ],
      { encoding: "utf8" },
    );
    expect(r.stderr).not.toContain("T001");
    expect(r.status, r.stderr).toBe(0);
    expect(await readFile(output, "utf8")).toContain("data-thermite-font=");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("returns documented R007, exit 1 and a remedy rather than T001 for an oversized SVG subset", async () => {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-font-overflow-"),
  );
  try {
    await cp("examples/motor-starter", root, { recursive: true });
    const font = create(
      await readFile("packages/render/assets/fonts/NotoSans-Regular.ttf"),
    );
    if (!("characterSet" in font)) throw Error();
    const chars = font.characterSet
      .filter(
        (c) =>
          c >= 32 &&
          c < 0x530 &&
          ![0x7f, 0xad].includes(c) &&
          !(c >= 0x300 && c <= 0x36f) &&
          !(c >= 0x80 && c < 0xa0),
      )
      .slice(0, 520)
      .map((c) => String.fromCodePoint(c));
    const p = JSON.parse(
      await readFile(join(root, "presentation.json"), "utf8"),
    );
    p.titleBlock.lines = [0, 130, 260, 390].map((i) =>
      chars.slice(i, i + 130).join(""),
    );
    await writeFile(join(root, "presentation.json"), JSON.stringify(p));
    const r = spawnSync(
      process.execPath,
      [
        resolve("thermite.mjs"),
        "view",
        "K1",
        "--actuation",
        "--project",
        root,
        "-o",
        join(root, "refused.svg"),
      ],
      { encoding: "utf8" },
    );
    expect(r.status, r.stderr).toBe(1);
    const report = JSON.parse(r.stderr);
    expect(report.error.code).toBe("R007");
    expect(report.error.message).toContain("export .html or .pdf instead");
    await expect(readFile(join(root, "refused.svg"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    for (const extension of ["html", "pdf"]) {
      const alternative = spawnSync(
        process.execPath,
        [
          resolve("thermite.mjs"),
          "view",
          "K1",
          "--actuation",
          "--project",
          root,
          "-o",
          join(root, `alternative.${extension}`),
        ],
        { encoding: "utf8" },
      );
      expect(alternative.status, alternative.stderr).toBe(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves R007 and compiler diagnostics at the continuous-SVG file boundary", async () => {
  const c = await compileProject("examples/motor-starter");
  if (!c.ok) throw Error();
  const rendered = await renderSchematic(c.ir, {
    format: "schematic-view-request/0.1",
    family: "control",
    root: { by: "designation", value: "K1" },
  });
  if (!rendered.ok) throw Error();
  const font = create(
    await readFile("packages/render/assets/fonts/NotoSans-Regular.ttf"),
  );
  if (!("characterSet" in font)) throw Error();
  const chars = font.characterSet
    .filter(
      (c) =>
        c >= 32 &&
        c < 0x530 &&
        ![0x7f, 0xad].includes(c) &&
        !(c >= 0x300 && c <= 0x36f) &&
        !(c >= 0x80 && c < 0xa0),
    )
    .slice(0, 520)
    .map((c) => String.fromCodePoint(c))
    .join("");
  const svg = `<svg><text>${chars.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text><text font-weight="700">M1</text></svg>`;
  const root = await mkdtemp(
      join(await realpath(tmpdir()), "thermite-legacy-font-limit-"),
    ),
    output = join(root, "refused.svg");
  try {
    const r = await runRender("K1", {
      family: "control",
      project: "examples/motor-starter",
      output,
      json: true,
      createRenderer: () => ({
        render: async () => ({
          ...rendered,
          value: { ...rendered.value, svg },
        }),
      }),
    });
    expect(r.exitCode).toBe(1);
    expect(r.written).toBe(false);
    expect(r.stdout).toBe("");
    expect(r.error?.code).toBe("R007");
    expect(r.diagnostics).toHaveLength(c.diagnostics.length);
    expect(JSON.parse(r.stderr).error.message).toContain(
      "export .html or .pdf instead",
    );
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
