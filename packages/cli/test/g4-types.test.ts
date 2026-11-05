import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { DIAGNOSTIC_CATALOG } from "../../schema/src/diagnostic-catalog.js";
import { expect, it } from "vitest";
import { repositoryRoot } from "./project-guide/harness.js";

const vocabulary = join(
  repositoryRoot,
  "packages/agent-tools/src/request-vocabulary.ts",
);
const consumer = join(repositoryRoot, "packages/cli/src/__g4-type-repro.ts");
function diagnostics(overrides: Map<string, string>) {
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"],
  };
  const host = ts.createCompilerHost(options);
  // TypeScript supplies slash-normalized paths, including on Windows. Match
  // the host's path/case rules before looking up in-memory source overrides.
  const key = (file: string) => host.getCanonicalFileName(resolve(file));
  const sources = new Map(
    [...overrides].map(([file, source]) => [key(file), source]),
  );
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, fresh) =>
    sources.has(key(file))
      ? ts.createSourceFile(
          file,
          sources.get(key(file))!,
          ts.ScriptTarget.Latest,
          true,
        )
      : original(file, version, onError, fresh);
  return ts
    .getPreEmitDiagnostics(
      ts.createProgram([...overrides.keys()], options, host),
    )
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}
it("keeps the published diagnostic type restricted to the schema's E/W/I codes", () => {
  const pattern = new RegExp(
    JSON.parse(
      readFileSync(
        join(repositoryRoot, "packages/schema/schemas/diagnostic.schema.json"),
        "utf8",
      ),
    ).properties.code.pattern,
  );
  const assignments = Object.keys(DIAGNOSTIC_CATALOG)
    .map(
      (code) =>
        `${pattern.test(code) ? "" : "// @ts-expect-error outside the published diagnostic schema\n"}const code${code}: Diagnostic["code"] = "${code}";`,
    )
    .join("\n");
  const errors = diagnostics(
    new Map([
      [
        consumer,
        `import type { Diagnostic } from "../../schema/src/diagnostics.js";\n${assignments}`,
      ],
    ]),
  );
  expect(errors).toEqual([]);
});
it("rejects query and flow vocabulary additions without matching request types", () => {
  const mutant = readFileSync(vocabulary, "utf8")
    .replace(
      /literals\(\s*"neighbors",\s*"trace",\s*"cable",\s*"net"\s*,?\s*\)/,
      'literals("neighbors", "trace", "cable", "net", "path")',
    )
    .replace(
      /literals\(\s*"left-to-right",\s*"top-to-bottom"\s*,?\s*\)/,
      'literals("left-to-right", "top-to-bottom", "right-to-left")',
    );
  const errors = diagnostics(new Map([[vocabulary, mutant]]));
  expect(errors.join("\n")).toContain('"path"');
  expect(errors.join("\n")).toContain('"right-to-left"');
});
