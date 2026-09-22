import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(root, "examples/machine-demo");
function run(args) {
  const result = spawnSync(
    process.execPath,
    [join(root, "thermite.mjs"), ...args],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Demo command failed (${result.status}): ${args.join(" ")}`,
    );
}
run(["validate", project]);
for (const output of [
  "alpha-out/machine-demo.html",
  "alpha-out/machine-demo.pdf",
])
  run([
    "packet",
    "--project",
    project,
    "--input",
    join(project, "packet.request.json"),
    "-o",
    join(root, output),
  ]);
for (const kind of ["io", "bom", "wires", "cables", "terminals"])
  run([
    "report",
    kind,
    "--project",
    project,
    "-o",
    join(root, "alpha-out", `machine-${kind}.csv`),
  ]);
