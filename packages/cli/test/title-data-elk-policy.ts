import ts from "typescript";

export const ELK_RUNTIME_FILE = "packages/render/src/layout/elk-runtime.ts";
export interface ElkImport {
  imported: string;
  local: string;
  loaderOnly?: boolean;
}
// These are the complete, existing static imports, including local alias names.
// No other loading form is admitted outside the pinned function.
export const ELK_IMPORTS = new Map<string, readonly ElkImport[]>([
  [
    "node:fs",
    [{ imported: "readFileSync", local: "readFileSync", loaderOnly: true }],
  ],
  [
    "node:module",
    [{ imported: "createRequire", local: "createRequire", loaderOnly: true }],
  ],
  ["elkjs/lib/elk.bundled.js", [{ imported: "default", local: "BundledElk" }]],
  [
    "./circuit-inline-context.js",
    [
      { imported: "cachedCircuitLayout", local: "cachedCircuitLayout" },
      { imported: "circuitInlineContext", local: "circuitInlineContext" },
    ],
  ],
  ["elkjs/lib/elk-api.js", [{ imported: "ELK", local: "ElkApi" }]],
  [
    "./elk-work.js",
    [
      { imported: "elkWorkScope", local: "elkWorkScope" },
      { imported: "elkPacketWorkTrace", local: "elkPacketWorkTrace" },
    ],
  ],
]);
// No bare external global is used outside the loader. These three members are
// the only external (including lib) member symbols the current module uses.
export const ELK_MEMBERS = new Map<string, readonly [string, string]>([
  ["getStore", ["@types/node/async_hooks.d.ts", "AsyncLocalStorage"]],
  ["layout", ["elkjs/lib/elk-api.d.ts", "ELK"]],
  ["bind", ["typescript/lib/lib.es5.d.ts", "CallableFunction"]],
]);
export function insideElkLoader(
  node: ts.Node,
  loader: ts.FunctionDeclaration | null,
) {
  return (
    loader !== null &&
    node.getStart() >= loader.getStart() &&
    node.end <= loader.end
  );
}
export const elkIssue = (issues: string[], message: string) =>
  issues.push(ELK_RUNTIME_FILE + ": " + message);
