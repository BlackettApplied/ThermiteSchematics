import { hash } from "./support.mjs";
// New semantic rows must not rename earlier evidence on the same DQ/sheet.
export function sheetCropName(prefix, row, measured, htmlRow) {
  const duplicateMedium =
    measured.filter(
      (r) =>
        r.status === "fail" &&
        r.dq === row.dq &&
        (r.medium ?? "svg") === (row.medium ?? "svg") &&
        !!r.mechanism === !!row.mechanism,
    ).length > 1;
  return `${prefix}-${row.dq}${row === htmlRow ? "-html" : row.medium === "pdf" ? "-pdf" : ""}${row.mechanism || duplicateMedium ? "-" + hash(row.id).slice(0, 10) : ""}.png`;
}
