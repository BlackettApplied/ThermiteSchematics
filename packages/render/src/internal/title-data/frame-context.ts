import type { CompiledProjectPresentation } from "@thermite/compiler";
import type { PaperPage } from "../../packet/types.js";
import type { PacketRequest, Presentation, TitleSources } from "./model.js";
import { useCompactFrame } from "../../packet/frame-profile.js";

export interface TitleFrameContext {
  readonly presentation: Presentation;
  readonly request: PacketRequest;
  readonly sources?: TitleSources;
}
const contexts = new WeakMap<PaperPage, TitleFrameContext>();
/** A normalized page owns the selected frame and authored metadata. */
export function configureTitleFrame(
  page: PaperPage,
  context: TitleFrameContext,
) {
  useCompactFrame(page);
  contexts.set(page, context);
}
export function titleFrameContext(page: PaperPage) {
  return contexts.get(page);
}

interface AuthoredTitleContext extends TitleFrameContext {
  readonly viewIndex?: number;
  readonly firstSheet?: number;
}
type SourcePresentation = Readonly<CompiledProjectPresentation> | Presentation;
const presentations = new WeakMap<
  object,
  { context: AuthoredTitleContext; source: SourcePresentation }
>();
export function registerTitlePresentation(
  presentation: object,
  context: AuthoredTitleContext,
  source: SourcePresentation,
) {
  presentations.set(presentation, { context, source });
}
export function titlePresentationContext(presentation: object | undefined) {
  return presentation && presentations.get(presentation)?.context;
}
/** Resolve the compiled source even when rendering uses a compatibility copy. */
export function documentSourcePresentation(
  presentation: Readonly<CompiledProjectPresentation> | undefined,
) {
  return (
    presentation && (presentations.get(presentation)?.source ?? presentation)
  );
}
export function authoredTitlePresentation(
  presentation: Readonly<CompiledProjectPresentation> | undefined,
  page: PaperPage,
  viewIndex: number,
  firstSheet: number,
) {
  const context = titleFrameContext(page);
  if (!context || !presentation) return presentation;
  const authored = { ...presentation };
  registerTitlePresentation(
    authored,
    { ...context, viewIndex: viewIndex + 1, firstSheet },
    presentations.get(presentation)?.source ?? presentation,
  );
  return authored;
}

export function packetFrameMetadata(page: PaperPage) {
  return titleFrameContext(page)
    ? { presentationFormat: "project-presentation/0.3" as const }
    : {};
}
