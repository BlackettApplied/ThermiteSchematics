// Hidden packet/titleData schemas; presentation structure belongs to schema.
import {
  string,
  nullable,
  object,
  key,
  pageSchema,
} from "#title-schema/schema";
export { presentationSchema } from "#title-schema/schema";
const row = object(
  {
    version: string(32),
    comment: string(160, 0),
    date: string(10),
    drawnBy: string(80),
  },
  ["version"],
);
const recordProperties = {
  values: {
    type: "object",
    propertyNames: key,
    additionalProperties: nullable(160),
  },
  sheetTitle: nullable(160),
  revision: nullable(128),
  revisionRows: { type: "array", maxItems: 6, items: row },
};
export const titleDataSchema = object({
  defaults: object({ ...recordProperties, drawingBase: nullable(128) }),
  byView: {
    type: "array",
    maxItems: 40,
    items: object(
      {
        ...recordProperties,
        viewIndex: { type: "integer", minimum: 1, maximum: 40 },
      },
      ["viewIndex"],
    ),
  },
  bySheet: {
    type: "array",
    maxItems: 100,
    items: object(
      {
        ...recordProperties,
        sheetKey: { type: "string", pattern: "^sheet/1/[0-9a-f]{64}$" },
      },
      ["sheetKey"],
    ),
  },
});
/** View selection is still owned by the existing strict per-view validators.
 * This schema validates the envelope/metadata; it does not replace dispatch. */
export const packetSchema = object(
  {
    format: { const: "schematic-packet-request/0.2" },
    page: pageSchema,
    views: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: { type: "object" },
    },
    layout: { enum: ["standard", "compact"] },
    index: { type: "boolean" },
    references: { type: ["object", "boolean"] },
    titleData: titleDataSchema,
  },
  ["format", "views"],
);
