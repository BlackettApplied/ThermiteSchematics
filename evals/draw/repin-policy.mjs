// Structural move proofs; these cannot establish the reviewer's intent.
import assert from "node:assert/strict";
export const moveError = (detail) =>
  `Cannot prove move (${detail}); review a no-credit superseded retirement with an observed successor or survivor.`;
export function cropClaimTracker(cropHashes) {
  const used = new Set();
  return (crop) => {
    assert(
      crop && typeof crop.path === "string" && crop.path.trim(),
      "Crop required: supply a non-empty file path and SHA-256",
    );
    assert(
      Object.keys(crop).every((k) =>
        ["path", "sha256", "headerPixels", "drawingSha256"].includes(k),
      ) &&
        crop.path.startsWith("evals/out/draw-samples/") &&
        !crop.path.split("/").includes("..") &&
        /^[a-f0-9]{64}$/.test(crop.sha256 ?? ""),
      "Crop required: record a retained non-empty crop path and SHA-256",
    );
    assert(
      cropHashes.get(crop.path) === crop.sha256,
      "Reviewed crop missing or hash mismatch",
    );
    assert(
      !used.has(crop.sha256),
      "Each new defect or text-changing move needs a distinct crop hash; PNG reuse is refused",
    );
    used.add(crop.sha256);
  };
}
const key = (scope, sheet = scope.sheet) =>
  JSON.stringify([scope.case, scope.medium, sheet]);
export function sheetRenameMap(files, specs) {
  const out = new Map();
  for (const file of files)
    for (const e of file.entries ?? [])
      if (e.action === "rename")
        assert(
          e.from?.scope?.case === e.to?.scope?.case &&
            e.from?.scope?.medium === e.to?.scope?.medium,
          moveError("case or medium changed"),
        );
  for (const file of files)
    for (const r of [
      ...(file.sheetRenames ?? []),
      ...(file.entries ?? [])
        .filter((e) => e.action === "rename")
        .flatMap((e) =>
          (e.pairs ?? [])
            .filter((p) => p.view)
            .map((p) => ({
              case: e.from?.scope?.case,
              medium: e.from?.scope?.medium,
              ...p.view,
            })),
        ),
    ]) {
      assert(
        r &&
          Object.keys(r).every((k) =>
            ["case", "medium", "from", "to"].includes(k),
          ),
        "Invalid sheet rename declaration",
      );
      assert(
        specs.some((s) => s.id === r.case) &&
          ["svg", "html", "pdf"].includes(r.medium) &&
          typeof r.from === "string" &&
          typeof r.to === "string" &&
          r.from &&
          r.to &&
          r.from !== r.to,
        "Invalid sheet rename declaration",
      );
      assert(
        viewKind(r.from) === viewKind(r.to),
        moveError("view kind changed in sheet rename"),
      );
      const k = key(r, r.from);
      assert(!out.has(k) || out.get(k) === r.to, "Conflicting sheet renames");
      out.set(k, r.to);
    }
  return out;
}
export const renamedScope = (scope, map) => ({
  ...scope,
  sheet: map.get(key(scope)) ?? scope.sheet,
});
const sameSheet = (a, b, map) =>
  a.sheet === b.sheet || map.get(key(a)) === b.sheet;
export function viewKind(view) {
  return (
    /^view:([^/]+)/.exec(view ?? "")?.[1] ??
    (view?.startsWith("sheet:") ? "physical-sheet" : view)
  );
}
export function sourceRow(locator, column) {
  if (typeof locator !== "string") return undefined;
  const h = /^header\/([^/]+)\/(.+)$/.exec(locator);
  if (h) return { kind: `header/${h[1]}`, row: `header/${h[1]}`, column: h[2] };
  const c = /^cell\/([^/]+)\/(.+)$/.exec(locator);
  if (c) {
    const tail = c[2];
    let end = -1;
    if (column !== undefined) {
      if (!tail.endsWith("/" + column)) return undefined;
      end = tail.length - column.length - 1;
    } else if (tail.startsWith("[")) {
      let depth = 0,
        quoted = false,
        escape = false;
      for (let i = 0; i < tail.length; i++) {
        const ch = tail[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (quoted && ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          quoted = !quoted;
          continue;
        }
        if (quoted) continue;
        if (ch === "[" || ch === "{") depth++;
        if (ch === "]" || ch === "}") depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    } else if (tail.indexOf("/") === tail.lastIndexOf("/"))
      end = tail.indexOf("/");
    if (end > 0 && tail[end] === "/" && tail.slice(end + 1)) {
      let row = tail.slice(0, end);
      if (row.startsWith("["))
        try {
          row = JSON.stringify(JSON.parse(row));
        } catch {
          return undefined;
        }
      return {
        kind: `cell/${c[1]}`,
        row: `cell/${c[1]}/${row}`,
        column: tail.slice(end + 1),
      };
    }
  }
  return { kind: locator.split("/")[0], row: locator };
}
export function proveMove(a, b, map, specs, columnMap) {
  const x = a.facts,
    y = b.facts;
  for (const field of ["case", "medium", "kind", "dq", "check", "flow"])
    assert(x[field] === y[field], moveError(`${field} changed`));
  assert(
    specs.some((s) => s.id === x.case),
    moveError("unknown case/flow"),
  );
  assert(viewKind(x.view) === viewKind(y.view), moveError("view changed"));
  assert(
    sameSheet(a.scope, b.scope, map),
    moveError("sheet scope has no declared rename"),
  );
  assert(
    sameSheet(
      { ...a.scope, sheet: x.view },
      { ...b.scope, sheet: y.view },
      map,
    ),
    moveError("view has no declared rename"),
  );
  if (a.physicalSheet !== b.physicalSheet)
    assert(
      sameSheet(
        { ...a.scope, sheet: `sheet:${a.physicalSheet}` },
        { ...b.scope, sheet: `sheet:${b.physicalSheet}` },
        map,
      ),
      moveError("physical sheet has no declared rename"),
    );
  const ar = sourceRow(x.sourceLocator, x.column),
    br = sourceRow(y.sourceLocator, y.column);
  assert(
    x.text === y.text ||
      (![ar?.kind, br?.kind].includes("class") &&
        ![x.sourceLocator, y.sourceLocator].some((s) =>
          s?.startsWith("font-pair/"),
        )),
    moveError("text-changing labels lack a semantic source locator"),
  );
  assert(
    ar && br && ar.kind === br.kind && ar.row === br.row,
    moveError("source row or locator kind changed"),
  );
  assert(
    ar.column === br.column ||
      (columnMap?.from === ar.column && columnMap?.to === br.column),
    moveError("column changed without a literal columnMap"),
  );
  return {
    case: x.case,
    flow: x.flow,
    medium: x.medium,
    locatorKind: ar.kind,
    sourceRow: ar.row,
    column: br.column,
    viewKind: viewKind(x.view),
    sheetRename:
      a.scope.sheet !== b.scope.sheet || a.physicalSheet !== b.physicalSheet,
  };
}
