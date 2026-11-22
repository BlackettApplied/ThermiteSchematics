import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { canonical, json } from "./support.mjs";
import { cropBox, drawingContextOptions } from "./browser.mjs";
it("captures the exact box serialized for both sheet and packet evidence", async () => {
  const source = await runnerSource(),
    ast = ts.createSourceFile(
      "run.mjs",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    found = [];
  function walk(n) {
    if (
      ts.isVariableDeclaration(n) &&
      n.name.getText(ast) === "box" &&
      n.initializer?.getText(ast).includes("cropBox(")
    )
      found.push(n.initializer.getText(ast));
    ts.forEachChild(n, walk);
  }
  walk(ast);
  expect(found).toHaveLength(2);
  for (const init of found) {
    const bbox = { x: 14.05249, y: 13.11849, w: 30.54749, h: 1.90849 };
    const box = new Function(
      "canonical",
      "cropBox",
      "finding",
      "g",
      "row",
      "packet",
      `return ${init}`,
    )(
      canonical,
      cropBox,
      { bbox },
      { width: 432, height: 280 },
      { evidence: { findings: [{ bbox }] } },
      { page: { widthMm: 432, heightMm: 280 } },
    );
    expect(box).toEqual(JSON.parse(json(box)));
  }
});
it("uses offline capture without service workers or page scripts", () => {
  expect(drawingContextOptions).toMatchObject({
    offline: true,
    serviceWorkers: "block",
    javaScriptEnabled: false,
    deviceScaleFactor: 300 / 96,
  });
});
it.each(["run.mjs", "crop-source.mjs"])(
  "%s wires the shared isolated capture context",
  async (name) => {
    const source =
        name === "run.mjs"
          ? await runnerSource()
          : await readFile(new URL(name, import.meta.url), "utf8"),
      ast = ts.createSourceFile(
        name,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      ),
      args = [];
    function walk(n) {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "newContext"
      )
        args.push(n.arguments.map((a) => a.getText(ast)));
      ts.forEachChild(n, walk);
    }
    walk(ast);
    expect(args).toEqual([["drawingContextOptions"]]);
  },
);
it("the runner captures delivered source files and includes the per-sheet pins in JSON", async () => {
  const s = await runnerSource();
  const ast = ts.createSourceFile(
      "run.mjs",
      s,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    sources = [];
  function walk(n) {
    if (ts.isPropertyAssignment(n) && n.name.getText(ast) === "sourceHashes")
      sources.push(n.initializer.getText(ast));
    ts.forEachChild(n, walk);
  }
  walk(ast);
  expect(sources).toHaveLength(2);
  expect(sources.some((x) => x.startsWith("await captureSources("))).toBe(true);
  const root = sources.find((x) => x.startsWith("{"));
  const value = new Function(
    "SOURCE_HASH_FORMAT",
    "results",
    `return (${root});`,
  )("format", [
    { sourceHashes: [{ case: "one", sheet: 1 }] },
    { sourceHashes: [{ case: "two", sheet: 2 }] },
    { ok: false },
  ]);
  expect(value).toEqual({
    format: "format",
    sheets: [
      { case: "one", sheet: 1 },
      { case: "two", sheet: 2 },
    ],
  });
});

it("the builder freshly captures source rather than reading a pipeline PNG", async () => {
  const source = await readFile(
    new URL("./repin-crop-index.mjs", import.meta.url),
    "utf8",
  );
  expect(source).toContain("await captureSourceCrop(browser, text,");
  expect(source).not.toContain("join(sourceRoot, plan.pipelineCrop)");
});

it("PDF measurement and report pins receive the same single-read byte buffer", async () => {
  const s = await runnerSource(),
    ast = ts.createSourceFile(
      "run.mjs",
      s,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
  let statement;
  function walk(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "pdfSource")
      statement = n.parent.parent.getText(ast);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  const bytes = Buffer.from("delivered PDF"),
    loads = [];
  let reads = 0;
  const source = await new Function(
    "readFile",
    "pdfPath",
    "loadPdfBytes",
    "PDFJS_VERSION",
    `return (async()=>{${statement};return pdfSource;})()`,
  )(
    async () => {
      reads++;
      return bytes;
    },
    "packet.pdf",
    async (data) => {
      loads.push(data);
      return {};
    },
    "version",
  );
  expect(reads).toBe(1);
  expect(source.bytes).toBe(loads[0]);
  expect(source.bytes).toBe(bytes);
  expect(source.pdfjsVersion).toBe("version");
});

async function runnerSource() {
  return (
    await Promise.all(
      ["run.mjs", "run-case.mjs", "run-sheet.mjs"].map((name) =>
        readFile(new URL(name, import.meta.url), "utf8"),
      ),
    )
  ).join("\n");
}
