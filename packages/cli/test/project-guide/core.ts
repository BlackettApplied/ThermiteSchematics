// Facts for the guide's setup, agent-tool, reservation, printing, cable-command
// and report-filter sentences.
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  cp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import {
  agent,
  agentHere,
  codesOf,
  ctx,
  describeRun,
  editJson,
  entry,
  freshProject,
  hashTree,
  integrity,
  lockAndValidate,
  makeProject,
  ok,
  once,
  packet,
  parallel,
  patchRequest,
  readJson,
  rejected,
  repositoryRoot,
  request,
  scratch,
  sharedProject,
  thermite,
  writeJson,
  type FactModule,
} from "./harness.js";

import { guardedWorkflows, wire } from "./guarded-workflows.js";

const RESERVATION = ".thermite-schematics-write.lock";
/** Engine fixtures and shared case tables, loaded once a check needs them. */
const engine = () => import("./engine-cases.js");
const WIRES = "connections/control-power.json";
/** A packet with one schematic and one documentation view on the starter. */
const STARTER_PACKET = {
  format: "schematic-packet-request/0.1",
  index: true,
  views: [
    {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "PS1" },
      intent: { kind: "loads" },
    },
    { format: "documentation-view-request/0.1", kind: "bom" },
  ],
};
const EQUIPMENT = "devices/equipment.json";
const PLC_TEST = [
  { op: "test", path: "/objects/1/designation", value: "PLC1" },
];
const LOADS_SPEC = {
  format: "schematic-view-request/0.2",
  root: { by: "designation", value: "PS1" },
  intent: { kind: "loads" },
};

// Read-only runs that several facts share. Dry runs and reads never write in
// the pristine projects (the harness checks dry runs; the suite checks the
// pristine trees at the end), and staging happens beside the project root.
const plcInspect = () =>
  once("core:inspect PLC1", () =>
    agent(
      "inspect",
      request({ selector: { by: "designation", value: "PLC1" } }),
      ctx.pristine.starter,
    ),
  );
const inspectPlc = async () => (await plcInspect()).result.value.object;
const agentValidate = () =>
  once("core:agent validate", () =>
    agent("validate", request({}), ctx.pristine.starter),
  );
const createViewLoads = () =>
  once("core:create-view loads", () =>
    agent("create-view", request({ spec: LOADS_SPEC }), ctx.pristine.starter),
  );
const netPlcX20 = () =>
  once("core:net PLC1.X2.0", () =>
    query(ctx.pristine.starter, "net", { by: "display", value: "PLC1.X2.0" }),
  );

// View roots. A `site` library clones core types under new type IDs with the
// same `symbol` and functions; projects using it are locked, with missing-required/deferred warnings retained.
const SITE = { name: "site", version: "0.1.0", path: "site" };
/** [core device, its clone, core type]: one pair per root the sentences name. */
const ROOT_CLONES = [
  ["M1", "M2", "motor-3ph"],
  ["K1", "K2", "contactor-3p-1no"],
  ["PS2", "PS3", "psu-24vdc"],
  ["LS1", "LS2", "limit-switch-2wire"],
  ["B1", "B2", "prox-pnp-3wire"],
] as const;
/** Every core device type, keyed by file name. */
async function coreDeviceTypes(): Promise<Map<string, any>> {
  const dir = join(ctx.pristine.starter, "libraries/core/types");
  const types = new Map<string, any>();
  for (const file of await readdir(dir))
    for (const type of (await readJson(join(dir, file))).types)
      if (type.kind === "device_type")
        types.set(file.replace(/\.json$/, ""), type);
  return types;
}
async function addSiteTypes(project: string, types: readonly object[]) {
  await writeJson(join(project, "site/library.json"), {
    name: SITE.name,
    version: SITE.version,
    sources: ["types/*.json"],
  });
  await writeJson(join(project, "site/types/clones.json"), { types });
  await editJson(join(project, "system.json"), (manifest) =>
    manifest.libraries.push(SITE),
  );
}
/**
 * The starter plus an unwired device of every core device type it lacks, each
 * ROOT_CLONES pair, and two switch-like site types: one NC contact under the
 * switch symbol (LS3), and the limit switch's NO contact under the pushbutton
 * symbol (LS4).
 */
export const viewRoots = () =>
  sharedProject("core:view-roots", async (project) => {
    await cp(ctx.pristine.starter, project, { recursive: true });
    const core = await coreDeviceTypes();
    const limit = core.get("limit-switch-2wire");
    await addSiteTypes(project, [
      ...ROOT_CLONES.map(([, , name]) => ({
        ...core.get(name),
        id: `site:${name}`,
      })),
      {
        ...limit,
        id: "site:switch-nc",
        description: "Two-wire limit switch with one normally closed contact",
        functions: {
          contact13: { ...limit.functions.contact13, normal_state: "closed" },
        },
        symbol: "thermite:switch",
      },
      { ...limit, id: "site:switch-pushbutton", symbol: "thermite:pushbutton" },
    ]);
    await editJson(join(project, EQUIPMENT), (file) => {
      const add = (designation: string, type: string) =>
        file.objects.push({
          uid: randomUUID(),
          kind: "device",
          designation,
          type,
        });
      for (const [original, clone, name] of ROOT_CLONES) {
        add(original, `core:${name}`);
        add(clone, `site:${name}`);
      }
      add("LS3", "site:switch-nc");
      add("LS4", "site:switch-pushbutton");
      const present = new Set(file.objects.map((o: any) => o.type));
      let n = 0;
      for (const type of core.values())
        if (!present.has(type.id)) add(`X${(n += 1)}`, type.id);
    });
    await ok(["lock", "."], project);
    await ok(["validate", "."], project);
    await assertCloneWarnings(project);
  });
/** The clone fixtures deliberately retain required/deferred work. */
export async function assertCloneWarnings(
  project: string,
  codes = ["W903", "W905"],
) {
  const args = ["validate", ".", "--strict", "--json"];
  const run = await thermite(args, project);
  expect(run.code, describeRun(args, run)).toBe(1);
  expect(run.stderr).toBe("");
  const diagnostics = JSON.parse(run.stdout) as { code: string }[];
  expect([...new Set(diagnostics.map((d) => d.code))].sort()).toEqual(codes);
  return run;
}
/** The starter with PS1 and PLC1 retyped to site clones of their core types. */
const clonedStarter = () =>
  sharedProject("core:cloned-starter", async (project) => {
    await cp(ctx.pristine.starter, project, { recursive: true });
    const core = await coreDeviceTypes();
    await addSiteTypes(
      project,
      ["psu-24vdc", "plc-compact"].map((name) => ({
        ...core.get(name),
        id: `site:${name}`,
      })),
    );
    await editJson(join(project, EQUIPMENT), (file) => {
      for (const object of file.objects)
        if (["PS1", "PLC1"].includes(object.designation))
          object.type = object.type.replace(/^core:/, "site:");
    });
    await ok(["lock", "."], project);
    await ok(["validate", "."], project);
    await assertCloneWarnings(project, ["W905"]);
  });
