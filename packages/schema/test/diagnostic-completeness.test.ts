import {
  readFile,
  readdir,
  stat,
  mkdtemp,
  mkdir,
  writeFile,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { DIAGNOSTIC_CATALOG } from "../src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const codePattern = /\b[A-Z]+\d{3}\b/g;
async function sources(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await sources(path)));
    else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      entry.name !== "diagnostic-catalog.ts"
    )
      paths.push(path);
  }
  return paths;
}
async function packageSources(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = join(directory, entry.name, "src");
    const info = await stat(src).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info?.isDirectory()) files.push(...(await sources(src)));
  }
  return files;
}
function unwrap(node: ts.Expression): ts.Expression {
  return ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
    ? unwrap(node.expression)
    : node;
}
// Unknown substitutions are markers, not guessed values. This catches split
// code spellings even outside `code:` fields (e.g. a factory argument).
function skeleton(node: ts.Expression): string {
  node = unwrap(node);
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
    return node.text;
  if (ts.isTemplateExpression(node))
    return (
      node.head.text +
      node.templateSpans.map((span) => `#${span.literal.text}`).join("")
    );
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return skeleton(node.left) + skeleton(node.right);
  return "#";
}
function codes(
  source: string | ts.SourceFile,
  checker?: ts.TypeChecker,
): string[] {
  const file =
    typeof source === "string"
      ? ts.createSourceFile("emitter.ts", source, ts.ScriptTarget.Latest, true)
      : source;
  const found = new Set<string>();
  const dynamic = (node: ts.Node): never => {
    throw new Error(
      `Dynamic diagnostic code in ${file.fileName}: ${node.getText(file)}`,
    );
  };
  const visit = (node: ts.Node) => {
    // Includes template fragments, factory arguments, type unions and messages.
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      for (const match of node.text.matchAll(codePattern)) found.add(match[0]);
    if (
      ts.isPropertyAccessExpression(node) &&
      /^[A-Z]+\d{3}$/.test(node.name.text)
    )
      found.add(node.name.text);
    if (
      ts.isTemplateExpression(node) ||
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      const spelling = skeleton(node);
      if (
        /^[A-Z]+\d{3}$/.test(spelling) ||
        (spelling.includes("#") &&
          /[A-Z]/.test(spelling) &&
          /^[A-Z#]*\d[\d#]*$/.test(spelling))
      )
        dynamic(node);
    }
    const value =
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "code"
        ? node.initializer
        : ts.isShorthandPropertyAssignment(node) && node.name.text === "code"
          ? node.name
          : ts.isPropertyDeclaration(node) &&
              ts.isIdentifier(node.name) &&
              node.name.text === "code"
            ? node.initializer
            : undefined;
    if (value) {
      const expression = unwrap(value);
      if (
        ts.isTemplateExpression(expression) ||
        (ts.isBinaryExpression(expression) &&
          expression.operatorToken.kind === ts.SyntaxKind.PlusToken)
      )
        dynamic(expression);
    }
    if (value && checker) {
      const type = checker.getTypeAtLocation(value);
      const members = type.isUnion() ? type.types : [type];
      // Forwarding a finite union from a literal map/typed factory is safe.
      // A broad string, template type, any or unknown is not an emitter code.
      if (
        members.some(
          (t) =>
            t.flags &
            (ts.TypeFlags.StringLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown),
        ) &&
        !members.every((t) => t.isStringLiteral())
      )
        dynamic(value);
      for (const member of members)
        if (member.isStringLiteral() && /^[A-Z]+\d{3}$/.test(member.value))
          found.add(member.value);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}
it("catalogs every production code and forbids dynamically constructed emitter codes", async () => {
  const files = await packageSources(join(root, "packages"));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    types: ["node"],
  });
  const checker = program.getTypeChecker();
  const missing: string[] = [];
  for (const file of files)
    for (const code of codes(program.getSourceFile(file)!, checker))
      if (!Object.hasOwn(DIAGNOSTIC_CATALOG, code))
        missing.push(`${code}: ${file}`);
  expect(missing).toEqual([]);
});
it("detects new literals, factory arguments, unions and catalog references", () => {
  expect(
    codes(
      'const e={code:"Z999"}; emit("Z998"); type Code="Z997"; const s=DIAGNOSTIC_CATALOG.Z996.severity;',
    ),
  ).toEqual(["Z999", "Z998", "Z997", "Z996"]);
});
it("scans template message fragments and multi-letter initialization codes", () => {
  expect(
    codes('const message = `${context} see Z995`; const init = "INIT012";'),
  ).toEqual(["Z995", "INIT012"]);
});
it.each([
  "const e = {code: `T00${n}`};",
  'const e = {code: "T00" + n};',
  "emit(`INIT00${n}`);",
  'const code = ("T" + "00") + n; emit(code);',
  'const code = "T" + "001"; emit(code);',
  'const e = {code: `${"T"}${0}${0}${1}` as const};',
])("rejects dynamic emitter codes: %s", (source) => {
  expect(() => codes(source)).toThrow("Dynamic diagnostic code");
});
it("skips stray files and directories without a source directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "thermite-catalog-files-"));
  try {
    await writeFile(join(directory, ".DS_Store"), "");
    await mkdir(join(directory, "empty-package"));
    await mkdir(join(directory, "package/src"), { recursive: true });
    const file = join(directory, "package/src/emitter.ts");
    await writeFile(file, 'const e = {code:"Z999"};');
    expect(await packageSources(directory)).toEqual([file]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects opaque computed code fields but admits finite literal maps and parameters", () => {
  const inspect = (source: string) => {
    const host = ts.createCompilerHost({});
    host.getSourceFile = (file) =>
      file === "emitter.ts"
        ? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
        : undefined;
    const program = ts.createProgram(
      ["emitter.ts"],
      { strict: true, noLib: true, types: [] },
      host,
    );
    return codes(
      program.getSourceFile("emitter.ts")!,
      program.getTypeChecker(),
    );
  };
  expect(() =>
    inspect(
      "function emit(prefix:string,n:number){const computed = prefix+n; return {code:computed};}",
    ),
  ).toThrow("Dynamic diagnostic code");
  expect(
    inspect(
      'const map={a:"E001",b:"E002"} as const; function emit(code:typeof map[keyof typeof map]){return {code};}',
    ),
  ).toEqual(["E001", "E002"]);
});
