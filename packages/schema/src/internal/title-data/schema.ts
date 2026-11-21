import { IN_MEMORY_CANONICAL_SCHEMAS } from "../../generated/canonical-schemas.js";
// Shared packet schema helpers and the canonical compact presentation contract.
export const string = (maxLength: number, minLength = 1) => ({
  type: "string",
  minLength,
  maxLength,
});
export const nullable = (maxLength: number) => ({
  type: ["string", "null"],
  minLength: 1,
  maxLength,
});
export const object = (properties: object, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
export const pageSchema = object({
  size: { enum: ["letter", "tabloid", "a4", "a3"] },
  orientation: { enum: ["landscape", "portrait"] },
  marginMm: { type: "number", minimum: 5, maximum: 25 },
});
export const key = { pattern: "^[a-z][A-Za-z0-9_]{0,31}$" };
// The public canonical data owns the compact structural contract.
const canonical = IN_MEMORY_CANONICAL_SCHEMAS.find(
  (s) => s.fileName === "project-presentation.schema.json",
);
export const presentationSchema = {
  $ref: "#/$defs/compact",
  $defs: (canonical?.schema as { $defs: Record<string, object> }).$defs,
};