/** The request `thermite view <root> <mode>` renders, as a one-view packet. */
function viewPacket(root: string, mode: string) {
  const [flag, to, include] = mode.split(" ");
  const selector = { by: "designation", value: root };
  const flow = "left-to-right";
  const view =
    flag === "--power" || flag === "--actuation"
      ? {
          format: "schematic-view-request/0.1",
          root: selector,
          family: flag === "--power" ? "power" : "control",
          flow,
        }
      : {
          format: "schematic-view-request/0.2",
          root: selector,
          flow,
          intent:
            flag === "--to"
              ? {
                  kind: "trace",
                  to: { by: "designation", value: to },
                  includePower: include === "--include-power",
                }
              : { kind: flag!.slice(2) },
        };
  return { format: "schematic-packet-request/0.1", views: [view] };
}
/** A render's outcome: "rendered", or its error code and message. */
async function viewHere(project: string, root: string, mode: string) {
  const { renderHere } = await engine();
  const result = await renderHere(project, viewPacket(root, mode));
  return result.ok
    ? { code: "rendered", message: "" }
    : { code: result.error.code, message: result.error.message };
}
/**
 * A live owner's reservation refusing an apply, beside a dry run that ignores
 * it. The reservation fact then releases this project; the redaction fact
 * only reads the reports.
 */
const aliveContention = () =>
  once("core:A005 alive", async () => {
    const project = await realpath(await freshProject("starter"));
    const lockPath = join(project, RESERVATION);
    const owner = {
      pid: process.pid,
      hostname: hostname(),
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      thermiteVersion: "9.9.9",
    };
    await writeFile(lockPath, JSON.stringify(owner));
    const before = await hashTree(project);
    const dry = await agent(
      "apply-source-patch",
      await patchRequest(project, EQUIPMENT, PLC_TEST),
      project,
    );
    const apply = await agent(
      "apply-source-patch",
      await patchRequest(project, EQUIPMENT, PLC_TEST, false),
      project,
    );
    return {
      project,
      lockPath,
      owner,
      before,
      dry,
      apply,
      after: await hashTree(project),
    };
  });
const query = (project: string, operation: string, selector: unknown) =>
  agent("query", request({ query: { operation, selector } }), project);
