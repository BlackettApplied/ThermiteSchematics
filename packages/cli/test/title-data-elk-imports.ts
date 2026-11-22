import ts from "typescript";
import { ELK_IMPORTS, elkIssue } from "./title-data-elk-policy.js";

interface ImportRow {
  local: ts.Identifier;
  imported: string;
  foreign: ts.Node | null;
}
export interface ElkPermissions {
  names: Set<ts.Node>;
  aliases: Map<ts.Symbol, boolean>;
  targets: Map<ts.Symbol, boolean>;
}
function importRows(node: ts.ImportDeclaration): ImportRow[] {
  const clause = node.importClause,
    rows: ImportRow[] = [];
  if (clause?.name)
    rows.push({ local: clause.name, imported: "default", foreign: null });
  const bindings = clause?.namedBindings;
  if (bindings && ts.isNamedImports(bindings))
    for (const item of bindings.elements)
      rows.push({
        local: item.name,
        imported: item.propertyName?.text ?? item.name.text,
        foreign: item.propertyName ?? null,
      });
  return rows;
}
function registerImport(
  node: ts.ImportDeclaration,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
  issues: string[],
) {
  const specifier = ts.isStringLiteralLike(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : "";
  const allowed = ELK_IMPORTS.get(specifier),
    rows = importRows(node);
  if (
    !allowed ||
    !rows.length ||
    (node.importClause?.namedBindings &&
      ts.isNamespaceImport(node.importClause.namedBindings))
  )
    elkIssue(issues, "forbidden ELK capability import bindings: " + specifier);
  for (const row of rows) {
    const rule = allowed?.find(
      (item) => item.imported === row.imported && item.local === row.local.text,
    );
    const symbol = checker.getSymbolAtLocation(row.local);
    const target =
      symbol && symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : undefined;
    if (
      !rule ||
      !symbol ||
      !target?.declarations?.length ||
      symbol.declarations?.length !== 1
    ) {
      elkIssue(
        issues,
        "forbidden ELK capability imported name: " + row.local.text,
      );
    } else {
      permissions.names.add(row.local);
      if (row.foreign) permissions.names.add(row.foreign);
      permissions.aliases.set(symbol, !rule.loaderOnly);
      permissions.targets.set(target, !rule.loaderOnly);
    }
  }
}
export function elkImports(
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  issues: string[],
) {
  const permissions: ElkPermissions = {
    names: new Set(),
    aliases: new Map(),
    targets: new Map(),
  };
  for (const statement of tree.statements)
    if (ts.isImportDeclaration(statement))
      registerImport(statement, checker, permissions, issues);
  return permissions;
}
