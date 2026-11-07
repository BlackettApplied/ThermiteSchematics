import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as agentTools from "@thermite/agent-tools";
import { createAjv2020, DIAGNOSTIC_CATALOG } from "@thermite/schema";
import ts from "typescript";
import { validateResolveRequest } from "../../agent-tools/src/resolve.js";
import { validateInspectRequest } from "../../agent-tools/src/inspect.js";
import { validateGraphQueryRequest } from "../../agent-tools/src/query.js";
import { validateValidateProjectRequest } from "../../agent-tools/src/validate.js";
import { validateCreateViewRequest } from "../../agent-tools/src/create-view.js";
import { validateApplySourcePatchRequest } from "../../agent-tools/src/source-patch-request.js";
import {
  ctx,
  freshProject,
  ok,
  repositoryRoot,
  setUpSuite,
  tearDownSuite,
  thermite,
} from "./project-guide/harness.js";

beforeAll(setUpSuite);
afterAll(tearDownSuite);
const tools = Object.keys(agentTools.AGENT_REQUEST_VOCABULARY);
const helpOutputs = new Map<string, Promise<string>>();
function helpFor(tool: string) {
  if (!helpOutputs.has(tool))
    helpOutputs.set(
      tool,
      ok(["agent", tool, "--help"], ctx.work).then((r) => r.stdout),
    );
  return helpOutputs.get(tool)!;
}

it.each(tools)(
  "executes every printed %s help request unchanged",
  async (tool) => {
    const project = await freshProject("starter");
    const help = await helpFor(tool);
    const requests = [...help.matchAll(/```json\n([\s\S]*?)\n```/g)];
    expect(requests.length, help).toBeGreaterThan(0);
    const before = await readFile(join(project, "devices/equipment.json"));
    for (const [, request] of requests) {
      expect(JSON.parse(request!).project).toBe(".");
      const result = await ok(
        ["agent", tool, "--input", "-"],
        project,
        request,
      );
      expect(JSON.parse(result.stdout).tool).toBe(tool);
      expect(JSON.parse(result.stderr).error).toBeNull();
    }
    expect(await readFile(join(project, "devices/equipment.json"))).toEqual(
      before,
    );
  },
);

it("exports the exact validator catalogs through each tool's offline help", async () => {
  expect([...ctx.tree.tools.keys()].sort()).toEqual([...tools].sort());
  const vocabulary = agentTools.AGENT_REQUEST_VOCABULARY;
  expect(vocabulary).toBeDefined();
  for (const tool of tools) {
    const help = await helpFor(tool);
    const printed = JSON.parse(help.split("Accepted literals (JSON):\n")[1]!);
    expect(printed).toEqual(vocabulary[tool]);
  }
});

it("uses every exported literal set for validation and rejects values outside it", async () => {
  const validators: Record<string, (value: unknown) => any> = {
    resolve: validateResolveRequest,
    inspect: validateInspectRequest,
    query: validateGraphQueryRequest,
    validate: validateValidateProjectRequest,
    "create-view": validateCreateViewRequest,
    "apply-source-patch": validateApplySourcePatchRequest,
  };
  for (const tool of tools) {
    const help = await helpFor(tool);
    const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(help)![1]!);
    for (const [label, allowed] of Object.entries(
      (agentTools as any).AGENT_REQUEST_VOCABULARY[tool],
    ) as [string, string[]][]) {
      const base = structuredClone(example);
      const selector = { by: "designation", value: "PS1" };
      if (label.endsWith("(neighbors, trace, cable)"))
        base.query = { operation: "neighbors", selector };
      if (label.endsWith("(0.1)"))
        base.spec = {
          format: "schematic-view-request/0.1",
          family: "control",
          root: selector,
        };
      if (label.endsWith("(trace)"))
        base.spec.intent = { kind: "trace", to: selector, includePower: false };
      const field = label.replace(/ \(.*\)$/, "").replaceAll("*", "0");
      const tokens = field.slice(1).split("/");
      const requestWith = (value: string) => {
        const request = structuredClone(base);
        let parent = request;
        for (const token of tokens.slice(0, -1)) parent = parent[token];
        parent[tokens.at(-1)!] = value;
        return request;
      };
      const rejected = validators[tool]!(requestWith("__unsupported__"));
      expect(rejected, `${tool} ${label}`).toMatchObject({
        ok: false,
        error: {
          code: "A001",
          field,
          reason: "unsupported-value",
          allowed,
          allowedCount: allowed.length,
        },
      });
      for (const value of allowed) {
        const result = validators[tool]!(requestWith(value));
        // A different branch may require other fields (e.g. net vs neighbors),
        // but it must admit this literal at the advertised path.
        expect(
          !result.ok &&
            result.error.field === field &&
            result.error.reason === "unsupported-value",
          `${tool} ${label}: ${value}`,
        ).toBe(false);
      }
    }
  }
});