/** PDF page boxes in points, from the uncompressed page dictionaries. */
const mediaBoxes = (pdf: string) =>
  [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
const PAPER_MM: Record<string, readonly [number, number]> = {
  letter: [215.9, 279.4],
  tabloid: [279.4, 431.8],
  a4: [210, 297],
  a3: [297, 420],
};

const module: FactModule = {
  facts: [
    {
      claim:
        "Here `thermite` means `bun <thermite>/thermite.mjs`; use one runtime/source folder's absolute path (ask if unknown), separate from this project. No `thermite` is on PATH.",
      async check() {
        // Every run in this suite is `bun <checkout>/thermite.mjs <command>`;
        // the setup parsed this tree from the root `--help`.
        expect(ctx.tree.root.usage).toMatch(/^thermite /);
        expect(entry).toBe(join(repositoryRoot, "thermite.mjs"));
      },
    },
    {
      claim: "This TypeScript + ELK alpha uses Bun 1.4.2.",
      async check() {
        const pinned = (await readJson(join(repositoryRoot, "package.json")))
          .packageManager;
        expect(pinned).toBe("bun@1.4.2");
      },
    },
    {
      claim:
        "Include the use case, expected and actual behavior, a minimal reproduction, relevant diagnostics, Thermite/Bun versions and operating system; redact hostnames and absolute paths from A005/W801 diagnostics.",
      async check() {
        // Why redaction is needed: these reports carry this machine's host
        // name and absolute paths.
        const { lockPath, apply } = await aliveContention();
        expect(apply.report.error).toMatchObject({
          code: "A005",
          lockPath,
          owner: { hostname: hostname() },
        });
        expect(apply.report.error.message).toContain(JSON.stringify(lockPath));
        // So does W801, from a commit whose release fails.
        const { run, lockPath: released } = await (
          await engine()
        ).releaseFailure();
        expect(
          run.report.diagnostics.find(
            (d: { code: string }) => d.code === "W801",
          )?.message,
        ).toContain(JSON.stringify(released));
      },
    },
    {
      claim: "`init` needs a new directory.",
      async check() {
        // `pristine/starter` already exists.
        await rejected(
          ["init", "starter"],
          join(ctx.work, "pristine"),
          "T001",
          "requires a new directory",
          2,
        );
      },
    },
    {
      claim: "`--name` sets `project.name`, the title-block heading.",
      async check() {
        const parent = await scratch("named");
        await ok(["init", "p", "--name", "Conveyor 1"], parent);
        const project = join(parent, "p");
        expect(
          (await readJson(join(project, "system.json"))).project.name,
        ).toBe("Conveyor 1");
        await ok(["view", "PS1", "--loads", "-o", "loads.svg"], project);
        const svg = await readFile(join(project, "loads.svg"), "utf8");
        expect(svg).toContain("Conveyor 1");
        expect(svg).not.toContain("Starter project");
      },
    },
    {
      claim:
        "The six stateless tools run as `thermite agent <tool> --input <file|->`.",
      async check() {
        expect(ctx.tree.tools.size).toBe(6);
        for (const [name, spec] of ctx.tree.tools)
          expect(
            spec.options.some((o) => o.flags.includes("--input")),
            name,
          ).toBe(true);
        const file = join(await scratch("validate"), "validate.json");
        await writeJson(file, request({}));
        await ok(["agent", "validate", "--input", file], ctx.pristine.starter);
        expect((await agentValidate()).code, "--input -").toBe(0);
      },
    },
    {
      claim:
        "Exit 0 means success, 1 an authored/expected failure, and 2 usage or infrastructure failure.",
      async check() {
        const project = ctx.pristine.starter;
        expect((await agentValidate()).code).toBe(0);
        const authored = await thermite(
          ["agent", "inspect", "--input", "-"],
          project,
          "{",
        );
        expect(authored.code).toBe(1);
        const missing = await thermite(
          ["agent", "inspect", "--input", join(ctx.work, "missing.json")],
          project,
        );
        expect(missing.code).toBe(2);
      },
    },
    {
      claim:
        '`validate`: no other fields. - `resolve`: `target: {by: "uid"|"designation"|"type"|"text", value}`. - `inspect`: `selector: {by: "uid"|"designation", value}`. - `query`: `query: {operation: "neighbors"|"trace"|"cable", selector: {by: "uid"|"designation", value}}`, or `query: {operation: "net", selector: {by: "display", value: "PS1.+"}}`.',
      async check() {
        const starter = ctx.pristine.starter;
        const extra = await agent(
          "validate",
          request({ selector: { by: "designation", value: "PLC1" } }),
          starter,
        );
        expect(extra.report.error).toMatchObject({
          code: "A001",
          field: "/selector",
          reason: "additional-property",
        });
        // One run per tool and selector form; the engine tests pin the rest
        // of each `by` matrix.
        const plc = await inspectPlc();
        expect((await plcInspect()).code, "inspect by designation").toBe(0);
        const runs = await parallel(
          [
            () =>
              agent(
                "resolve",
                request({ target: { by: "text", value: "PLC" } }),
                starter,
              ),
            () =>
              agent(
                "inspect",
                request({ selector: { by: "uid", value: plc.uid } }),
                starter,
              ),
            () =>
              query(starter, "neighbors", { by: "designation", value: "PLC1" }),
            () => query(starter, "trace", { by: "uid", value: plc.uid }),
            () =>
              query(ctx.pristine.cabinets, "cable", {
                by: "designation",
                value: "CBL1",
              }),
            () => query(starter, "net", { by: "display", value: "PS1.+" }),
            netPlcX20,
          ],
          (run) => run(),
        );
        for (const [i, run] of runs.entries())
          expect(run.code, describeRun([`request ${i}`], run)).toBe(0);
        // The other forms the sentence lists, through the CLI's agent command
        // in this worker.
        const named = async (project: string, designation: string) =>
          (await readJson(join(project, EQUIPMENT))).objects.find(
            (o: { designation?: string }) => o.designation === designation,
          );
        const plcType = (await named(starter, "PLC1")).type;
        const cable = await named(ctx.pristine.cabinets, "CBL1");
        const forms = [
          ["resolve", { target: { by: "uid", value: plc.uid } }, starter],
          [
            "resolve",
            { target: { by: "designation", value: "PLC1" } },
            starter,
          ],
          ["resolve", { target: { by: "type", value: plcType } }, starter],
          [
            "query",
            {
              query: {
                operation: "neighbors",
                selector: { by: "uid", value: plc.uid },
              },
            },
            starter,
          ],
          [
            "query",
            {
              query: {
                operation: "trace",
                selector: { by: "designation", value: "PLC1" },
              },
            },
            starter,
          ],
          [
            "query",
            {
              query: {
                operation: "cable",
                selector: { by: "uid", value: cable.uid },
              },
            },
            ctx.pristine.cabinets,
          ],
        ] as const;
        for (const [tool, fields, project] of forms) {
          const run = await agentHere(tool, request(fields), project);
          expect(run.code, JSON.stringify(fields)).toBe(0);
          const { value } = run.result;
          if (tool === "resolve")
            expect(
              value.mode === "resolve"
                ? [value.object.uid]
                : value.matches.map((m: any) => m.object.uid),
              JSON.stringify(fields),
            ).toContain(plc.uid);
        }
        // Operation fields belong under `query`, not at the request top level.
        const flat = await agent(
          "query",
          request({
            operation: "net",
            selector: { by: "display", value: "PS1.+" },
          }),
          starter,
        );
        expect(flat.report.error).toMatchObject({
          code: "A001",
          field: "/query",
        });
      },
    },
    {
      claim:
        '`apply-source-patch`: `patchFormat: "json-patch/0.1"`, `dryRun`, and `files`, each with `path`, current `expectedIntegrity` and JSON Patch `operations` (`test`, `add`, `remove`, `replace` only).',
      async check() {
        const project = ctx.pristine.starter;
        const file = EQUIPMENT;
        const allowed = await agent(
          "apply-source-patch",
          await patchRequest(project, file, [
            { op: "test", path: "/objects/1/designation", value: "PLC1" },
            { op: "replace", path: "/objects/1/designation", value: "PLC1" },
            { op: "add", path: "/objects/-", value: 1 },
            { op: "remove", path: "/objects/2" },
          ]),
          project,
        );
        expect(allowed.code, describeRun(["patch"], allowed)).toBe(0);
        // The refusal itself lists the only allowed operations.
        const move = await agent(
          "apply-source-patch",
          await patchRequest(project, file, [
            { op: "move", from: "/objects/0", path: "/objects/-" },
          ]),
          project,
        );
        expect(move.report.error).toMatchObject({
          code: "A001",
          allowed: ["test", "add", "remove", "replace"],
        });
        const { files: _files, ...withoutFiles } = await patchRequest(
          project,
          file,
          [],
        );
        const missing = await agent(
          "apply-source-patch",
          withoutFiles,
          project,
        );
        expect(missing.report.error).toMatchObject({
          code: "A001",
          field: "/files",
        });
      },
    },
    {
      claim:
        "Only existing referenced source and presentation files qualify (A003 otherwise): not `system.json`, the library lock, libraries or this guide.",
      async check() {
        const project = ctx.pristine.starter;
        await parallel(
          [
            "system.json",
            "electrical-system.lock.json",
            "libraries/core/library.json",
            "AGENTS.md",
          ],
          async (path) => {
            const run = await agent(
              "apply-source-patch",
              await patchRequest(project, path, [
                { op: "test", path: "/format", value: "x" },
              ]),
              project,
            );
            expect(run.report.error?.code, path).toBe("A003");
          },
        );
        const presentation = await readJson(join(project, "presentation.json"));
        const run = await agent(
          "apply-source-patch",
          await patchRequest(project, "presentation.json", [
            { op: "test", path: "/format", value: presentation.format },
          ]),
          project,
        );
        expect(run.code).toBe(0);
      },
    },
    {
      claim:
        "`create-view`: `spec`, one schematic view request without `page`. It returns the original continuous SVG, or a cable's complete core sheet; a view needing several sheets fails R006, so use the printing commands below.",
      async check() {
        const svg = /^(<\?xml[^>]*>\s*)?<svg[\s>]/;
        expect((await createViewLoads()).result.value.svg).toMatch(svg);
        const paged = await agent(
          "create-view",
          request({ spec: { ...LOADS_SPEC, page: { size: "letter" } } }),
          ctx.pristine.starter,
        );
        expect(paged.report.error?.code).toBe("A001");
        const cores = {
          format: "schematic-view-request/0.2",
          root: { by: "designation", value: "CBL1" },
          intent: { kind: "conductors" },
        };
        const cable = await agent(
          "create-view",
          request({ spec: cores }),
          ctx.pristine.cabinets,
        );
        expect(cable.result.value.svg).toMatch(svg);
        // 44 cores need several sheets: create-view refuses, view paginates.
        const project = await freshProject("cabinets");
        const extra = Array.from({ length: 40 }, (_, i) => `x${i}`);
        await editJson(
          join(project, "libraries/core/types/cable-2pair-shielded.json"),
          (file) =>
            file.types[0].conductors.push(
              ...extra.map((id) => ({ id, color: "blue", size: "18AWG" })),
            ),
        );
        await editJson(join(project, "devices/equipment.json"), (file) =>
          file.objects
            .find((o: { kind: string }) => o.kind === "cable")
            .conductors.push(
              ...extra.map((id) => ({
                id,
                usage: "spare",
                endpoints: [null, null],
              })),
            ),
        );
        await ok(["lock", "."], project);
        const several = await agent(
          "create-view",
          request({ spec: cores }),
          project,
        );
        expect(several.report.error).toMatchObject({
          code: "R006",
          message: expect.stringContaining("needs multiple sheets"),
        });
        const printed = await ok(
          ["view", "CBL1", "--conductors", "--json"],
          project,
        );
        expect(JSON.parse(printed.stdout).sheets.length).toBeGreaterThan(1);
      },
    },
    {
      claim:
        "Applies (not dry runs) reserve `.thermite-schematics-write.lock` in the canonical project root through revalidation, commit and rollback; it is not the library lock. Never commit it (alpha `init` adds it to `.gitignore`). A005/exit 1 reports contention with the exact path, owner PID/hostname/version, creation time and age. Wait for a live owner. A dead PID on the recorded host indicates abandonment: confirm all writers are stopped, then remove exactly that path. Check the host of an unknown/other-host owner; age alone is insufficient.",
      async check() {
        const { project, lockPath, owner, before, dry, apply, after } =
          await aliveContention();
        expect(await readFile(join(project, ".gitignore"), "utf8")).toBe(
          `${RESERVATION}\n`,
        );
        // Dry runs never take the reservation.
        expect(dry.code).toBe(0);
        expect(apply.code).toBe(1);
        expect(apply.report.error).toMatchObject({
          code: "A005",
          lockPath,
          owner,
          ageMs: expect.any(Number),
          ownerState: "alive",
        });
        expect(apply.report.error.ageMs).toBeGreaterThanOrEqual(60_000);
        expect(after).toEqual(before);
        // The other owner states, through the CLI's agent command on engine
        // fixtures: neither is reclaimed, and a SIGKILLed writer on this host
        // is not running.
        const cases = await engine();
        for (const state of ["other-host", "unknown"] as const) {
          const { lockPath, contents, run, kept } =
            await cases.foreignReservation(state);
          expect(run.code, state).toBe(1);
          expect(run.report.error, state).toMatchObject({
            code: "A005",
            lockPath,
            ownerState: state,
          });
          expect(kept, state).toBe(contents);
        }
        const abandoned = await cases.abandonedReservation();
        expect(abandoned.found.code).toBe(1);
        expect(abandoned.found.report.error).toMatchObject({
          code: "A005",
          lockPath: abandoned.lockPath,
          owner: { pid: abandoned.pid, hostname: hostname() },
          ownerState: "not-running",
        });
        expect(abandoned.recovered.code).toBe(0);
        // Removing exactly that path releases the project; the library lock
        // is a different file and stays untouched.
        const libraryLock = await readFile(
          join(project, "electrical-system.lock.json"),
        );
        await rm(lockPath);
        const applied = await agent(
          "apply-source-patch",
          await patchRequest(project, EQUIPMENT, PLC_TEST, false),
          project,
        );
        expect(applied.code).toBe(0);
        expect(await readdir(project)).not.toContain(RESERVATION);
        expect(
          await readFile(join(project, "electrical-system.lock.json")),
        ).toEqual(libraryLock);
      },
    },
    {
      claim:
        "On POSIX the CLI releases on unhandled SIGINT/SIGTERM/SIGHUP then re-raises; embedded hosts keep their own handlers, and signal-revoked writes fail closed.",
      async check() {
        // Each signal mid-commit, on the engine's paused writer: it exits on
        // that signal with the reservation released, and a retry applies.
        const { claimed, HELD_SIGNALS, HOST_HANDLERS } = await engine();
        const released = (signal: string) =>
          `ready; owner recorded; exited on ${signal}; reservation released; retry exit 0`;
        await claimed(HELD_SIGNALS, {
          SIGINT: released("SIGINT"),
          SIGTERM: released("SIGTERM"),
          SIGHUP: released("SIGHUP"),
        });
        // An embedded host's own handler runs once; a write the signal
        // revoked fails closed, before or after its bytes land.
        await claimed(HOST_HANDLERS, {
          before:
            "host handler ran 1x; applied; source patched; reservation released",
          after:
            "host handler ran 1x; failed tool (PATCH_LOCK_REVOKED); source unchanged; reservation released",
          "after-write":
            "host handler ran 1x; failed tool (PATCH_LOCK_REVOKED); source patched, not restored; reservation released",
        });
      },
    },
    {
      claim: "Forced termination may leave the reservation.",
      async check() {
        // A writer SIGKILLed mid-commit leaves its reservation for the next
        // apply to find.
        const { found, lockPath } = await (
          await engine()
        ).abandonedReservation();
        expect(found.report.error).toMatchObject({ code: "A005", lockPath });
      },
    },
    {
      claim:
        "A commit whose release fails stays successful with W801 naming the path: verify the committed state instead of replaying, and remove the leftover once that command has exited and no other writer runs.",
      async check() {
        // An engine fixture whose reservation release fails, through the
        // CLI's agent command.
        const { run, lockPath, committed } = await (
          await engine()
        ).releaseFailure();
        expect(run.code).toBe(0);
        expect(committed).toBe(true);
        const w801 = run.report.diagnostics.find(
          (d: { code: string }) => d.code === "W801",
        );
        expect(w801?.message).toContain(JSON.stringify(lockPath));
        expect(w801?.message).toContain("Do not replay the patch.");
        expect(w801?.message).toContain(
          "Once this command has exited and no other writer is running, it is safe to remove that reservation.",
        );
      },
    },
    {
      claim: "Failed applies also name any leftover path.",
      async check() {
        // An engine fixture whose write and then release both fail.
        const { run, lockPath } = await (await engine()).leftoverReservation();
        expect(run.code).toBe(2);
        expect(
          run.report.diagnostics.map((d: { message: string }) => d.message),
        ).toContainEqual(
          expect.stringContaining(
            `Write reservation ${JSON.stringify(lockPath)} remains`,
          ),
        );
      },
    },
    {
      claim:
        "Rollback refuses changed chains or bytes; an incomplete restore is exit 2 and lists restored and unrestored files with reasons.",
      async check() {
        // A rollback that a changed chain or changed bytes interrupts, on
        // the engine's fixture through the CLI's agent command.
        const { claimed, PARTIAL_ROLLBACKS } = await engine();
        const partial = (reason: string) =>
          `exit 2: Source patch rollback restored ["b/b.json"]; not restored [{"file":"a/a.json","reason":"${reason}"}]. Only successfully replaced files were candidates for restoration.`;
        await claimed(PARTIAL_ROLLBACKS, {
          ancestor: partial("chain changed"),
          content: partial("content changed"),
        });
      },
    },
    {
      claim:
        "Every new object needs a fresh lowercase UUID `uid` (uppercase fails E013).",
      async check() {
        const project = ctx.pristine.starter;
        const device = (uid: string) => ({
          op: "add",
          path: "/objects/-",
          value: {
            uid,
            kind: "device",
            designation: "K1",
            type: "core:contactor-3p-1no",
          },
        });
        const uid = randomUUID();
        const upper = await agent(
          "apply-source-patch",
          await patchRequest(project, "devices/equipment.json", [
            device(uid.toUpperCase()),
          ]),
          project,
        );
        expect(upper.report.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "E013",
            jsonPointer: "/objects/2/uid",
          }),
        );
        const lower = await agent(
          "apply-source-patch",
          await patchRequest(project, "devices/equipment.json", [device(uid)]),
          project,
        );
        expect(lower.code).toBe(0);
      },
    },
    {
      claim:
        'Wire, jumper and cable-core endpoints and potential `at` are `{"device": "PLC1", "terminal": "X2.0"}`: a designation and an exact, case-sensitive terminal key (E101/E102 otherwise). Dotted `PLC1.X2.0` is display syntax only.',
      async check() {
        const project = ctx.pristine.starter;
        const plc = await inspectPlc();
        const attempt = async (from: unknown, to: unknown) =>
          codesOf(
            await agent(
              "apply-source-patch",
              await patchRequest(project, WIRES, [wire(from, to)]),
              project,
            ),
          );
        const supply = { device: "PS1", terminal: "+" };
        expect(
          await attempt(supply, { device: "PLC1", terminal: "X2.0" }),
        ).toEqual(["W905"]);
        expect(
          await attempt(supply, { device: plc.uid, terminal: "X2.0" }),
        ).toContain("E101");
        expect(
          await attempt(supply, { device: "PLC1", terminal: "x2.0" }),
        ).toContain("E102");
        expect(await attempt("PS1.+", "PLC1.X2.0")).toContain("E011");
        expect((await netPlcX20()).code, "display syntax").toBe(0);
      },
    },
    {
      claim:
        "Function keys are not terminal keys: core `plc-compact` function `do0` is terminal `X2.0`.",
      async check() {
        const project = ctx.pristine.starter;
        const plc = await inspectPlc();
        expect(plc.typeId).toBe("core:plc-compact");
        const do0 = plc.functions.find((f: { key: string }) => f.key === "do0");
        expect(do0.terminals.map((t: any) => t.id.terminalKey)).toEqual([
          "X2.0",
        ]);
        const run = await agent(
          "apply-source-patch",
          await patchRequest(project, WIRES, [
            wire(
              { device: "PS1", terminal: "+" },
              { device: "PLC1", terminal: "do0" },
            ),
          ]),
          project,
        );
        expect(codesOf(run)).toContain("E102");
      },
    },
    {
      claim: "An `exclusive` terminal takes one conductor (E201).",
      async check() {
        const project = ctx.pristine.starter;
        const plc = await inspectPlc();
        const x10 = plc.functions
          .flatMap((f: any) => f.terminals)
          .find((t: any) => t.id.terminalKey === "X1.0");
        expect(x10.connectionPolicy).toBe("exclusive");
        const input = { device: "PLC1", terminal: "X1.0" };
        const run = await agent(
          "apply-source-patch",
          await patchRequest(project, WIRES, [
            wire({ device: "PS1", terminal: "+" }, input),
            wire({ device: "PS1", terminal: "-" }, input, "W-GUIDE-2"),
          ]),
          project,
        );
        expect(run.report.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "E201",
            message: expect.stringContaining("PLC1.X1.0"),
          }),
        );
      },
    },
    {
      claim:
        "Terminal ratings never create one, even on a source: 480 VAC wired to a 24 VDC input warns W303 (ratings disagree) until potentials declare voltage_type.",
      async check() {
        const project = await freshProject("starter");
        await editJson(join(project, "devices/equipment.json"), (file) =>
          file.objects.push({
            uid: randomUUID(),
            kind: "device",
            designation: "SRC1",
            type: "core:supply-480v-3ph",
          }),
        );
        await editJson(join(project, WIRES), (file) =>
          file.objects.push(
            wire(
              { device: "SRC1", terminal: "L1" },
              { device: "PLC1", terminal: "X1.0" },
            ).value,
          ),
        );
        await editJson(join(project, "devices/equipment.json"), (file) => {
          delete file.objects.find((o: any) => o.designation === "PS1")
            .connectionReview;
          file.objects.push({
            uid: randomUUID(),
            kind: "device",
            designation: "TB",
            type: "core:terminal-block-8",
          });
        });
        await editJson(join(project, WIRES), (file) =>
          file.objects.push(
            wire(
              { device: "SRC1", terminal: "L1" },
              { device: "PS1", terminal: "L" },
              "W-FEED-L",
            ).value,
            wire(
              { device: "SRC1", terminal: "L2" },
              { device: "PS1", terminal: "N" },
              "W-FEED-N",
            ).value,
            wire(
              { device: "SRC1", terminal: "PE" },
              { device: "TB", terminal: "1" },
              "W-FEED-PE",
            ).value,
          ),
        );
        // Valid, with the warning naming both declared ratings, and the net
        // listed as unassessed; the warning fails `--strict`.
        const warned = JSON.parse(
          (await ok(["validate", ".", "--json"], project)).stdout,
        );
        expect(warned.map((d: any) => [d.code, d.severity])).toEqual([
          ["W303", "warning"],
          ["I304", "info"],
          ["I305", "info"],
        ]);
        expect(warned[0].message).toMatch(
          /these declared ratings disagree: PLC1\.X1\.0 rating \{"nominal_voltage":24,"voltage_type":"DC"\} .*; SRC1\.L1 rating \{"nominal_voltage":480,"voltage_type":"AC"\} .*No potential declares voltage facts on this net/,
        );
        expect(warned[1].message).toContain(
          '(1 net: ["PLC1.X1.0, PS1.L, SRC1.L1 [net:',
        );
        await rejected(["validate", ".", "--strict"], project, "W303");
        await editJson(join(project, "potentials/potentials.json"), (file) =>
          file.objects.push({
            uid: randomUUID(),
            kind: "potential",
            name: "480VAC",
            at: { device: "SRC1", terminal: "L1" },
            electrical: { nominal_voltage: 480 },
          }),
        );
        // A nominal-only potential leaves the AC/DC disagreement unassessed.
        // Its declared nominal field still belongs to E302, so both findings stay.
        const partial = JSON.parse(
          (await rejected(["validate", ".", "--json"], project, "W303")).stdout,
        );
        expect(partial.map((d: any) => d.code).sort()).toEqual([
          "E302",
          "I305",
          "W303",
        ]);
        const partialWarning = partial.find((d: any) => d.code === "W303");
        expect(partialWarning.message).toContain(
          "does not declare voltage_type",
        );
        expect(partialWarning.related).toEqual(warned[0].related);
        await editJson(join(project, "potentials/potentials.json"), (file) => {
          file.objects.find(
            (p: any) => p.name === "480VAC",
          ).electrical.voltage_type = "AC";
        });
        // With a potential the net is checked: E301, whose gate skips E302 on
        // that terminal (I208); neither advisory remains.
        const checked = JSON.parse(
          (await rejected(["validate", ".", "--json"], project, "E301")).stdout,
        );
        expect(checked.map((d: any) => [d.code, d.message])).toEqual([
          [
            "E301",
            'Effective voltage type "AC" is incompatible with terminal ratings at "PLC1.X1.0".',
          ],
          [
            "I208",
            'Checks not completed: E301 voltage-type gate: skipped E302 on 1 terminal: ["PLC1.X1.0"].',
          ],
          ["I305", expect.stringContaining("SRC1.L2 rating")],
        ]);
      },
    },
    {
      claim:
        "The starter declares only +24VDC and 0VDC at PS1; declare potentials at the sources you add.",
      async check() {
        const potentials = (
          await readJson(
            join(ctx.pristine.starter, "potentials/potentials.json"),
          )
        ).objects;
        expect(potentials.map((p: any) => [p.name, p.at.device])).toEqual([
          ["+24VDC", "PS1"],
          ["0VDC", "PS1"],
        ]);
      },
    },
    {
      claim:
        "Write large outputs to files: `create-view` returns tens of KB and `inspect` several KB; `view`, `packet` or `report` without `-o` print a whole HTML document.",
      async check() {
        const project = ctx.pristine.starter;
        expect((await createViewLoads()).stdout.length).toBeGreaterThanOrEqual(
          10_000,
        );
        const inspected = await plcInspect();
        expect(inspected.stdout.length).toBeGreaterThanOrEqual(2_000);
        expect(inspected.stdout.length).toBeLessThan(10_000);
        await parallel(
          [
            ["view", "PS1", "--loads"],
            ["packet", "--input", "-"],
            ["report", "bom"],
          ],
          async (args) => {
            const run = await ok(args, project, JSON.stringify(STARTER_PACKET));
            expect(run.stdout, args.join(" ")).toMatch(
              /^<!doctype html>[\s\S]*<\/html>\s*$/i,
            );
          },
        );
      },
    },
    {
      claim:
        "Commands default to `--project .`; `validate`/`lock` also take a path, never both (`thermite validate . --strict`).",
      async check() {
        for (const name of ctx.tree.alpha.filter(
          (n) => !["init", "guide"].includes(n),
        )) {
          const option = ctx.tree.commands
            .get(name)!
            .options.find((o) => o.flags.includes("--project"));
          expect(option?.description, name).toContain('(default: ".")');
        }
        for (const name of ["validate", "lock"]) {
          const flags = name === "lock" ? ["--check"] : [];
          const positional = await ok(
            [name, ".", ...flags],
            ctx.pristine.starter,
          );
          const alias = await ok(
            [name, "--project", ".", ...flags],
            ctx.pristine.starter,
          );
          expect(alias.stdout, name).toBe(positional.stdout);
          expect(alias.stderr, name).toBe(positional.stderr);
          // The guide advises one form ("never both"); a matching pair is also
          // accepted, and a conflicting pair still fails (#44).
          const equal = await ok(
            [name, ".", "--project", ".", ...flags],
            ctx.pristine.starter,
          );
          expect(equal.stdout, name).toBe(positional.stdout);
          expect(equal.stderr, name).toBe(positional.stderr);
          const conflict = await thermite(
            [name, ".", "--project", "missing"],
            ctx.pristine.starter,
          );
          expect(conflict.code, name).toBe(2);
          expect(conflict.stdout).toBe("");
          expect(conflict.stderr).toBe(
            "error: [path] and --project refer to different paths\n",
          );
        }
        await rejected(
          ["validate", ".", "--strict"],
          ctx.pristine.starter,
          "W905",
        );
        await ok(["validate", ".", "--strict"], ctx.pristine.cabinets);
      },
    },
    {
      claim:
        "Each view needs a matching root, else R001: `--power` a load with mapped load terminals (a motor, or PS1's AC input), `--actuation` a mapped two-terminal coil, `--loads` a source with source/return terminals (PS1), `--conductors` a cable (else Q002), and `--to <device> [--include-power]` only a switch with one NO contact or a three-wire sensor (`core:limit-switch-2wire`, `core:prox-pnp-3wire`).",
      async check() {
        const { robustnessFixture } =
          await import("../../../render/test/render-robustness-fixture.js");
        const supplies = await robustnessFixture();
        try {
          for (const variant of ["plc3", "daisy"] as const) {
            await supplies.compile(variant, 0);
            const args = ["view", "PS1", "--loads", "--json"];
            const run = await thermite(args, supplies.root);
            expect(run.code, describeRun(args, run)).toBe(0);
            const svg = JSON.parse(run.stdout)
              .sheets.map((sheet: { svg: string }) => sheet.svg)
              .join("\n");
            for (const name of variant === "plc3"
              ? ["PLC1", "PLC2", "PLC3"]
              : ["PLC1", "PLC2"])
              expect(svg).toContain(name);
          }
        } finally {
          await supplies.close();
        }
        const project = await viewRoots();
        // [root, mode, accepted]: each mode takes its root and refuses PLC1.
        const cases = [
          ["M1", "--power", true],
          ["PS1", "--power", true],
          ["K1", "--actuation", true],
          ["PS1", "--loads", true],
          ["LS1", "--to PLC1", true],
          ["B1", "--to PLC1", true],
          ["LS1", "--to PLC1 --include-power", true],
          ["PLC1", "--power", false],
          ["PLC1", "--actuation", false],
          ["PLC1", "--loads", false],
          ["M1", "--to PLC1", false],
          ["M1", "--to PLC1 --include-power", false],
        ] as const;
        await parallel(cases, async ([root, mode, accepted]) => {
          const run = await thermite(
            ["view", root, ...mode.split(" "), "--json"],
            project,
          );
          const what = describeRun([root, mode], run);
          const error = /"error":\s*\{"code":\s*"(\w+)"/.exec(run.stderr)?.[1];
          // An accepted root renders or fails later in rendering (an unwired
          // motor's R002), never at the root check or in compilation.
          if (accepted)
            expect(run.code === 0 ? "rendered" : error, what).toMatch(
              /^(rendered|R(?!001)\d{3})$/,
            );
          else expect(error, what).toBe("R001");
        });
        const notCable = await thermite(
          ["view", "PLC1", "--conductors"],
          project,
        );
        expect(notCable.stderr).toMatch(/"code":\s*"Q002"/);
        // Only these root a trace: a trace from one device of every core
        // device type and of every site type, in-process.
        const devices = (await readJson(join(project, EQUIPMENT))).objects;
        const types = new Set(devices.map((d: any) => d.type));
        for (const type of (await coreDeviceTypes()).values())
          expect(types, type.id).toContain(type.id);
        const traced = await Promise.all(
          devices.map(async (d: any) => {
            const to = d.designation === "PLC1" ? "PS1" : "PLC1";
            const { code } = await viewHere(
              project,
              d.designation,
              `--to ${to}`,
            );
            return code === "R001" ? [] : [d.type];
          }),
        );
        expect(traced.flat().sort()).toEqual([
          "core:limit-switch-2wire",
          "core:prox-pnp-3wire",
          "core:selector-2pos",
          "site:limit-switch-2wire",
          "site:prox-pnp-3wire",
        ]);
      },
    },
    {
      claim:
        "Roots bind by `symbol` and function shape, not type ID, so a cloned core type keeps its views.",
      async check() {
        const project = await viewRoots();
        // Each clone, under its own type ID, gets its original's outcome and
        // message in every view its original roots.
        const modes: Record<string, readonly string[]> = {
          "motor-3ph": ["--power"],
          "contactor-3p-1no": ["--actuation"],
          "psu-24vdc": ["--power", "--loads"],
          "limit-switch-2wire": ["--to PLC1", "--to PLC1 --include-power"],
          "prox-pnp-3wire": ["--to PLC1"],
        };
        const pairs = ROOT_CLONES.flatMap(([original, clone, name]) =>
          modes[name]!.map((mode) => [original, clone, mode] as const),
        );
        expect(pairs).toHaveLength(7);
        await Promise.all(
          pairs.map(async ([original, clone, mode]) => {
            const [a, b] = await Promise.all([
              viewHere(project, original, mode),
              viewHere(project, clone, mode),
            ]);
            expect(a.code, `${original} ${mode}`).not.toBe("R001");
            expect(
              { ...b, message: b.message.replaceAll(clone, original) },
              `${clone} ${mode}`,
            ).toEqual(a);
          }),
        );
        // The shape decides, not the name: the switch symbol on an NC contact
        // and the same NO contact under the pushbutton symbol root no trace.
        for (const root of ["LS3", "LS4"])
          expect((await viewHere(project, root, "--to PLC1")).code, root).toBe(
            "R001",
          );
        // A starter whose PS1 and PLC1 are clones draws PS1's loads exactly as
        // the starter does, but for the type IDs.
        const { renderHere } = await engine();
        const loads = viewPacket("PS1", "--loads");
        const [original, cloned] = await Promise.all([
          renderHere(ctx.pristine.starter, loads),
          renderHere(await clonedStarter(), loads),
        ]);
        expect(original.ok).toBe(true);
        const text = JSON.stringify(cloned);
        expect(text).toContain("site:psu-24vdc");
        expect(text.replaceAll("site:", "core:")).toBe(
          JSON.stringify(original),
        );
      },
    },
    {
      claim:
        "`--flow left-to-right|top-to-bottom`, `--paper letter|tabloid|a4|a3`, `--orientation landscape|portrait`, `--margin <mm>` (5-25), `--layout compact` and `--index` override project page settings.",
      async check() {
        const project = await freshProject("starter");
        const view = ["view", "PS1", "--loads"];
        const presentation = await readJson(join(project, "presentation.json"));
        expect(presentation.page).toMatchObject({
          size: "tabloid",
          orientation: "landscape",
        });
        // Each paper size once, alternating orientation; the in-range margin
        // bounds ride on two of those runs.
        const papers = [
          ["letter", "landscape", "5"],
          ["tabloid", "portrait", "25"],
          ["a3", "landscape", undefined],
        ] as const;
        await parallel(papers, async ([paper, orientation, margin]) => {
          const args = [
            ...view,
            "--paper",
            paper,
            "--orientation",
            orientation,
          ];
          if (margin) args.push("--margin", margin);
          const [short, long] = PAPER_MM[paper]!;
          const mm = orientation === "portrait" ? [short, long] : [long, short];
          const { page } = JSON.parse(
            (await ok([...args, "--json"], project)).stdout,
          );
          expect(page, `${paper} ${orientation}`).toMatchObject({
            size: paper,
            orientation,
          });
          expect(page.widthMm).toBeCloseTo(mm[0]!, 1);
          expect(page.heightMm).toBeCloseTo(mm[1]!, 1);
          if (margin) expect(page.marginMm).toBe(Number(margin));
        });
        const runs: Record<string, string[]> = {
          // a4 portrait: the PDF carries the paper size on every page.
          a4: [
            ...view,
            "--paper",
            "a4",
            "--orientation",
            "portrait",
            "-o",
            "a4.pdf",
          ],
          m4: [...view, "--margin", "4", "--json"],
          m26: [...view, "--margin", "26", "--json"],
          l2r: [...view, "--flow", "left-to-right", "--json"],
          t2b: [...view, "--flow", "top-to-bottom", "--json"],
          compact: [...view, "--layout", "compact", "--json"],
          index: [...view, "--index", "--json"],
        };
        const done = Object.fromEntries(
          await parallel(Object.entries(runs), async ([name, args]) => [
            name,
            await thermite(args, project),
          ]),
        );
        for (const name of ["a4", "l2r", "t2b", "compact", "index"])
          expect(done[name].code, describeRun(runs[name], done[name])).toBe(0);
        expect([done.m4.code, done.m26.code], "margins 4 and 26").toEqual([
          1, 1,
        ]);
        const boxes = mediaBoxes(
          await readFile(join(project, "a4.pdf"), "latin1"),
        );
        expect(boxes.length).toBeGreaterThan(0);
        for (const [w, h] of boxes) {
          expect(w).toBeCloseTo((210 * 72) / 25.4, 1);
          expect(h).toBeCloseTo((297 * 72) / 25.4, 1);
        }
        // Sheets carry their SVG, so a different flow draws different sheets.
        const sheets = (name: string) => JSON.parse(done[name].stdout).sheets;
        expect(sheets("t2b")).not.toEqual(sheets("l2r"));
        expect(sheets("index").length).toBeGreaterThan(sheets("l2r").length);
      },
    },
    {
      claim:
        "`-o` writes `.html` (all sheets), `.pdf`, `.json`, or `.svg` for a single sheet only (R006 otherwise).",
      async check() {
        const project = await freshProject("starter");
        await writeJson(join(project, "packet.json"), STARTER_PACKET);
        const input = ["packet", "--input", "packet.json"];
        await parallel(["p.json", "p.html", "p.pdf"], (file) =>
          ok([...input, "-o", file], project),
        );
        const sheets = (await readJson(join(project, "p.json"))).sheets.length;
        expect(sheets).toBeGreaterThan(1);
        const html = await readFile(join(project, "p.html"), "utf8");
        expect(html.match(/<svg[\s>]/g)?.length).toBeGreaterThanOrEqual(sheets);
        const pdf = await readFile(join(project, "p.pdf"), "latin1");
        expect(pdf.startsWith("%PDF-")).toBe(true);
        expect(mediaBoxes(pdf)).toHaveLength(sheets);
        await rejected([...input, "-o", "p.svg"], project, "R006");
        await ok(["view", "PS1", "--loads", "-o", "one.svg"], project);
      },
    },
    {
      claim: "Page settings: packet/presentation, never views.",
      async check() {
        const project = ctx.pristine.starter;
        const paged = structuredClone(STARTER_PACKET) as any;
        paged.views[0].page = { size: "letter" };
        const run = await packet(project, paged);
        expect(run.code).toBe(1);
        expect(run.stderr).toMatch(/"code":\s*"R006"/);
        const shared = await packet(project, {
          ...STARTER_PACKET,
          page: { size: "letter" },
        });
        expect(shared.code, describeRun(shared.args, shared)).toBe(0);
        expect(shared.json.page).toMatchObject({ size: "letter" });
      },
    },
    {
      claim:
        "W906: undrawn devices in drawing packets; warnings exit 0 or 1 with `--strict`.",
      async check() {
        const project = ctx.pristine.starter;
        const request = {
          format: "schematic-packet-request/0.1",
          views: [
            {
              format: "circuit-view-request/0.1",
              title: "Supply only",
              groups: [
                {
                  id: "supply",
                  conductors: [],
                  functions: [
                    {
                      device: { by: "designation", value: "PS1" },
                      key: "dc_output",
                    },
                  ],
                },
              ],
            },
            { format: "documentation-view-request/0.1", kind: "bom" },
          ],
        };
        for (const strict of [false, true]) {
          const reports = await packet(
            ctx.pristine.cabinets,
            {
              format: "schematic-packet-request/0.1",
              views: [
                { format: "documentation-view-request/0.1", kind: "bom" },
              ],
            },
            ["--json", ...(strict ? ["--strict"] : [])],
          );
          expect(reports.code).toBe(0);
          expect(JSON.parse(reports.stdout).coverage.diagnostics ?? []).toEqual(
            [],
          );
        }
        for (const strict of [false, true]) {
          const run = await packet(project, request, [
            "--json",
            ...(strict ? ["--strict"] : []),
          ]);
          expect(run.code).toBe(strict ? 1 : 0);
          const warning = JSON.parse(run.stderr).diagnostics.find(
            (d: any) => d.code === "W906",
          );
          expect(warning.devices.map((d: any) => d.designation)).toEqual([
            "PLC1",
          ]);
          expect(
            warning.devices.every((d: any) => d.appearance === "reports-only"),
          ).toBe(true);
        }
      },
    },
    ...guardedWorkflows,
  ],
  unexecuted: new Map([
    [
      "Never install/build in a downloaded runtime.",
      "Instruction about runtime packages, which this source-checkout suite does not use.",
    ],
    [
      "Source checkouts need `bun install --frozen-lockfile && bun run build` before use and after engine changes.",
      "Setup instruction; this suite itself runs from a built checkout.",
    ],
    [
      "When using a runtime package, report bugs, missing capabilities, and unclear documentation at https://github.com/BlackettApplied/ThermiteSchematics/issues after checking existing issues.",
      "Contribution process; no runtime behavior.",
    ],
    [
      "Without GitHub access, write a ready-to-submit issue title and body.",
      "Contribution process; no runtime behavior.",
    ],
    [
      "Do not patch a downloaded runtime in place.",
      "Contribution process; no runtime behavior.",
    ],
    [
      "From source, make engine fixes in the separate checkout; follow its AGENTS.md and CONTRIBUTING.md for pull requests, keeping private data and credentials out of issues and pull requests.",
      "Contribution process; no runtime behavior.",
    ],
    [
      "The human contributor must accept any CLA; an agent must not sign it.",
      "Contribution policy; no runtime behavior.",
    ],
    [
      "`thermite guide` lists topics, schemas and diagnostic codes.",
      "g4-review.test.ts checks the index pointer; guide.test.ts executes the index and every topic.",
    ],
    [
      "Electrical JSON is authoritative.",
      "Authoring principle; no runtime behavior.",
    ],
    [
      "PDF, SVG and HTML are generated outputs.",
      "Authoring principle; the printing facts show these are generated.",
    ],
    [
      "Never hand-author schematic geometry, infer an engineering repair, or suppress compiler diagnostics.",
      "Authoring prohibition; no runtime behavior.",
    ],
    [
      "To change existing source or presentation files:",
      "Introduces the workflow line below.",
    ],
    [
      "`validate → resolve/inspect/query → dry-run patch → apply patch → validate → create-view`",
      "Workflow order; each step is executed by the agent-tool facts and blocks.",
    ],
    [
      "Print at 100% on matching paper and disable browser headers/footers.",
      "Printing advice for a browser; the PDF page-size facts cover paper sizes.",
    ],
    [
      "Reconstruction: record page/line provenance, separate aliases from verified pins, preserve conflicts for review, and assert critical endpoints and nets.",
      "Reconstruction practice for a human source drawing; continuity checks are executed in their own fact.",
    ],
  ]),
};
export default module;
