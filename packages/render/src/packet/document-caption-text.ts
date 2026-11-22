import type {
  DocumentDependency,
  IssuedDocument,
  IssuedDocumentRow,
} from "./document-types.js";
import { destinationToken } from "./navigation-location.js";
import { printableTextMetrics } from "../text-metrics.js";
import { required } from "../presentation/util.js";

/** Atoms may contain authored spaces: an identity is never split into words. */
export function wrapDocumentTokens(
  tokens: readonly string[],
  width: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    if (printableTextMetrics(token, 2.5).advance > width)
      throw Error("Indivisible companion identity exceeds the caption width");
    const next = line ? `${line} ${token}` : token;
    if (line && printableTextMetrics(next, 2.5).advance > width) {
      lines.push(line);
      line = token;
    } else line = next;
  }
  return [...lines, line];
}
const suffix = (tokens: string[], value: string) => {
  tokens[tokens.length - 1] =
    required(tokens.at(-1), "Empty companion caption") + value;
};
function rowTokens(
  need: DocumentDependency,
  rows: readonly IssuedDocumentRow[],
): string[] {
  const names = [...new Set(rows.map((r) => r.displayName))];
  const tokens = names.map(
    (name, i) => name + (i + 1 < names.length ? "," : ")"),
  );
  if (need.need === "conductor-incidence")
    return [`(${need.subject};`, ...tokens];
  tokens[0] = "(" + required(tokens[0], "Empty resolved inventory rows");
  return tokens;
}
export function documentCaptionTokens(
  need: DocumentDependency,
  documents: readonly IssuedDocument[],
  standalone: boolean,
): string[] {
  const tokens = documentCaptionLead(need);
  if (standalone)
    return [
      ...tokens,
      "are",
      "outside",
      "this",
      "selected",
      "view;",
      "no",
      "companion",
      "inventory",
      "is",
      "included.",
      `(${need.subject})`,
    ];
  suffix(tokens, ":");
  for (const [index, resolution] of need.resolution.entries()) {
    const document = required(
      documents.find((d) => d.id === resolution.documentId),
      "Missing issued document",
    );
    const groups = new Map<string, IssuedDocumentRow[]>();
    for (const row of document.rows.filter((r) =>
      resolution.rows.includes(r.id),
    )) {
      const location = destinationToken(row),
        members = groups.get(location) ?? [];
      members.push(row);
      groups.set(location, members);
    }
    if (index) suffix(tokens, ";");
    if (need.need !== "connector-port-status")
      tokens.push(...document.label.split(" "));
    for (const [i, [location, rows]] of [...groups].entries()) {
      if (i) suffix(tokens, ";");
      tokens.push(location, ...rowTokens(need, rows));
    }
  }
  suffix(tokens, ".");
  return tokens;
}
export function documentCaptionLead(need: DocumentDependency): string[] {
  return need.need === "conductor-incidence"
    ? [`[+${need.count}]`, "other", "physical", "connections"]
    : need.need === "terminal-inventory"
      ? [String(need.count), "other", "terminals"]
      : need.subject.split(" ");
}
