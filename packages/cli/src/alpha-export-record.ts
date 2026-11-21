import type { Diagnostic } from "@thermite/schema";
import type { DocumentationSelection } from "@thermite/query";
import { artifactIntent } from "./alpha-export-artifact.js";
import {
  isJsonObject,
  type InputFingerprint,
  type Producer,
} from "./alpha-export-input.js";
import { stableJson } from "./alpha-export-plan.js";

export const MANIFEST_FORMAT = "export-manifest/1";
export const RECEIPT_FORMAT = "export-receipt/1";

export interface ArtifactRecord {
  path: string;
  sha256: string;
  intent: ReturnType<typeof artifactIntent>;
  diagnostics?: readonly Diagnostic[];
  selection?: DocumentationSelection;
}
export interface ExportBinding {
  producer: Producer;
  source: InputFingerprint;
}

export interface BundleRecord extends ExportBinding {
  format: typeof MANIFEST_FORMAT;
  requestSha256: string;
  diagnostics: readonly Diagnostic[];
  artifacts: ArtifactRecord[];
  jobDiagnostics: { outputs: string[]; diagnostics: readonly Diagnostic[] }[];
}

export interface ReceiptRecord extends ExportBinding {
  format: typeof RECEIPT_FORMAT;
  artifact: ArtifactRecord;
}

export function equalJson(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

function record(value: unknown, keys: string[]) {
  if (!isJsonObject(value)) throw new Error("Invalid export metadata object.");
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error("Unknown field in export metadata.");
  return value;
}

function digest(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid export SHA-256 digest.");
  return value;
}

function binding(value: Record<string, unknown>): ExportBinding {
  const producer = record(value.producer, ["version", "build"]);
  const source = record(value.source, ["format", "sha256"]);
  if (
    typeof producer.version !== "string" ||
    !producer.version ||
    source.format !== "export-input/1"
  )
    throw new Error("Invalid export producer or source fingerprint.");
  return {
    producer: { version: producer.version, build: digest(producer.build) },
    source: { format: source.format, sha256: digest(source.sha256) },
  };
}

function readArtifact(value: unknown) {
  const item = record(value, [
    "path",
    "sha256",
    "intent",
    "diagnostics",
    "selection",
  ]);
  if (typeof item.path !== "string") throw new Error("Invalid artifact path.");
  return { path: item.path, sha256: digest(item.sha256), intent: item.intent };
}

export function readBundleRecord(value: unknown) {
  const item = record(value, [
    "format",
    "producer",
    "source",
    "requestSha256",
    "diagnostics",
    "artifacts",
    "jobDiagnostics",
  ]);
  if (
    item.format !== MANIFEST_FORMAT ||
    !Array.isArray(item.artifacts) ||
    !Array.isArray(item.diagnostics) ||
    !Array.isArray(item.jobDiagnostics)
  )
    throw new Error("Invalid bundle manifest format.");
  const artifacts = new Map<string, ReturnType<typeof readArtifact>>();
  for (const value of item.artifacts) {
    const artifact = readArtifact(value);
    if (artifacts.has(artifact.path))
      throw new Error("Duplicate artifact in manifest.");
    artifacts.set(artifact.path, artifact);
  }
  return {
    ...binding(item),
    requestSha256: digest(item.requestSha256),
    artifacts,
  };
}

export function readReceiptRecord(value: unknown) {
  const item = record(value, ["format", "producer", "source", "artifact"]);
  if (item.format !== RECEIPT_FORMAT)
    throw new Error("Invalid receipt format.");
  return { ...binding(item), artifact: readArtifact(item.artifact) };
}
