export {
  LAYOUT_CONFIG_VERSION,
  RENDERER_VERSION,
  SYMBOL_CATALOG_VERSION,
} from "./types.js";
export { createSchematicRenderer, renderSchematic } from "./renderer.js";
export {
  normalizePaperPage,
  printPacketHtml,
  renderSchematicPacket,
  renderSchematicSheets,
  type PageSettings,
  type PaperPage,
  type RenderedPacket,
  type RenderedSheet,
  type SchematicPacketRequest,
} from "./sheets.js";
export type {
  InvalidLayoutError,
  InvalidRenderTextError,
  InvalidViewRequestError,
  IncompletePathError,
  RenderError,
  RenderErrorBase,
  RenderErrorCode,
  RenderTextField,
  RenderTextOwnerKind,
  RenderTextReason,
  RequestedBooleanInput,
  RequestedFamilyInput,
  RequestedFlowInput,
  RequestedFormatInput,
  RequestedRootInput,
  RequestedIntentInput,
  RequestedStringInput,
  RuntimeInputType,
  UnsupportedSymbolMappingError,
} from "./errors.js";
export type {
  DemonstrationViewIntent,
  IntentSchematicViewRequest,
  LegacySchematicViewRequest,
  NormalizedIntentSchematicView,
  NormalizedLegacySchematicView,
  NormalizedSchematicView,
  RenderedSchematic,
  RenderFailure,
  RenderOutcome,
  RenderSummary,
  SchematicFlow,
  SchematicRenderer,
  SchematicViewFamily,
  SchematicViewRequest,
} from "./types.js";

export type { CommunicationViewRequest } from "./communication.js";
export type { ConnectorAssemblyViewRequest } from "./connector-assembly.js";
export type { SignalLoopViewRequest } from "./signal-loop.js";

export type { WiringViewRequest } from "./wiring.js";
export type {
  CircuitViewRequest,
  CircuitGroupRequest,
  CircuitFunctionSelector,
} from "./circuit.js";
