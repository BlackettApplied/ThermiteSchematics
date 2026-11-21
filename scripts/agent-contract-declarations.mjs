import ts from "typescript";

function removeAnnotations(text) {
  for (const name of ["SourceMetadataResult", "SourceAnnotated"]) {
    let start;
    while ((start = text.indexOf(`${name}<`)) !== -1) {
      let end = start + name.length + 1,
        depth = 1;
      const inner = end;
      while (end < text.length && depth) {
        if (text[end] === "<") depth++;
        if (text[end] === ">") depth--;
        end++;
      }
      if (depth) throw Error("Unbalanced annotation type");
      text =
        text.slice(0, start) + text.slice(inner, end - 1) + text.slice(end);
    }
  }
  return text;
}

/** Preserve raw wrapper definitions too: changing one cannot hide behind its name. */
export function declarationSnapshot(text) {
  const file = ts.createSourceFile(
    "contract.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const aliases = new Map(),
    result = {};
  for (const node of file.statements)
    if (ts.isImportDeclaration(node)) {
      for (const item of node.importClause?.namedBindings?.elements ?? [])
        aliases.set(item.name.text, item.propertyName?.text ?? item.name.text);
    }
  const canonical = (node) => {
    let value = node.getText(file).replace(/\s+/gu, "");
    for (const [alias, original] of aliases)
      value = value.replaceAll(new RegExp(`\\b${alias}\\b`, "gu"), original);
    return removeAnnotations(value);
  };
  for (const node of file.statements) {
    if (
      ts.isExportDeclaration(node) &&
      node.isTypeOnly &&
      node.exportClause?.elements
    )
      for (const item of node.exportClause.elements)
        result[item.name.text] = {
          alias: item.propertyName?.text ?? item.name.text,
        };
    if (!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      continue;
    if (ts.isInterfaceDeclaration(node))
      result[node.name.text] = {
        fields: Object.fromEntries(
          node.members.map((member) => [
            member.name?.getText(file),
            {
              optional: !!member.questionToken,
              type: canonical(member.type ?? member),
            },
          ]),
        ),
        heritage: (node.heritageClauses ?? [])
          .flatMap((h) => h.types.map(canonical))
          .sort(),
      };
    if (ts.isTypeAliasDeclaration(node))
      result[node.name.text] = {
        alias: canonical(node.type),
        branches: (ts.isUnionTypeNode(node.type)
          ? node.type.types
          : [node.type]
        )
          .map(canonical)
          .sort(),
        ...(["SourceAnnotated", "SourceMetadataResult"].includes(node.name.text)
          ? {
              annotationDefinition: node.type
                .getText(file)
                .replace(/\s+/gu, ""),
            }
          : {}),
      };
  }
  return result;
}

export function compareDeclarations(before, after, publicNames) {
  const old = declarationSnapshot(before),
    next = declarationSnapshot(after),
    changes = [];
  if (publicNames)
    for (const snapshot of [old, next])
      for (const name of Object.keys(snapshot))
        if (!publicNames.has(name)) delete snapshot[name];
  for (const [name, value] of Object.entries(old)) {
    const current = next[name];
    if (!current) {
      changes.push({ classification: "removal", path: `/${name}` });
      continue;
    }
    if (value.alias !== undefined) {
      const a = value.branches ?? [value.alias],
        b = current.branches ?? (current.alias ? [current.alias] : []);
      if (
        value.alias !== current.alias &&
        a.some((branch) => !b.includes(branch))
      )
        changes.push({
          classification: "type-change",
          path: `/${name}`,
          before: value.alias,
          after: current.alias,
        });
      else if (
        value.alias !== current.alias &&
        JSON.stringify(a) !== JSON.stringify(b)
      )
        changes.push({ classification: "additive", path: `/${name}` });
      if (value.annotationDefinition !== current.annotationDefinition)
        changes.push({
          classification: "meaning-change",
          path: `/${name}/annotationDefinition`,
        });
    } else compareInterface(name, value, current, changes);
  }
  for (const name of Object.keys(next))
    if (!(name in old))
      changes.push({ classification: "additive", path: `/${name}` });
  return changes;
}

export function publicDeclarations(index, path) {
  const file = ts.createSourceFile(
      "index.ts",
      index,
      ts.ScriptTarget.Latest,
      true,
    ),
    names = [];
  for (const node of file.statements) {
    if (
      !ts.isExportDeclaration(node) ||
      !node.moduleSpecifier ||
      !node.exportClause?.elements
    )
      continue;
    const module = `packages/agent-tools/src/${node.moduleSpecifier.text.replace(/^\.\//u, "").replace(/\.js$/u, ".ts")}`;
    if (module === path)
      for (const item of node.exportClause.elements)
        names.push(item.propertyName?.text ?? item.name.text);
  }
  return names;
}

function compareInterface(name, before, after, changes) {
  if (!after.fields) {
    changes.push({ classification: "type-change", path: `/${name}` });
    return;
  }
  for (const [field, value] of Object.entries(before.fields)) {
    const next = after.fields[field],
      path = `/${name}/${field}`;
    if (!next) changes.push({ classification: "removal", path });
    else if (value.type !== next.type || value.optional !== next.optional) {
      const widened =
        value.optional === next.optional && unionWidened(value.type, next.type);
      changes.push({
        classification: widened ? "additive" : "type-change",
        path,
        before: value,
        after: next,
      });
    }
  }
  for (const field of Object.keys(after.fields))
    if (!(field in before.fields))
      changes.push({
        classification:
          /Request$/u.test(name) && !after.fields[field].optional
            ? "meaning-change"
            : "additive",
        path: `/${name}/${field}`,
      });
  for (const parent of before.heritage)
    if (!after.heritage.includes(parent))
      changes.push({
        classification: "removal",
        path: `/${name}/extends/${parent}`,
      });
  for (const parent of after.heritage)
    if (!before.heritage.includes(parent))
      changes.push({
        classification:
          parent === "SourceMetadataRequest" ? "additive" : "meaning-change",
        path: `/${name}/extends/${parent}`,
      });
}

/** Widening a literal union retains all old values; formatting is immaterial. */
function unionWidened(before, after) {
  const branches = (text) => {
    const file = ts.createSourceFile(
      "field.ts",
      `type Field = ${text}`,
      ts.ScriptTarget.Latest,
      true,
    );
    const node = file.statements[0]?.type;
    if (!node) return undefined;
    const parts = ts.isUnionTypeNode(node) ? node.types : [node];
    if (
      !parts.every(
        (part) =>
          ts.isLiteralTypeNode(part) && ts.isStringLiteral(part.literal),
      )
    )
      return undefined;
    return parts.map((part) => part.literal.text);
  };
  const old = branches(before),
    next = branches(after);
  return old && next && old.every((part) => next.includes(part));
}
