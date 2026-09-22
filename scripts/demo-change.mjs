import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cp, readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(
  process.argv[2] ?? join(repo, "alpha-out", "machine-revision-b"),
);
try {
  await lstat(destination);
  throw new Error("Choose a new directory for the revision demonstration.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await cp(join(repo, "examples/machine-demo"), destination, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
const out = join(destination, "out");
await mkdir(out);
const cli = join(repo, "thermite.mjs");
const evidence = [];
const run = (args, input) => {
  const response = spawnSync(process.execPath, [cli, ...args], {
    cwd: repo,
    input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  evidence.push({
    command: args,
    exitCode: response.status,
    stdout: response.stdout,
    stderr: response.stderr,
  });
  writeFileSync(
    join(out, "agent-evidence.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  if (response.stderr) process.stderr.write(response.stderr);
  if (response.error || response.status !== 0)
    throw (
      response.error ??
      new Error(`Command failed (${response.status}): ${args.join(" ")}`)
    );
  return response;
};
function agent(tool, payload = {}) {
  const request = {
    format: "agent-tool-request/0.1",
    project: destination,
    ...payload,
  };
  // Parse and retain both streams independently, including success diagnostics.
  const response = run(
    ["agent", tool, "--input", "-"],
    JSON.stringify(request),
  );
  const result = JSON.parse(response.stdout),
    report = JSON.parse(response.stderr);
  evidence.push({ tool, request, result, report });
  return result;
}
agent("validate");
agent("resolve", { target: { by: "designation", value: "PLC1" } });
agent("inspect", { selector: { by: "designation", value: "W-FLD-001" } });
agent("inspect", { selector: { by: "designation", value: "PLC1" } });
agent("query", {
  query: {
    operation: "net",
    selector: { by: "parts", deviceDesignation: "LS1", terminalKey: "14" },
  },
});
run(["snapshot", "--project", destination, "-o", join(out, "before.json")]);
const paths = ["connections/wiring.json", "devices/equipment.json"];
const bytes = await Promise.all(
  paths.map((p) => readFile(join(destination, p))),
);
const sources = bytes.map((b) => JSON.parse(b.toString("utf8")));
const wireIndex = sources[0].objects.findIndex(
    (o) => o.designation === "W-FLD-001",
  ),
  plcIndex = sources[1].objects.findIndex((o) => o.designation === "PLC1");
const wire = sources[0].objects[wireIndex],
  plc = sources[1].objects[plcIndex];
const end = wire.endpoints.findIndex((e) => e.device === "PLC1");
if (
  wireIndex < 0 ||
  plcIndex < 0 ||
  end < 0 ||
  wire.endpoints[end].terminal !== "X10.7" ||
  plc.io.channels.di1.usage !== "spare"
)
  throw new Error("Demo source no longer matches the reviewed change.");
const files = [
  {
    path: paths[0],
    operations: [
      {
        op: "test",
        path: `/objects/${wireIndex}/endpoints/${end}/terminal`,
        value: "X10.7",
      },
      {
        op: "replace",
        path: `/objects/${wireIndex}/endpoints/${end}/terminal`,
        value: "X10.8",
      },
      {
        op: "replace",
        path: `/objects/${wireIndex}/properties/label`,
        value: "LS1-RETURN-PLC1-DI1",
      },
    ],
  },
  {
    path: paths[1],
    operations: [
      {
        op: "test",
        path: `/objects/${plcIndex}/io/channels/di1/usage`,
        value: "spare",
      },
      {
        op: "replace",
        path: `/objects/${plcIndex}/io/channels/di0`,
        value: { address: "I0.0", usage: "spare" },
      },
      {
        op: "replace",
        path: `/objects/${plcIndex}/io/channels/di1`,
        value: {
          address: "I0.1",
          usage: "in-use",
          signal: "Feed position LS1",
        },
      },
    ],
  },
].map((f, i) => ({
  ...f,
  expectedIntegrity:
    "sha256-" + createHash("sha256").update(bytes[i]).digest("base64"),
}));
const patch = { patchFormat: "json-patch/0.1", dryRun: true, files };
agent("apply-source-patch", patch);
for (let i = 0; i < paths.length; i++)
  if (!bytes[i].equals(await readFile(join(destination, paths[i]))))
    throw new Error("Dry run changed source bytes.");
agent("apply-source-patch", { ...patch, dryRun: false });
agent("validate");
agent("create-view", {
  spec: {
    format: "schematic-view-request/0.2",
    root: { by: "designation", value: "LS1" },
    intent: {
      kind: "trace",
      to: { by: "designation", value: "PLC1" },
      includePower: true,
    },
    flow: "left-to-right",
  },
});
run([
  "review",
  "--project",
  destination,
  "--before",
  join(out, "before.json"),
  "-o",
  join(out, "review.json"),
]);
run([
  "packet",
  "--project",
  destination,
  "--input",
  join(destination, "packet.request.json"),
  "-o",
  join(out, "revision-b.html"),
]);
run(["report", "io", "--project", destination, "-o", join(out, "io.csv")]);
await writeFile(
  join(out, "agent-evidence.json"),
  JSON.stringify(evidence, null, 2) + "\n",
);
process.stdout.write(
  `Created ${destination}\nMoved LS1 from PLC1 input I0.0 to I0.1 through a guarded dry run and apply.\nReview: ${join(out, "review.json")}\nPacket: ${join(out, "revision-b.html")}\n`,
);
