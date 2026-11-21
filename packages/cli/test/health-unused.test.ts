import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const packages = [
  "schema",
  "core-library",
  "compiler",
  "query",
  "render",
  "agent-tools",
  "cli",
];
for (const flag of ["noUnusedLocals", "noUnusedParameters"]) {
  it.each(packages)("keeps " + flag + " enabled in %s", (name) => {
    const config = JSON.parse(
      readFileSync(resolve("packages", name, "tsconfig.json"), "utf8"),
    );
    expect(config.compilerOptions[flag]).toBe(true);
  });
}
function unusedDiagnostics(text: string) {
  const config = resolve("packages/render/tsconfig.json"),
    file = resolve("packages/render/src/health8-unused-control.ts");
  const raw = ts.readConfigFile(config, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    raw.config,
    ts.sys,
    dirname(config),
    { noEmit: true },
    config,
  );
  expect(parsed.errors).toEqual([]);
  const host = ts.createCompilerHost(parsed.options, true),
    original = host.getSourceFile;
  host.getSourceFile = (name, version, onError, fresh) =>
    resolve(name) === file
      ? ts.createSourceFile(file, text, version, true)
      : original(name, version, onError, fresh);
  const program = ts.createProgram({
    rootNames: [file],
    options: parsed.options,
    host,
  });
  const tree = program.getSourceFile(file);
  if (!tree) throw Error("Missing virtual unused-check source");
  expect(program.getSyntacticDiagnostics(tree)).toEqual([]);
  return program.getSemanticDiagnostics(tree).map((d) => ({
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, " "),
  }));
}
it.each([
  ["local", "const unusedLocal=1; export {};", "unusedLocal"],
  [
    "parameter",
    "export function fixture(unusedParameter:string){return 1;}",
    "unusedParameter",
  ],
])(
  "the real render configuration rejects an unused %s",
  (_kind, source, name) => {
    expect(unusedDiagnostics(source)).toEqual([
      {
        code: 6133,
        message: "'" + name + "' is declared but its value is never read.",
      },
    ]);
  },
);