it("keeps validator literal sets in the exported catalog", async () => {
  async function sourceFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
      else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".d.ts")
      )
        files.push(path);
    }
    return files;
  }
  for (const file of await sourceFiles(
    join(repositoryRoot, "packages/agent-tools/src"),
  )) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isNewExpression(node.initializer) &&
        node.initializer.expression.getText(source) === "Set"
      ) {
        const values = node.initializer.arguments?.[0];
        // Field allowlists describe object structure, not closed enum values.
        if (
          !node.name.text.endsWith("_FIELDS") &&
          values &&
          ts.isArrayLiteralExpression(values)
        )
          expect.fail(
            `${file}: ${node.name.text} must come from AGENT_REQUEST_VOCABULARY`,
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

it("lists every shipped schema with its identifiers and serves its exact bytes", async () => {
  const directory = join(repositoryRoot, "packages/schema/schemas");
  const files = (await readdir(directory))
    .filter((f) => f.endsWith(".schema.json"))
    .sort();
  const list = JSON.parse(
    (await ok(["guide", "schema", "--json"], ctx.work)).stdout,
  );
  expect(list.map((s: any) => `${s.name}.schema.json`)).toEqual(files);
  const text = (await ok(["guide", "schema"], ctx.work)).stdout;
  const ajv = createAjv2020(); // Local registration only; no remote schema loader.
  for (const schema of list) {
    const bytes = await readFile(join(directory, `${schema.name}.schema.json`));
    const parsed = JSON.parse(bytes.toString());
    ajv.addSchema(parsed);
    expect(schema).toEqual({
      name: schema.name,
      path: join(directory, `${schema.name}.schema.json`),
      $id: parsed.$id,
      $schema: parsed.$schema,
    });
    expect(text).toContain(schema.name);
    expect(await readFile(schema.path)).toEqual(bytes);
    expect((await ok(["guide", "schema", schema.name], ctx.work)).stdout).toBe(
      bytes.toString(),
    );
    expect(
      JSON.parse(
        (await ok(["guide", "schema", schema.name, "--json"], ctx.work)).stdout,
      ),
    ).toEqual([schema]);
  }
  // Compiling every root resolves every shipped $ref without HTTP.
  for (const schema of list)
    expect(ajv.getSchema(schema.$id), schema.name).toBeTypeOf("function");
  const validate = (name: string, value: unknown) => {
    const check = ajv.getSchema(list.find((s: any) => s.name === name).$id)!;
    expect(check(value), JSON.stringify(check.errors)).toBe(true);
  };
  for (const template of ["starter", "cabinets"] as const) {
    const project = await freshProject(template);
    for (const file of [
      "devices/equipment.json",
      "connections/control-power.json",
      "potentials/potentials.json",
    ]) {
      const document = JSON.parse(await readFile(join(project, file), "utf8"));
      validate("source-file", document);
      for (const object of document.objects) validate(object.kind, object);
    }
    for (const file of await readdir(join(project, "libraries/core/types"))) {
      const document = JSON.parse(
        await readFile(join(project, "libraries/core/types", file), "utf8"),
      );
      for (const type of document.types)
        validate(type.kind.replaceAll("_", "-"), type);
    }
  }
  // Use the maintained, executed I/O + review example rather than inventing facts.
  const modeling = await readFile(
    join(repositoryRoot, "docs/data-model.md"),
    "utf8",
  );
  const assignment = [...modeling.matchAll(/```json\n([\s\S]*?)\n```/g)]
    .map((m) => JSON.parse(m[1]!))
    .find((v) => v.io);
  const equipment = JSON.parse(
    await readFile(
      join(await freshProject("starter"), "devices/equipment.json"),
      "utf8",
    ),
  );
  const plc = Object.assign(
    equipment.objects.find((o: any) => o.designation === "PLC1"),
    assignment,
  );
  validate("device", plc);
  plc.io.channels.do1.usage = "__unsupported__";
  expect(
    ajv.getSchema(list.find((s: any) => s.name === "device").$id)!(plc),
  ).toBe(false);
});

it.each(["../device", "toString", "missing"])(
  "rejects unknown schema %s without stdout",
  async (name) => {
    const result = await thermite(["guide", "schema", name], ctx.work);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
  },
);

it("explains the existing query nesting and non-cable conductor error", async () => {
  const project = await freshProject("starter");
  const help = (await ok(["agent", "query", "--help"], project)).stdout;
  expect(help).toContain("nested under query");
  const flat = await thermite(
    ["agent", "query", "--input", "-"],
    project,
    JSON.stringify({
      format: "agent-tool-request/0.1",
      project: ".",
      operation: "neighbors",
      selector: { by: "designation", value: "PS1" },
    }),
  );
  expect(flat.code).toBe(1);
  expect(JSON.parse(flat.stderr).error).toMatchObject({
    code: "A001",
    field: "/query",
  });
  const mismatch = await thermite(
    ["view", "PS1", "--conductors", "--json"],
    project,
  );
  expect(mismatch.code).toBe(1);
  expect(JSON.parse(mismatch.stderr).error.code).toBe("Q002");
  for (const code of [
    "R001",
    "R006",
    "Q001",
    "Q002",
    "Q003",
    "Q004",
    "A004",
    "T001",
    "I001",
    "I002",
    "I003",
  ]) {
    const entry = JSON.parse(
      (
        await ok(
          ["guide", "diagnostics", code.toLowerCase(), "--json"],
          project,
        )
      ).stdout,
    );
    expect(entry).toEqual({ [code]: (DIAGNOSTIC_CATALOG as any)[code] });
  }
});
