import type { QueryError } from "@thermite/query";
import type {
  NormalizedSchematicView,
  RenderError,
  RenderSummary,
  RenderedSchematic,
} from "@thermite/render";
import type { Diagnostic } from "@thermite/schema";

export interface RenderCommandJsonResult {
  readonly command: "render" | "view";
  readonly view: NormalizedSchematicView;
  readonly summary: RenderSummary;
  readonly artifact:
    | {
        readonly kind: "inline";
        readonly mediaType: "image/svg+xml";
        readonly svg: string;
      }
    | {
        readonly kind: "file";
        readonly mediaType: "image/svg+xml";
        readonly output: string;
        readonly written: true;
      };
}

export interface RenderCommandReport {
  readonly diagnostics: readonly Diagnostic[];
  readonly error: QueryError | RenderError | null;
}

export function serializeRenderCommandResult(
  command: RenderCommandJsonResult["command"],
  rendered: Readonly<RenderedSchematic>,
  output?: string,
): string {
  const result: RenderCommandJsonResult = {
    command,
    view: rendered.view,
    summary: rendered.summary,
    artifact:
      output === undefined
        ? {
            kind: "inline",
            mediaType: "image/svg+xml",
            svg: rendered.svg,
          }
        : {
            kind: "file",
            mediaType: "image/svg+xml",
            output,
            written: true,
          },
  };
  return `${JSON.stringify(result, undefined, 2)}\n`;
}

export function serializeRenderCommandReport(
  diagnostics: readonly Diagnostic[],
  error: QueryError | RenderError | null,
): string {
  const report: RenderCommandReport = { diagnostics, error };
  return `${JSON.stringify(report, undefined, 2)}\n`;
}
