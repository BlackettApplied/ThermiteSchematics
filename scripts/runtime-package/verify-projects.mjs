import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyHelpRequests({ temporary, invoke, check }) {
  const project = join(temporary, "electrical project");
  invoke(["init", project, "--name", "Package acceptance"]);
  invoke(["init", project], undefined, 2);
  invoke(["validate", project]);
  for (const tool of ["inspect", "apply-source-patch"]) {
    const help = invoke(
      ["agent", tool, "--help"],
      undefined,
      0,
      project,
    ).stdout;
    const requests = [...help.matchAll(/```json\n([\s\S]*?)\n```/g)];
    assert(requests.length > 0);
    for (const [, request] of requests) {
      const result = invoke(
        ["agent", tool, "--input", "-"],
        request,
        0,
        project,
      );
      assert.equal(JSON.parse(result.stdout).tool, tool);
      assert.equal(JSON.parse(result.stderr).error, null);
    }
  }
  check(
    "printed help requests execute unchanged offline in a starter; repository reads denied on macOS",
  );
  return project;
}

export async function verifyTemplatesAndNotices({
  temporary,
  runtime,
  project,
  invoke,
  check,
}) {
  for (const notice of ["LICENSE", "NOTICE"])
    assert.deepEqual(
      await readFile(join(project, "libraries/core", notice)),
      await readFile(
        join(runtime, "node_modules/@thermite/core-library", notice),
      ),
    );
  const cabinets = join(temporary, "cabinet project");
  invoke(["init", cabinets, "--template", "cabinets"]);
  invoke(["validate", cabinets]);
  const cable = JSON.parse(
    invoke(["cable", "CBL1", "--project", cabinets, "--json"]).stdout,
  );
  assert.equal(cable.counts.spare, 2);
  check(
    "both templates, overwrite refusal, validation, library notices and cable query",
  );
}
