import ts from "typescript";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ELK_RUNTIME_FILE } from "./title-data-elk-policy.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const file = resolve(repo, ELK_RUNTIME_FILE);
const sources = new Map<string, ts.SourceFile | undefined>();
let options: ts.CompilerOptions | undefined;
let previous: ts.Program | undefined;
let stats = { milliseconds: 0, rootFiles: 1, sourceFiles: 0 };

function programOptions() {
  if (!options) {
    const path = resolve(repo, "packages/render/tsconfig.json");
    const raw = ts.readConfigFile(path, ts.sys.readFile);
    if (raw.error)
      throw Error(ts.flattenDiagnosticMessageText(raw.error.messageText, "\n"));
    const config = ts.parseJsonConfigFileContent(
      raw.config,
      ts.sys,
      dirname(path),
      {},
      path,
    );
    if (config.errors.length) throw Error("Cannot configure ELK audit Program");
    options = { ...config.options, noEmit: true };
  }
  return options;
}
export function elkProgram(source: ts.SourceFile) {
  const start = performance.now(),
    config = programOptions();
  const host = ts.createCompilerHost(config, true),
    original = host.getSourceFile;
  host.getSourceFile = (name, version, onError, fresh) => {
    if (resolve(name) === file)
      return ts.createSourceFile(file, source.text, version, true);
    if (!sources.has(name))
      sources.set(name, original(name, version, onError, fresh));
    return sources.get(name);
  };
  const program = ts.createProgram({
    rootNames: [file],
    options: config,
    host,
    ...(previous ? { oldProgram: previous } : {}),
  });
  const tree = program.getSourceFile(file),
    checker = program.getTypeChecker();
  if (!tree) throw Error("Missing ELK audit Program root");
  previous = program;
  stats = {
    milliseconds: performance.now() - start,
    rootFiles: program.getRootFileNames().length,
    sourceFiles: program.getSourceFiles().length,
  };
  return { tree, checker, program };
}
export const elkProgramStats = () => ({ ...stats });
