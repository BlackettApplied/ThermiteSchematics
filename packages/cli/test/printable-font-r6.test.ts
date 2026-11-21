import { readFile, cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { bundledFontUrl } from "../src/font-assets.js";
import { create } from "fontkit";
import { expect, it } from "vitest";
import {
  printableFontStyle,
  embedPrintableFont,
  PrintableFontBudgetError,
  fontBudgetFailure,
} from "../src/printable-font.js";

it("subsets one Math-only character without duplicating the ASCII sheet into Math", () => {
  const text = Array.from({ length: 95 }, (_, i) =>
    String.fromCodePoint(32 + i),
  ).join("");
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const style = printableFontStyle(
    `<svg><text>${escaped}⨁</text><text font-weight="700">M1</text></svg>`,
  );
  const math = [...style.matchAll(/@font-face\{([^}]+)\}/gu)].filter((m) =>
    m[1]!.includes("Thermite Math"),
  );
  expect(math).toHaveLength(1);
  const encoded = math[0]![1]!.match(/base64,([a-z\d+/=]+)/iu)![1]!;
  const font = create(Buffer.from(encoded, "base64"));
  if (!("characterSet" in font)) throw Error();
  expect(font.characterSet).toEqual([0x2a01]);
});

it("tailors the R007 remedy to the medium that exceeded its budget", () => {
  const svg = fontBudgetFailure(
    new PrintableFontBudgetError(61441, 61440, "svg"),
  );
  const html = fontBudgetFailure(
    new PrintableFontBudgetError(512001, 512000, "html"),
  );
  expect(svg?.message).toContain("export .html or .pdf instead");
  expect(html?.message).toContain("export .pdf instead");
  expect(html?.message).not.toContain(".html");
});

it.each([
  [
    "NotoSans-Regular",
    "b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5",
  ],
  [
    "NotoSans-Bold",
    "c976e4b1b99edc88775377fcc21692ca4bfa46b6d6ca6522bfda505b28ff9d6a",
  ],
  [
    "NotoSansMath-Regular",
    "80b61fd613d3519197e64fff6f7e71fdc7f3e6526440ea4115b554ef7fd59af7",
  ],
])(
  "resolves the single packaged %s source without changing its bytes",
  async (name, hash) => {
    expect(
      createHash("sha256")
        .update(await readFile(bundledFontUrl(name)))
        .digest("hex"),
    ).toBe(hash);
    expect(bundledFontUrl(name).href).toBe(
      pathToFileURL(resolve(`packages/render/assets/fonts/${name}.ttf`)).href,
    );
  },
);

it("reports real HTML font overflow with the PDF remedy through embedPrintableFont", async () => {
  const regular = create(await readFile(bundledFontUrl("NotoSans-Regular")));
  const math = create(await readFile(bundledFontUrl("NotoSansMath-Regular")));
  if (!("characterSet" in regular) || !("characterSet" in math)) throw Error();
  const text = [...new Set([...regular.characterSet, ...math.characterSet])]
    .map((code) => String.fromCodePoint(code))
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  let failure: unknown;
  try {
    embedPrintableFont(
      `<html><head></head><body><svg><text font-weight="700">${text}</text></svg></body></html>`,
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(PrintableFontBudgetError);
  if (!(failure instanceof PrintableFontBudgetError))
    throw Error("Expected a real font-budget refusal");
  expect(failure.bytes).toBeGreaterThan(500 * 1024);
  expect(failure.maximum).toBe(500 * 1024);
  expect(failure.medium).toBe("html");
  expect(failure.message).toContain("export .pdf instead");
  expect(failure.message).not.toContain(".html");
});

it("resolves shared fonts inside the existing staged runtime closure", async () => {
  const stage = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-font-closure-"),
  );
  try {
    // Use pack.mjs's existing package file lists, without a checkout link or new export.
    for (const name of ["cli", "render"]) {
      const source = `packages/${name}`;
      const manifest = JSON.parse(
        await readFile(`${source}/package.json`, "utf8"),
      );
      const target = join(stage, "node_modules/@thermite", name);
      await mkdir(target, { recursive: true });
      for (const file of ["package.json", ...manifest.files, "src"])
        await cp(join(source, file), join(target, file), { recursive: true });
    }
    const entry = pathToFileURL(
      join(stage, "node_modules/@thermite/cli/dist/font-assets.js"),
    ).href;
    const program = `import {bundledFontUrl} from ${JSON.stringify(entry)};
      import {readFileSync} from "node:fs";
      import {createHash} from "node:crypto";
      const names=["NotoSans-Regular","NotoSans-Bold","NotoSansMath-Regular","NotoSansMono-Regular"];
      console.log(JSON.stringify(names.map(name=>({name,url:bundledFontUrl(name).href,sha256:createHash("sha256").update(readFileSync(bundledFontUrl(name))).digest("hex")}))));`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", program],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const rows = JSON.parse(result.stdout) as {
      name: string;
      url: string;
      sha256: string;
    }[];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      const owner = row.name === "NotoSansMono-Regular" ? "cli" : "render";
      expect(row.url).toBe(
        pathToFileURL(
          join(
            stage,
            `node_modules/@thermite/${owner}/assets/fonts/${row.name}.ttf`,
          ),
        ).href,
      );
      expect(row.sha256).toBe(
        createHash("sha256")
          .update(await readFile(bundledFontUrl(row.name)))
          .digest("hex"),
      );
    }
    await expect(
      readFile(
        join(
          stage,
          "node_modules/@thermite/cli/assets/fonts/NotoSans-Regular.ttf",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
});
