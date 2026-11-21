import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { consumerExecution } from "./platform.mjs";

export async function verifyDrawings({
  temporary,
  project,
  sourceCli,
  env,
  invoke,
  check,
}) {
  for (const extension of ["svg", "html", "pdf"]) {
    const output = join(project, `drawing.${extension}`);
    invoke(["view", "PS1", "--loads", "--project", project, "-o", output]);
    const first = await readFile(output);
    if (extension === "pdf") {
      assert.equal(first.subarray(0, 5).toString(), "%PDF-");
      assert.match(
        first.toString("latin1"),
        /\/BaseFont\s+\/[A-Z]{6}\+NotoSans-Regular\b/,
        "Embedded Noto Sans primary face for rooted view text",
      );
      assert.match(
        first.toString("latin1"),
        /\/FontFile2\s+\d+\s+0\s+R/,
        "Embedded TrueType font stream",
      );
    } else assert.match(first.toString(), /<svg/);
    const repeat = join(project, `repeat.${extension}`);
    invoke(["view", "PS1", "--loads", "--project", project, "-o", repeat]);
    assert.deepEqual(await readFile(repeat), first, `${extension} determinism`);
    if (sourceCli)
      await verifySourceDrawing(
        { sourceCli, temporary, env },
        project,
        extension,
        first,
      );
  }
  if (sourceCli)
    check("SVG/HTML/PDF byte parity with the isolated source build");
  invoke([
    "report",
    "bom",
    "--project",
    project,
    "-o",
    join(project, "bom.csv"),
  ]);
  JSON.parse(invoke(["diagnostics", "--project", project, "--json"]).stdout);
  check("deterministic SVG/HTML/PDF with embedded fonts; BOM and diagnostics");
}

async function verifySourceDrawing(
  { sourceCli, temporary, env },
  project,
  extension,
  first,
) {
  const sourceOutput = join(project, `source.${extension}`);
  // The reference build needs source access; consumer invocations above
  // keep the stricter repository-read denial throughout acceptance.
  const sourceExecution = consumerExecution();
  execFileSync(
    sourceExecution.command,
    [
      ...sourceExecution.prefix,
      sourceCli,
      "view",
      "PS1",
      "--loads",
      "--project",
      project,
      "-o",
      sourceOutput,
    ],
    { cwd: temporary, env, timeout: 120000 },
  );
  assert.deepEqual(
    await readFile(sourceOutput),
    first,
    `${extension} source/package parity`,
  );
}
