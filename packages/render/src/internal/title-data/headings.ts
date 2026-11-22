import type { CompiledProjectPresentation } from "@thermite/compiler";
import type { SchematicTitleContext } from "../../title-block.js";
import { titlePresentationContext } from "./frame-context.js";
import { planningHeadings } from "./resolve.js";
import { failure } from "../../packet/errors.js";

export function headingValue(
  field: { label: string; value: string },
  defaultLabel: string,
) {
  return !field.value || field.label !== defaultLabel
    ? `${field.label}: ${field.value}`
    : field.value;
}
export function plannedTitleContext(
  title: SchematicTitleContext,
  presentation?: CompiledProjectPresentation,
): SchematicTitleContext {
  const context = titlePresentationContext(presentation);
  if (!context) return title;
  const view = title.lines.find((line) => line.field === "title.view-line");
  const headings = planningHeadings(
    context.presentation,
    context.request,
    context.viewIndex,
    title.projectName,
    view?.value ?? "",
  );
  const candidates = context.request.titleData?.bySheet
    ?.filter((r) => r.sheetTitle !== undefined)
    .map((r) =>
      headingValue(
        { label: headings.sheetTitle.label, value: r.sheetTitle ?? "" },
        "Sheet title",
      ),
    );
  return {
    ...title,
    projectName: headingValue(headings.project, "Project"),
    lines: title.lines.map((line) =>
      line.field === "title.view-line"
        ? { ...line, value: headingValue(headings.sheetTitle, "Sheet title") }
        : line,
    ),
    ...(candidates?.length
      ? { titleCandidates: Object.freeze(candidates) }
      : {}),
  };
}
export function headingCapacity(
  title: SchematicTitleContext,
  presentation?: CompiledProjectPresentation,
) {
  const context = titlePresentationContext(presentation);
  if (!context) return undefined;
  for (const [field, value] of [
    ["project", title.projectName],
    [
      "sheetTitle",
      title.lines.find((l) => l.field === "title.view-line")?.value ?? "",
    ],
  ]) {
    if (value !== undefined && [...value].length > 160)
      return failure(
        "unprintable-layout",
        `Sheet ${context.firstSheet ?? 1} field ${field} requires ${[...value].length} code points; 160 are available. Use a shorter supplied title or larger paper/profile.`,
        {
          field,
          sheet: context.firstSheet ?? 1,
          requiredCodePoints: [...value].length,
          availableCodePoints: 160,
        },
      );
  }
  return undefined;
}
