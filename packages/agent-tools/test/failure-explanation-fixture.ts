import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeFileIntegrity } from "@thermite/compiler";
import { expect } from "vitest";
import type { ApplySourcePatchRequest } from "../src/source-patch-request.js";
import { createPatchProjectFixture } from "./patch-project-fixture.js";

export function expectExplained(outcome: {
  ok: boolean;
  error?: unknown;
  diagnostics: readonly { severity: string; message: string }[];
}) {
  expect(outcome.ok).toBe(false);
  expect(
    outcome.error != null ||
      outcome.diagnostics.some(
        (d) => d.severity === "error" && d.message.trim().length > 0,
      ),
  ).toBe(true);
}

export async function failureExplanationFixture() {
  const fixture = await createPatchProjectFixture("repair");
  const file = "sources/objects.json",
    other = "sources/other.json";
  const source = JSON.parse(
    await readFile(join(fixture.projectRoot, file), "utf8"),
  );
  source.objects.pop();
  const second = source.objects.splice(2, 1)[0];
  source.objects[0].unexpected = true;
  await writeFile(
    join(fixture.projectRoot, file),
    JSON.stringify(source, null, 2),
  );
  await writeFile(
    join(fixture.projectRoot, other),
    JSON.stringify({ objects: [second] }),
  );
  const input: ApplySourcePatchRequest = {
    format: "agent-tool-request/0.1",
    project: fixture.projectRoot,
    patchFormat: "json-patch/0.1",
    dryRun: false,
    files: [
      {
        path: file,
        expectedIntegrity: computeFileIntegrity(
          await readFile(join(fixture.projectRoot, file)),
        ),
        operations: [
          { op: "test", path: "/objects/0/uid", value: source.objects[0].uid },
          { op: "remove", path: "/objects/0/unexpected" },
        ],
      },
      {
        path: other,
        expectedIntegrity: computeFileIntegrity(
          await readFile(join(fixture.projectRoot, other)),
        ),
        operations: [
          { op: "test", path: "/objects/0/uid", value: second.uid },
          {
            op: "add",
            path: "/objects/0/description",
            value: "second guarded write",
          },
        ],
      },
    ],
  };
  return { fixture, input };
}

export const fault = () =>
  Object.assign(new Error("injected"), { code: "EFAULT" });
export function failAt<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  nth: number,
  hit: () => void,
) {
  let calls = 0;
  return (...args: Args): Result => {
    if (++calls === nth) {
      hit();
      throw fault();
    }
    return fn(...args);
  };
}
