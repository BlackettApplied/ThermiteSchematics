import ts from "typescript";
import { relative } from "node:path";
import {
  codeType,
  owner,
  renderCodes,
  siteCodes,
  visit,
  unresolved,
} from "./render-diagnostic-semantic.mjs";

const isClass = (node) =>
  node && (ts.isClassDeclaration(node) || ts.isClassExpression(node));
function classOf(checker, expression) {
  const declaration = checker
    .getTypeAtLocation(expression)
    .getSymbol()?.valueDeclaration;
  return isClass(declaration) ? declaration : undefined;
}
function classId(root, node) {
  const name =
    node.name?.text ??
    (ts.isVariableDeclaration(node.parent)
      ? node.parent.name.getText()
      : `<class@${node.pos}>`);
  return `${relative(root, node.getSourceFile().fileName).replaceAll("\\", "/")}:${name}`;
}
function memberName(checker, name) {
  if (!name) return undefined;
  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteral(name)
  )
    return name.text;
  if (ts.isComputedPropertyName(name)) {
    const type = checker.getTypeAtLocation(name.expression);
    if (type.isStringLiteral()) return type.value;
    if (type.flags & ts.TypeFlags.ESSymbolLike) return "<symbol>";
  }
}
function refuse(path, node, reason) {
  const line =
    node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line +
    1;
  throw Error(
    `unaudited class R-code site: ${path}:${line}: ${reason}. Use an inspectable data initializer or explicit constructor assignment; opaque constructor provenance is not inferred.`,
  );
}
function parameterCode(checker, member) {
  return (
    ts.isConstructorDeclaration(member) &&
    member.parameters.some(
      (p) =>
        memberName(checker, p.name) === "code" &&
        p.modifiers?.some((m) =>
          [
            ts.SyntaxKind.PublicKeyword,
            ts.SyntaxKind.PrivateKeyword,
            ts.SyntaxKind.ProtectedKeyword,
            ts.SyntaxKind.ReadonlyKeyword,
          ].includes(m.kind),
        ),
    )
  );
}
function classRecord(root, checker, path, node, additions) {
  const record = {
    node,
    path,
    id: classId(root, node),
    own: false,
    known: false,
    codes: new Set(),
    bases: [],
  };
  for (const clause of node.heritageClauses ?? [])
    if (clause.token === ts.SyntaxKind.ExtendsKeyword)
      for (const type of clause.types)
        record.bases.push(classOf(checker, type.expression));
  for (const member of node.members) {
    if (parameterCode(checker, member)) record.own = true;
    const name = memberName(checker, member.name);
    if (name !== "code") {
      if (
        name === undefined &&
        member.initializer &&
        renderCodes(checker.getTypeAtLocation(member.initializer)).length
      )
        refuse(path, member, "computed class-field name cannot be resolved");
      continue;
    }
    const isStatic = member.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.StaticKeyword,
    );
    if (
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      const type = checker.getTypeAtLocation(member);
      if (renderCodes(type).length || unresolved(type))
        refuse(
          path,
          member,
          "code accessor has no data-field construction evidence",
        );
      continue;
    }
    if (!ts.isPropertyDeclaration(member)) continue;
    if (!isStatic) record.own = true;
    if (!member.initializer) continue;
    const codes = siteCodes(checker, member, member.initializer, path);
    if (!isStatic) {
      record.known = true;
      for (const code of codes) record.codes.add(code);
    }
    if (codes.length)
      additions.push({
        node: member,
        path,
        owner: record.id.split(":").at(-1),
        kind: isStatic ? "class-static-field" : "class-field",
        class: record.id,
        codes,
      });
  }
  return record;
}
function constructorClass(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isConstructorDeclaration(parent)) return parent.parent;
    if (
      isClass(parent) ||
      (ts.isFunctionLike(parent) && !ts.isArrowFunction(parent))
    )
      return undefined;
  }
}
function collectWrites(records, checker) {
  for (const record of records.values())
    visit(record.node, (node) => {
      if (
        !ts.isBinaryExpression(node) ||
        node.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      )
        return;
      const left = node.left;
      if (
        !(
          ts.isPropertyAccessExpression(left) ||
          ts.isElementAccessExpression(left)
        ) ||
        left.expression.kind !== ts.SyntaxKind.ThisKeyword
      )
        return;
      const name = ts.isPropertyAccessExpression(left)
        ? left.name.text
        : checker.getTypeAtLocation(left.argumentExpression);
      if (constructorClass(node) !== record.node) return;
      if (
        name !== "code" &&
        !(name.isStringLiteral?.() && name.value === "code")
      ) {
        if (
          typeof name !== "string" &&
          !name.isStringLiteral?.() &&
          !(
            name.flags &
            (ts.TypeFlags.NumberLike | ts.TypeFlags.ESSymbolLike)
          ) &&
          renderCodes(checker.getTypeAtLocation(node.right)).length
        )
          refuse(
            record.path,
            node,
            "computed constructor-field name cannot be resolved",
          );
        return;
      }
      const codes = siteCodes(checker, left, node.right, record.path);
      record.own = true;
      record.known = true;
      for (const code of codes) record.codes.add(code);
    });
}
function evidence(records, node, seen = new Set()) {
  if (!node || seen.has(node)) return undefined;
  seen.add(node);
  const record = records.get(node);
  if (!record) return undefined;
  if (record.own) return record.known ? [...record.codes] : undefined;
  const inherited = record.bases.map((base) => evidence(records, base, seen));
  return inherited.every((codes) => codes !== undefined)
    ? [...new Set(inherited.flat())]
    : undefined;
}
/** Class fields are separate sites; only instance data can label a new expression. */
export function classSites(root, checker, files) {
  const records = new Map(),
    additions = [];
  for (const { path, file } of files)
    visit(file, (node) => {
      if (isClass(node))
        records.set(node, classRecord(root, checker, path, node, additions));
    });
  collectWrites(records, checker);
  for (const { path, file } of files)
    visit(file, (node) => {
      if (!ts.isNewExpression(node)) return;
      const instanceCode = codeType(checker, node);
      const declaration = classOf(checker, node.expression);
      const codes = evidence(records, declaration);
      if (!instanceCode && !codes?.length) return;
      if (codes === undefined) {
        if (renderCodes(instanceCode).length || unresolved(instanceCode))
          refuse(
            path,
            node,
            "new expression has unresolved class code production",
          );
        return;
      }
      if (codes.length)
        additions.push({
          node,
          path,
          owner: owner(node),
          kind: "class-new",
          class: classId(root, declaration),
          codes: [...codes].sort(),
        });
    });
  return additions;
}
