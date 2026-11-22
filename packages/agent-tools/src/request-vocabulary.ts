// Validator-owned closed literals. Help and programmatic discovery use these
// same values; field paths describe where each literal is accepted.
import type { AgentToolRequestBase } from "./common/contracts.js";
import type { ResolveObjectsRequest } from "./resolve.js";
import type { InspectObjectRequest } from "./inspect.js";
import type { ExecuteGraphQueryRequest } from "./query.js";
import type { CreateViewRequest } from "./create-view.js";
import type {
  ApplySourcePatchRequest,
  SourcePatchOperation,
} from "./source-patch-request.js";
import type { SourceMetadataRequest } from "./source-metadata.js";
import type { ObjectSelector, TerminalSelector } from "@thermite/query";

type Spec = CreateViewRequest["spec"];
type LegacySpec = Extract<Spec, { format: "schematic-view-request/0.1" }>;
type IntentSpec = Extract<Spec, { format: "schematic-view-request/0.2" }>;
const literals = <T extends string>(...values: T[]) => Object.freeze(values);
const formats = literals(
  "agent-tool-request/0.1",
) satisfies readonly AgentToolRequestBase["format"][];
const objects = literals(
  "uid",
  "designation",
) satisfies readonly ObjectSelector["by"][];
const includes = literals("source") satisfies NonNullable<
  SourceMetadataRequest["include"]
>;
export const AGENT_REQUEST_VOCABULARY = Object.freeze({
  resolve: Object.freeze({
    "/format": formats,
    "/target/by": literals(
      "uid",
      "designation",
      "type",
      "text",
    ) satisfies readonly ResolveObjectsRequest["target"]["by"][],
    "/include/*": includes,
  }),
  inspect: Object.freeze({
    "/format": formats,
    "/selector/by":
      objects satisfies readonly InspectObjectRequest["selector"]["by"][],
    "/include/*": includes,
  }),
  query: Object.freeze({
    "/format": formats,
    "/query/operation": literals(
      "neighbors",
      "trace",
      "cable",
      "net",
    ) satisfies readonly ExecuteGraphQueryRequest["query"]["operation"][],
    "/query/selector/by (neighbors, trace, cable)": objects,
    "/query/selector/by (net)": literals(
      "id",
      "parts",
      "display",
    ) satisfies readonly TerminalSelector["by"][],
  }),
  validate: Object.freeze({ "/format": formats }),
  "create-view": Object.freeze({
    "/format": formats,
    "/spec/format": literals(
      "schematic-view-request/0.1",
      "schematic-view-request/0.2",
    ) satisfies readonly Spec["format"][],
    "/spec/family (0.1)": literals(
      "control",
      "power",
    ) satisfies readonly LegacySpec["family"][],
    "/spec/flow": literals(
      "left-to-right",
      "top-to-bottom",
    ) satisfies readonly NonNullable<Spec["flow"]>[],
    "/spec/root/by": objects,
    "/spec/intent/kind (0.2)": literals(
      "trace",
      "conductors",
      "loads",
    ) satisfies readonly IntentSpec["intent"]["kind"][],
    "/spec/intent/to/by (trace)": objects,
  }),
  "apply-source-patch": Object.freeze({
    "/format": formats,
    "/patchFormat": literals(
      "json-patch/0.1",
    ) satisfies readonly ApplySourcePatchRequest["patchFormat"][],
    "/files/*/operations/*/op": literals(
      "test",
      "add",
      "remove",
      "replace",
    ) satisfies readonly SourcePatchOperation["op"][],
  }),
});
