import ts from "typescript";
import { readFileSync } from "node:fs";
import { visit } from "./render-diagnostic-semantic.mjs";

function declaredProbes(path) {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const titles = new Set();
  visit(file, (node) => {
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      /^(it|test)(\.|$)/u.test(node.expression.getText(file))
    )
      titles.add(node.arguments[0].text);
  });
  return titles;
}
/** Checklist categories are backed by named public probes, never per-site execution claims. */
export function validateScopePolicies(expected, actual) {
  const issues = [],
    cache = new Map();
  for (const site of [...actual.sites, ...actual.wrappers]) {
    const category = expected.policies[expected.scopes[site.path]?.category];
    if (!category) {
      issues.push(`Missing scope category for ${site.path}`);
      continue;
    }
    for (const code of site.codes ?? [])
      if (!category.probes.some((probe) => probe.codes.includes(code)))
        issues.push(`Missing ${code} public probe for ${site.path}`);
    for (const probe of category.probes) {
      if (!cache.has(probe.file))
        cache.set(probe.file, declaredProbes(probe.file));
      if (!cache.get(probe.file).has(probe.title))
        issues.push(
          `Missing executable public probe: ${probe.file}: ${probe.title}`,
        );
    }
  }
  return [...new Set(issues)];
}
