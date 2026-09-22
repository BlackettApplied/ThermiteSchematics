export {
  AJV_KEYWORD_TO_CODE,
  UnmappedAjvKeywordError,
  createAjv2020,
  diagnosticCodeForAjvKeyword,
  mapAjvErrors,
  validateJsonValue,
  type AjvDiagnosticContext,
  type MappedAjvKeyword,
} from "./ajv-validation.js";
export {
  DIAGNOSTIC_CATALOG,
  DIAGNOSTIC_CODES,
  isDiagnosticCode,
  type DiagnosticCatalogEntry,
  type DiagnosticCode,
  type DiagnosticProducer,
} from "./diagnostic-catalog.js";
export {
  compareDiagnostics,
  normalizeDiagnosticFile,
  normalizeDiagnostics,
  type Diagnostic,
  type RelatedDiagnosticLocation,
} from "./diagnostics.js";
export {
  validateProjectManifest,
  validateSourceDocument,
  validateUniqueUids,
  type ParsedDocument,
} from "./document-validation.js";
export {
  appendJsonPointer,
  escapeJsonPointerSegment,
  splitJsonPointer,
  unescapeJsonPointerSegment,
} from "./json-pointer.js";
export {
  offsetToPosition,
  parseJson,
  type JsonNodeLocation,
  type JsonPointerNode,
  type JsonPointerNodeMap,
  type JsonValue,
  type ParseJsonResult,
  type SourcePosition,
} from "./parser.js";
export {
  ENTITY_SCHEMA_NAMES,
  PROJECT_PRESENTATION_SINGLE_LINE_PATTERN,
  SUPPORTED_PROJECT_FORMATS,
  SchemaRegistry,
  createInMemoryCanonicalSchemaRegistry,
  isEntitySchemaName,
  loadCanonicalSchemas,
  loadSchemaRegistry,
  type EntitySchemaName,
  type EntityValidationContext,
  type LoadedSchema,
  type LoadSchemaRegistryOptions,
} from "./schema-registry.js";

export type {
  Cable,
  CableType,
  ChannelFunction,
  CoilFunction,
  ContactFunction,
  Device,
  DeviceFunction,
  DeviceType,
  Jumper,
  LibraryFile,
  LibraryLock,
  LibraryManifest,
  LoadFunction,
  MechanismFunction,
  OtherFunction,
  Potential,
  ProjectManifest,
  ProjectPresentationFile,
  Relation,
  SourceFile,
  SourceFunction,
  BusFunction,
  ValidatedDeviceType,
  Wire,
} from "./generated/index.js";
export type { LibraryType, ProjectObject } from "./source-types.js";
