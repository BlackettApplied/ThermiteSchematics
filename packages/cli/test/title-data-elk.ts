import { createHash } from "node:crypto";
import ts from "typescript";
import { ELK_RUNTIME_FILE, insideElkLoader } from "./title-data-elk-policy.js";
import { auditElkAllowlist } from "./title-data-elk-allowlist.js";
export { ELK_RUNTIME_FILE } from "./title-data-elk-policy.js";
// Hash only loadFauxWorker's text, with universal line endings normalized.
const LOADER_SHA256 =
  "4909b790a7f4f25d642309eed295b73956f5574bf14603900331b45cc74b8e15";
export function elkLoaderException(
  file: string,
  tree: ts.SourceFile,
  issues: string[],
) {
  if (file !== ELK_RUNTIME_FILE) return null;
  const loaders = tree.statements
    .filter(ts.isFunctionDeclaration)
    .filter((fn) => fn.name?.text === "loadFauxWorker");
  const loader = loaders[0];
  if (
    loaders.length !== 1 ||
    !loader ||
    createHash("sha256")
      .update(loader.getText(tree).replace(/\r\n?|[\u2028\u2029]/g, "\n"))
      .digest("hex") !== LOADER_SHA256
  ) {
    issues.push(file + ": ELK dynamic loader pin mismatch");
    return null;
  }
  return loader;
}
export function forbiddenDynamicCode(
  node: ts.Node,
  loader: ts.FunctionDeclaration | null,
  text: (node: ts.Expression) => string | undefined,
) {
  const name = ts.isIdentifier(node)
    ? node.text
    : ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression
        ? text(node.argumentExpression)
        : null;
  const constructorReference =
    name === "constructor" &&
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node));
  return (
    name === "eval" ||
    ((name === "Function" || constructorReference) &&
      !insideElkLoader(node, loader))
  );
}
export function auditElkCapabilities(
  tree: ts.SourceFile,
  loader: ts.FunctionDeclaration | null,
  issues: string[],
  _text: (node: ts.Expression | undefined) => string | undefined,
  _factories: ReadonlySet<string>,
) {
  auditElkAllowlist(tree, loader, issues);
}
