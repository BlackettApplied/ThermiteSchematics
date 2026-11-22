import ts from "typescript";
import { elkProgram, elkProgramStats } from "./title-data-elk-program.js";
import { elkImports } from "./title-data-elk-imports.js";
import { elkModule } from "./title-data-elk-modules.js";
import { elkGlobal } from "./title-data-elk-globals.js";
import { elkBindings } from "./title-data-elk-bindings.js";
import {
  elkConstructorAssertions,
  elkTypeAssertion,
} from "./title-data-elk-types.js";
import { elkAnnotation } from "./title-data-elk-annotations.js";
import { elkSlotAudit } from "./title-data-elk-slots.js";
import { elkUseSiteAudit } from "./title-data-elk-use.js";
import { elkKeys, elkText } from "./title-data-elk-keys.js";
import {
  elkStateDeclarations,
  elkStateReference,
  undefinedDeclaration,
} from "./title-data-elk-state.js";
import { insideElkLoader, elkIssue } from "./title-data-elk-policy.js";

let profile = {
  milliseconds: 0,
  programMilliseconds: 0,
  rootFiles: 1,
  sourceFiles: 0,
};
export const elkAllowlistStats = () => ({ ...profile });
// Static audit of one module, not a sandbox. Closed dependencies remain trusted;
// this does not verify their implementations or sandbox the hash-pinned loader.
export function auditElkAllowlist(
  source: ts.SourceFile,
  loader: ts.FunctionDeclaration | null,
  issues: string[],
) {
  const start = performance.now(),
    { tree, checker, program } = elkProgram(source);
  if (program.getSyntacticDiagnostics(tree).length)
    elkIssue(issues, "cannot parse ELK module");
  const text = elkText(checker),
    imports = elkImports(tree, checker, issues);
  const state = elkStateDeclarations(tree, issues);
  const assertions = elkConstructorAssertions(tree);
  const slots = elkSlotAudit(tree, checker, imports, issues);
  const members = elkUseSiteAudit(tree, checker, imports, issues);
  function visit(node: ts.Node) {
    undefinedDeclaration(node, issues);
    if (!insideElkLoader(node, loader)) {
      elkModule(node, text, issues);
      elkKeys(node, text, issues);
      elkStateReference(node, state, issues);
      elkGlobal(node, tree, checker, imports, text, issues);
      elkBindings(node, tree, checker, imports, text, issues);
      elkTypeAssertion(node, assertions, issues);
      elkAnnotation(node, tree, checker, imports, issues);
      slots(node);
      members(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const stats = elkProgramStats();
  profile = {
    milliseconds: performance.now() - start,
    programMilliseconds: stats.milliseconds,
    rootFiles: stats.rootFiles,
    sourceFiles: stats.sourceFiles,
  };
}
