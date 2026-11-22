import { join } from "node:path";
import { expect } from "vitest";
import type { Fence } from "./project-guide/guide-model.js";
import {
  ctx,
  editJson,
  freshProject,
  writeJson,
} from "./project-guide/harness.js";
import { topicExecution } from "../../../scripts/docs-example-evidence.mjs";

// The modeling examples share a project, but receipts follow the operation that
// actually uses each value. Neither parsing nor a successful batch earns one.
export async function executeModelingExamples(
  fences: readonly Fence[],
  execution: ReturnType<typeof topicExecution>,
  operations: {
    addObject: (project: string, value: unknown) => Promise<void>;
    validate: (project: string) => Promise<any>;
    executeJson: (id: string, value: any) => Promise<void>;
  },
) {
  const { addObject, validate, executeJson } = operations;
  const items = fences.map((fence) => ({
    fence,
    value: JSON.parse(fence.body),
  }));
  const take = (predicate: (value: any) => boolean) => {
    const item = items.find(({ value }) => predicate(value));
    expect(item, "Missing modeling example").toBeDefined();
    return item!;
  };
  const execute = (
    item: (typeof items)[number],
    work: () => Promise<unknown>,
  ) => execution.run(item.fence, work);
  const project = await freshProject("starter");
  const devices = items.filter(({ value }) => value.kind === "device");
  await execute(devices[0]!, () => addObject(project, devices[0]!.value));
  // The second device block is the same occurrence, with a location added.
  await execute(devices[1]!, async () => {
    await writeJson(join(project, "guide-object.json"), {
      objects: [devices[1]!.value],
    });
    await validate(project);
  });
  const endpoint = take((value) => value.device);
  const wires = items.filter(({ value }) => value.kind === "wire");
  for (const [index, wire] of wires.entries()) {
    const addWire = () => execute(wire, () => addObject(project, wire.value));
    if (index === 0)
      await execute(endpoint, async () => {
        expect(wire.value.endpoints).toContainEqual(endpoint.value);
        // Use the exact endpoint fragment in the wire sent to the compiler.
        wire.value.endpoints[
          wire.value.endpoints.findIndex(
            (e: any) =>
              e.device === endpoint.value.device &&
              e.terminal === endpoint.value.terminal,
          )
        ] = endpoint.value;
        await addWire();
      });
    else await addWire();
  }
  const assignment = take((value) => value.io);
  await execute(assignment, async () => {
    await editJson(join(project, "devices/equipment.json"), (file) =>
      Object.assign(
        file.objects.find((o: any) => o.designation === "PLC1"),
        assignment.value,
      ),
    );
    await validate(project);
  });
  const potential = take((value) => value.kind === "potential");
  await execute(potential, async () => {
    await editJson(join(project, "potentials/potentials.json"), (file) => {
      file.objects = file.objects.filter(
        (o: any) => o.name !== potential.value.name,
      );
      file.objects.push(potential.value);
    });
    await validate(project);
  });
  const presentation = take((value) => value.format);
  const result = await execute(presentation, async () => {
    await writeJson(join(project, "presentation.json"), presentation.value);
    return validate(project);
  });
  // Starter feed deferrals remain honest. The added coil/output net has no
  // authored potential, so I304 discloses that assessment limit.
  expect(
    result.diagnostics
      .filter((d: any) => d.code !== "I304")
      .map((d: any) => [d.code, d.uid]),
  ).toEqual(
    (await validate(ctx.pristine.starter)).diagnostics
      .filter((d: any) => d.code !== "I304")
      .map((d: any) => [d.code, d.uid]),
  );
  expect(
    result.diagnostics.filter((d: any) => d.code === "I304").length,
  ).toBeLessThanOrEqual(1);
  // Negative control reproduces the old contradictory spare/unused assignment.
  const old = structuredClone(assignment.value);
  old.io.channels.do0 = old.io.channels.do1;
  delete old.io.channels.do1;
  old.connectionReview.terminals["X2.0"] =
    old.connectionReview.terminals["X2.1"];
  delete old.connectionReview.terminals["X2.1"];
  await editJson(join(project, "devices/equipment.json"), (file) =>
    Object.assign(
      file.objects.find((o: any) => o.designation === "PLC1"),
      old,
    ),
  );
  expect(
    (await validate(project)).diagnostics.some(
      (d: any) => d.code === "W905" && d.message.includes("PLC1.X2.0"),
    ),
  ).toBe(true);
  for (const kind of ["cable", "relation"]) {
    const item = take((value) => value.kind === kind);
    await execute(item, () => executeJson("modeling", item.value));
  }
}
