import { runCli, type RunCliOptions } from "@thermite/cli";
import {
  createAjv2020,
  parseJson,
  type ProjectManifest,
} from "@thermite/schema";
import {
  createSchematicRenderer,
  type SchematicViewRequest,
} from "@thermite/render";
import type { ErrorObject } from "ajv";
import type { ELK } from "elkjs";
import type { ElkNode } from "elkjs/lib/elk-api.js";
import type { Node as JsonNode } from "jsonc-parser";

declare const elk: ELK;

const options: RunCliOptions = {};
const project: ProjectManifest = {
  format: "electrical-system/0.1",
  project: { name: "strict consumer" },
  sources: ["source.json"],
};
const request: SchematicViewRequest = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "PS1" },
  intent: { kind: "loads" },
};
const graph: ElkNode = { id: "strict-consumer" };
const errors: readonly ErrorObject[] = [];
const parsed: JsonNode | undefined = undefined;

void runCli;
void options;
void project;
void request;
void graph;
void elk.layout(graph);
void errors;
void parsed;
void createAjv2020();
void parseJson("{}", "strict-consumer.json");
void createSchematicRenderer();
