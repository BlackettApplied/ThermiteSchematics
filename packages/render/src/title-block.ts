import {
  plannedTitleContext,
  headingCapacity,
} from "./internal/title-data/headings.js";
import { titlePresentationContext } from "./internal/title-data/frame-context.js";
import type { CompiledProjectPresentation } from "@thermite/compiler";

import type { InvalidRenderTextError } from "./errors.js";
import { THERMITE_SCHEMATICS_PRODUCT_VERSION } from "./product-version.js";
import { preflightNamedTitle } from "./render-text-context.js";
import {
  RENDERER_VERSION,
  type NormalizedSchematicView,
  type RenderOutcome,
  type RenderTextSource,
} from "./types.js";

const DEFAULT_PRESENTATION = Object.freeze({
  format: "project-presentation/0.1" as const,
  revision: "UNSPECIFIED",
  backgroundColor: "#ffffff",
  titleBlockLines: Object.freeze([] as string[]),
});

export interface SchematicTitleContext {
  readonly projectName: string;
  readonly titleCandidates?: readonly string[];
  readonly revision: string;
  readonly backgroundColor: string;
  readonly toolVersion: string;
  readonly lines: readonly RenderTextSource[];
}

function projectNameError(
  view: Readonly<NormalizedSchematicView>,
  reason: "empty-string" | "over-160-code-points",
): InvalidRenderTextError {
  return Object.freeze({
    code: "R005",
    message:
      reason === "empty-string"
        ? "Invalid render text: project project field project.name is empty."
        : "Invalid render text: project project field project.name exceeds 160 Unicode code points.",
    family: view.family,
    ownerKind: "project",
    ownerId: "project",
    field: "project.name",
    reason,
    root: view.root.designation,
  });
}

function viewIdentity(view: Readonly<NormalizedSchematicView>): string {
  if (view.format === "schematic-view/0.1") {
    return `${view.root.designation} | ${view.family}`;
  }
  if (view.intent === "trace") {
    return `${view.root.designation} -> ${view.target.designation} | ${view.family}/trace`;
  }
  return `${view.root.designation} | ${view.family}/${view.intent}`;
}

function titleSources(
  projectName: string,
  view: Readonly<NormalizedSchematicView>,
  resolved: Pick<CompiledProjectPresentation, "revision" | "titleBlockLines">,
): RenderTextSource[] {
  return [
    {
      ownerKind: "project",
      ownerId: "project",
      field: "title.project-line",
      value: `Project: ${projectName}`,
    },
    {
      ownerKind: "presentation",
      ownerId: "presentation",
      field: "title.revision-line",
      value: `Revision: ${resolved.revision}`,
    },
    {
      ownerKind: "view",
      ownerId: "normalized-view",
      field: "title.view-line",
      value: `View: ${viewIdentity(view)}`,
    },
    {
      ownerKind: "renderer",
      ownerId: RENDERER_VERSION,
      field: "title.tool-line",
      value: `Tool: Thermite Schematics ${THERMITE_SCHEMATICS_PRODUCT_VERSION} | ${RENDERER_VERSION}`,
    },
    ...resolved.titleBlockLines.map((value, index) => ({
      ownerKind: "presentation" as const,
      ownerId: `presentation.titleBlock.lines[${index}]`,
      field: "title.authored-line" as const,
      value,
    })),
  ];
}

export function prepareSchematicTitleContext(
  projectName: string,
  view: Readonly<NormalizedSchematicView>,
  presentation?: Readonly<CompiledProjectPresentation>,
): RenderOutcome<SchematicTitleContext> {
  if (projectName.length === 0 && !titlePresentationContext(presentation)) {
    return { ok: false, error: projectNameError(view, "empty-string") };
  }
  if (
    [...projectName].length > 160 &&
    !titlePresentationContext(presentation)
  ) {
    return {
      ok: false,
      error: projectNameError(view, "over-160-code-points"),
    };
  }

  const resolved = presentation ?? DEFAULT_PRESENTATION;
  const lines = titleSources(projectName, view, resolved);

  const planned = plannedTitleContext(
    {
      projectName,
      revision: resolved.revision,
      backgroundColor: resolved.backgroundColor,
      toolVersion: THERMITE_SCHEMATICS_PRODUCT_VERSION,
      lines,
    },
    presentation,
  );
  const capacity = headingCapacity(planned, presentation);
  if (capacity) return capacity;
  const preflight = preflightNamedTitle(view, planned.lines);
  if (!preflight.ok) return preflight;

  return {
    ok: true,
    value: Object.freeze({
      ...planned,
      lines: Object.freeze(planned.lines.map((line) => Object.freeze(line))),
    }),
  };
}
