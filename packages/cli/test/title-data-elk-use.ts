import ts from "typescript";
import { permittedExternalMember } from "./title-data-elk-globals.js";
import { deniedMemberNames } from "./title-data-elk-slots.js";
import { elkText } from "./title-data-elk-keys.js";
import { elkIssue } from "./title-data-elk-policy.js";
import type { ElkPermissions } from "./title-data-elk-imports.js";

interface MemberUse {
  key: string;
  symbol: ts.Symbol | undefined;
}
type Text = (node: ts.Expression | undefined) => string | undefined;
function keyOf(name: ts.PropertyName | ts.BindingName, text: Text) {
  return ts.isComputedPropertyName(name)
    ? text(name.expression)
    : ts.isIdentifier(name) ||
        ts.isStringLiteralLike(name) ||
        ts.isNumericLiteral(name)
      ? name.text
      : undefined;
}
function propertyUses(
  node: ts.Node,
  checker: ts.TypeChecker,
  text: Text,
): MemberUse[] {
  let uses: MemberUse[] = [];
  if (ts.isPropertyAccessExpression(node))
    uses = [
      { key: node.name.text, symbol: checker.getSymbolAtLocation(node.name) },
    ];
  if (ts.isElementAccessExpression(node)) {
    const key = text(node.argumentExpression);
    if (key !== undefined)
      uses = [
        {
          key,
          symbol: checker.getPropertyOfType(
            checker.getNonNullableType(
              checker.getTypeAtLocation(node.expression),
            ),
            key,
          ),
        },
      ];
  }
  return uses;
}
function bindingUses(
  node: ts.Node,
  checker: ts.TypeChecker,
  text: Text,
): MemberUse[] {
  let uses: MemberUse[] = [];
  if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    const type = checker.getNonNullableType(
      checker.getTypeAtLocation(node.parent),
    );
    const key = keyOf(node.propertyName ?? node.name, text);
    uses = node.dotDotDotToken
      ? checker
          .getPropertiesOfType(type)
          .map((symbol) => ({ key: symbol.name, symbol }))
      : key === undefined
        ? []
        : [{ key, symbol: checker.getPropertyOfType(type, key) }];
  }
  return uses;
}
interface PatternContext {
  checker: ts.TypeChecker;
  text: Text;
  uses: MemberUse[];
}
function objectPatternUses(
  node: ts.ObjectLiteralExpression,
  type: ts.Type | undefined,
  context: PatternContext,
) {
  const { checker, text, uses } = context;
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (type)
        uses.push(
          ...checker.getPropertiesOfType(type).map((symbol) => ({
            key: symbol.name,
            symbol,
          })),
        );
      patternUses(property.expression, type, context);
    } else if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property)
    ) {
      const key = keyOf(property.name, text);
      const symbol =
        key !== undefined && type
          ? checker.getPropertyOfType(type, key)
          : undefined;
      if (key !== undefined) uses.push({ key, symbol });
      if (ts.isPropertyAssignment(property))
        patternUses(
          property.initializer,
          symbol
            ? checker.getTypeOfSymbolAtLocation(symbol, property)
            : undefined,
          context,
        );
    }
  }
}
function arrayPatternUses(
  node: ts.ArrayLiteralExpression,
  type: ts.Type | undefined,
  context: PatternContext,
  offset: number,
) {
  const { checker } = context;
  node.elements.forEach((element, index) => {
    if (ts.isSpreadElement(element))
      // Keep tuple positions when a rest target itself contains a pattern.
      patternUses(element.expression, type, context, offset + index);
    else {
      const symbol = type
        ? checker.getPropertyOfType(type, String(offset + index))
        : undefined;
      const elementType = symbol
        ? checker.getTypeOfSymbolAtLocation(symbol, element)
        : type
          ? checker.getIndexTypeOfType(type, ts.IndexKind.Number)
          : undefined;
      patternUses(element, elementType, context);
    }
  });
}
function patternUses(
  node: ts.Expression,
  type: ts.Type | undefined,
  context: PatternContext,
  offset = 0,
) {
  if (ts.isParenthesizedExpression(node))
    patternUses(node.expression, type, context, offset);
  else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    // Either the supplied value or the default can supply the selected member.
    patternUses(node.left, type, context, offset);
    patternUses(
      node.left,
      context.checker.getTypeAtLocation(node.right),
      context,
    );
  } else {
    const source = type ? context.checker.getNonNullableType(type) : undefined;
    if (ts.isObjectLiteralExpression(node))
      objectPatternUses(node, source, context);
    if (ts.isArrayLiteralExpression(node))
      arrayPatternUses(node, source, context, offset);
  }
}
function assignmentUses(
  node: ts.Node,
  checker: ts.TypeChecker,
  text: Text,
): MemberUse[] {
  const context: PatternContext = { checker, text, uses: [] };
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  )
    patternUses(node.left, checker.getTypeAtLocation(node.right), context);
  if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    const pattern = node.initializer;
    if (
      ts.isObjectLiteralExpression(pattern) ||
      ts.isArrayLiteralExpression(pattern)
    )
      patternUses(
        pattern,
        ts.isForOfStatement(node)
          ? checker.getTypeOfAssignmentPattern(pattern)
          : checker.getStringType(),
        context,
      );
  }
  return context.uses;
}
// Local and merged declarations cannot acquire an external member's admission.
export function deniedMemberUse(
  key: string,
  symbol: ts.Symbol | undefined,
  denied: ReadonlySet<string>,
) {
  return denied.has(key) && !permittedExternalMember(symbol);
}
export function elkUseSiteAudit(
  tree: ts.SourceFile,
  checker: ts.TypeChecker,
  permissions: ElkPermissions,
  issues: string[],
) {
  const denied = deniedMemberNames(tree, checker, permissions),
    text = elkText(checker);
  return (node: ts.Node) => {
    const uses = [
      ...propertyUses(node, checker, text),
      ...bindingUses(node, checker, text),
      ...assignmentUses(node, checker, text),
    ];
    for (const { key, symbol } of uses)
      if (deniedMemberUse(key, symbol, denied))
        elkIssue(issues, "forbidden ELK denied member use: " + key);
  };
}
