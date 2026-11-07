// Executable guide facts for reports, source guards and schema repairs.
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import {
  agent,
  codesOf,
  ctx,
  describeRun,
  editJson,
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
  request,
  thermite,
  writeJson,
  type FactModule,
} from "./harness.js";

export const wire = (
  from: unknown,
  to: unknown,
  designation = "W-GUIDE-1",
) => ({
  op: "add",
  path: "/objects/-",
  value: {
    uid: randomUUID(),
    kind: "wire",
    designation,
    endpoints: [from, to],
  },
});

const WIRES = "connections/control-power.json";
/** Agent read requests asking for source guards. */
const withSource = (fields: Record<string, unknown>) =>
  request({ ...fields, include: ["source"] });
const inspectSource = async (project: string, designation: string) =>
  (
    await agent(
      "inspect",
      withSource({ selector: { by: "designation", value: designation } }),
      project,
    )
  ).result.value;
/** The guide's uid test, verbatim, filled from a returned guard. */
const UID_TEST =
  '{"op":"test","path":"<source.pointer>/uid","value":"<source.uid>"}';
const uidTest = (source: { pointer: string; uid: string }) =>
  JSON.parse(
    UID_TEST.replace("<source.pointer>", source.pointer).replace(
      "<source.uid>",
      source.uid,
    ),
  );
/**
 * PLC1's guards on the starter. Every fresh copy has the pristine bytes, so
 * they guard any unedited copy.
 */
const starterPlc = () =>
  once("core:inspect PLC1 source", () =>
    inspectSource(ctx.pristine.starter, "PLC1"),
  );
/** A one-file patch built verbatim from a returned guard. */
const guardedPatch = (
  source: { file: string; integrity: string },
  operations: unknown[],
  dryRun = true,
) =>
  request({
    patchFormat: "json-patch/0.1",
    dryRun,
    files: [
      { path: source.file, expectedIntegrity: source.integrity, operations },
    ],
  });
/** A new device inserted at the front of its file, shifting the others. */
const insertDevice = {
  op: "add",
  path: "/objects/0",
  value: {
    uid: "6f0c7f4e-3c1b-4d55-9a57-3f1f5f2b9c11",
    kind: "device",
    designation: "K1",
    type: "core:contactor-3p-1no",
  },
};
const describeOp = (source: any, value: string) => ({
  op: "replace",
  path: `${source.pointer}/description`,
  value,
});

export const guardedWorkflows: FactModule["facts"] = [
  {
    claim: "`thermite cable CBL1 --json` lists every physical core.",
    async check() {
      const run = await ok(["cable", "CBL1", "--json"], ctx.pristine.cabinets);
      const cores = JSON.parse(run.stdout).cores.map(
        (c: { id: string }) => c.id,
      );
      const type = await readJson(
        join(
          ctx.pristine.cabinets,
          "libraries/core/types/cable-2pair-shielded.json",
        ),
      );
      expect(cores).toEqual(
        type.types[0].conductors.map((c: { id: string }) => c.id),
      );
    },
  },
  {
    claim:
      'Any kind accepts `--filter <file>` (or `-`), a device/type/location filter, but not with `--device`; packets use `{"format": "documentation-view-request/0.1", "kind": "network", "filter": {"devices": ["PLC1"]}}`.',
    async check() {
      const project = await freshProject("starter");
      const bogus = await thermite(["report", "bogus"], project);
      const kinds = /Report kind must be ([^.]+)\./
        .exec(bogus.stdout + bogus.stderr)![1]!
        .split(", ");
      await writeJson(join(project, "filter.json"), {
        types: ["core:plc-compact"],
      });
      // Every kind takes a filter; the three forms rotate across kinds.
      const filters = [
        { args: ["--filter", "-"], input: '{"devices":["PLC1"]}' },
        { args: ["--filter", "filter.json"], input: "" },
        {
          args: ["--filter", "-"],
          input: JSON.stringify({ locations: ["MAIN-PANEL"] }),
        },
      ];
      await parallel(kinds, async (kind, i) => {
        const filter = filters[i % filters.length]!;
        const run = await ok(
          ["report", kind, ...filter.args, "-o", `${kind}.csv`],
          project,
          filter.input,
        );
        expect(run.stderr, "selection metadata").toContain(
          "documentation-selection/0.1",
        );
      });
      await rejected(
        ["report", "terminals", "--device", "PLC1", "--filter", "-"],
        project,
        "R006",
        "not both",
        1,
        '{"devices":["PLC1"]}',
      );
      const filtered = await packet(project, {
        format: "schematic-packet-request/0.1",
        views: [
          {
            format: "documentation-view-request/0.1",
            kind: "network",
            filter: { devices: ["PLC1"] },
          },
        ],
      });
      expect(filtered.code, describeRun(filtered.args, filtered)).toBe(0);
      expect(filtered.json.documentationSelections).toEqual([
        expect.objectContaining({ filter: { devices: ["PLC1"] } }),
      ]);
    },
  },
  {
    claim:
      "`thermite continuity --input <file>` checks a `continuity-check-request/0.1` with `checks: [{id, reason, from, to}]` (terminal selectors as in `net` queries) and exits 1 when a declared path is not modeled.",
    async check() {
      const project = await freshProject("starter");
      const check = (to: string) => ({
        format: "continuity-check-request/0.1",
        checks: [
          {
            id: "c1",
            reason: "guide",
            from: { by: "display", value: "PS1.+" },
            to: { by: "display", value: to },
          },
        ],
      });
      await writeJson(join(project, "modeled.json"), check("PLC1.L+"));
      await writeJson(join(project, "missing.json"), check("PLC1.X2.1"));
      const modeled = await ok(
        ["continuity", "--input", "modeled.json", "--json"],
        project,
      );
      expect(JSON.parse(modeled.stdout).passed).toBe(true);
      const missing = await thermite(
        ["continuity", "--input", "missing.json", "--json"],
        project,
      );
      expect(missing.code).toBe(1);
      expect(JSON.parse(missing.stdout).passed).toBe(false);
    },
  },
  {
    claim:
      "Re-inspect and rebuild the patch after another edit; do not just copy a new integrity into an old request.",
    async check() {
      const project = await freshProject("starter");
      const plc = (await starterPlc()).object.source;
      // Another edit inserts a device ahead of PLC1, moving its index.
      const inserted = await agent(
        "apply-source-patch",
        guardedPatch(plc, [insertDevice], false),
        project,
      );
      expect(inserted.code, describeRun(["insert"], inserted)).toBe(0);
      const current = integrity(await readFile(join(project, plc.file)));
      const copied = await agent(
        "apply-source-patch",
        guardedPatch({ ...plc, integrity: current }, [
          uidTest(plc),
          describeOp(plc, "Guide edit"),
        ]),
        project,
      );
      expect(copied.report.error).toMatchObject({
        code: "A002",
        reason: "test-failed",
      });
      const rebuilt = (await inspectSource(project, "PLC1")).object.source;
      expect(rebuilt.pointer).not.toBe(plc.pointer);
      const applied = await agent(
        "apply-source-patch",
        guardedPatch(rebuilt, [
          uidTest(rebuilt),
          describeOp(rebuilt, "Guide edit"),
        ]),
        project,
      );
      expect(applied.code, describeRun(["rebuilt"], applied)).toBe(0);
    },
  },
  {
    claim:
      'Get guards from agent `inspect`/`resolve` with `include: ["source"]`: use `source.file` as `files[].path` and `source.integrity` as `expectedIntegrity` (one entry per file; `sourceFiles` also covers empty sources and presentation).',
    async check() {
      const project = await freshProject("starter");
      // An empty source still gets a guard.
      await writeJson(join(project, "connections/spare.json"), {
        objects: [],
      });
      await editJson(join(project, "system.json"), (manifest) =>
        manifest.sources.push("connections/spare.json"),
      );
      const inspected = await inspectSource(project, "PLC1");
      const { source } = inspected.object;
      expect(source).toMatchObject({
        file: "devices/equipment.json",
        patchEligible: true,
      });
      const guards = new Map<string, string>(
        inspected.sourceFiles.map((f: any) => [f.file, f.integrity]),
      );
      const manifest = await readJson(join(project, "system.json"));
      for (const file of [...manifest.sources, manifest.presentation])
        expect(guards.get(file), file).toBe(
          integrity(await readFile(join(project, file))),
        );
      expect(source.integrity).toBe(guards.get(source.file));
      const resolved = (
        await agent(
          "resolve",
          withSource({ target: { by: "designation", value: "PLC1" } }),
          project,
        )
      ).result.value;
      expect(resolved.object.source).toEqual(source);
      expect(resolved.sourceFiles).toContainEqual({
        file: "connections/spare.json",
        integrity: guards.get("connections/spare.json"),
      });
      // The guide's recipe, verbatim: dry run, then the same request.
      const edit = [uidTest(source), describeOp(source, "Guarded edit")];
      const dry = await agent(
        "apply-source-patch",
        guardedPatch(source, edit),
        project,
      );
      expect(dry.code, describeRun(["dry run"], dry)).toBe(0);
      const applied = await agent(
        "apply-source-patch",
        guardedPatch(source, edit, false),
        project,
      );
      expect(applied.code, describeRun(["apply"], applied)).toBe(0);
      expect(
        (await readJson(join(project, source.file))).objects[1].description,
      ).toBe("Guarded edit");
      // The empty source's listed guard admits its first object.
      const first = await agent(
        "apply-source-patch",
        guardedPatch(
          {
            file: "connections/spare.json",
            integrity: guards.get("connections/spare.json")!,
          },
          [
            wire(
              { device: "PS1", terminal: "+" },
              { device: "PLC1", terminal: "X1.0" },
            ),
          ],
        ),
        project,
      );
      expect(first.code, describeRun(["first wire"], first)).toBe(0);
      // One entry per file: a second entry for the same path is refused.
      const entry = {
        path: source.file,
        expectedIntegrity: integrity(
          await readFile(join(project, source.file)),
        ),
        operations: [uidTest(source)],
      };
      const twice = await agent(
        "apply-source-patch",
        request({
          patchFormat: "json-patch/0.1",
          dryRun: true,
          files: [entry, entry],
        }),
        project,
      );
      expect(twice.report.error).toMatchObject({
        code: "A003",
        reason: "duplicate-file",
      });
    },
  },
  {
    claim: "Patch only `patchEligible: true` sources.",
    async check() {
      const project = ctx.pristine.starter;
      const { object, sourceFiles } = await starterPlc();
      const library = object.deviceType.source;
      expect(library).toMatchObject({
        patchEligible: false,
        origin: { kind: "library" },
        reason: expect.any(String),
      });
      // Library files are listed with guards, yet are not patchable.
      expect(sourceFiles).toContainEqual({
        file: library.file,
        integrity: library.integrity,
      });
      const run = await agent(
        "apply-source-patch",
        guardedPatch(library, [
          { op: "test", path: `${library.pointer}/id`, value: object.typeId },
        ]),
        project,
      );
      expect(run.report.error).toMatchObject({ code: "A003" });
    },
  },
  {
    claim: `Pointers are pre-patch positions: immediately before each object's edits add \`${UID_TEST}\`; escape appended segments (\`~\`→\`~0\`, \`/\`→\`~1\`).`,
    async check() {
      const fresh = async () => {
        const project = await freshProject("starter");
        const plc = (await starterPlc()).object.source;
        expect(plc.pointer).toBe("/objects/1");
        return { project, plc };
      };
      // Tests placed first all pass, then the insertion shifts PLC1 and its
      // pre-patch pointer edits PS1 instead.
      const first = await fresh();
      const testsFirst = await agent(
        "apply-source-patch",
        guardedPatch(
          first.plc,
          [
            uidTest(first.plc),
            insertDevice,
            describeOp(first.plc, "Meant for PLC1"),
          ],
          false,
        ),
        first.project,
      );
      expect(testsFirst.code, describeRun(["tests first"], testsFirst)).toBe(0);
      const objects = (await readJson(join(first.project, first.plc.file)))
        .objects;
      expect(objects[1]).toMatchObject({
        designation: "PS1",
        description: "Meant for PLC1",
      });
      // Immediately before each object's edits, the test refuses the shift.
      const second = await fresh();
      const before = await hashTree(second.project);
      const guarded = await agent(
        "apply-source-patch",
        guardedPatch(
          second.plc,
          [
            insertDevice,
            uidTest(second.plc),
            describeOp(second.plc, "Meant for PLC1"),
          ],
          false,
        ),
        second.project,
      );
      expect(guarded.report.error).toMatchObject({
        code: "A002",
        reason: "test-failed",
        operationIndex: 1,
      });
      expect(await hashTree(second.project)).toEqual(before);

      // An appended key segment containing `/` and `~` must be escaped.
      const project = await makeProject({
        name: "escaping",
        json: {
          "system.json": {
            format: "electrical-system/0.1",
            project: { name: "Escaping" },
            sources: ["sources/a.json"],
            libraries: [{ name: "escape", version: "1.0.0", path: "library" }],
          },
          "library/library.json": {
            name: "escape",
            version: "1.0.0",
            sources: ["types.json"],
          },
          "library/types.json": {
            types: [
              {
                kind: "device_type",
                id: "escape:keys",
                terminals: { "a/b~c": { description: "escaped terminal" } },
                functions: { f: { kind: "other", terminals: ["a/b~c"] } },
                connectionCoverage: {
                  status: "complete",
                  notes: "Guide escape fixture",
                },
              },
            ],
          },
          "sources/a.json": {
            objects: [
              {
                kind: "device",
                uid: randomUUID(),
                designation: "LS1",
                type: "escape:keys",
              },
            ],
          },
        },
      });
      await lockAndValidate(project);
      const ls1 = (await inspectSource(project, "LS1")).object.source;
      const review = (segment: string) =>
        guardedPatch(ls1, [
          uidTest(ls1),
          {
            op: "add",
            path: `${ls1.pointer}/connectionReview`,
            value: { terminals: {} },
          },
          {
            op: "add",
            path: `${ls1.pointer}/connectionReview/terminals/${segment}`,
            value: { status: "deferred", reason: "Feed TBD" },
          },
        ]);
      const escaped = await agent(
        "apply-source-patch",
        review("a~1b~0c"),
        project,
      );
      expect(escaped.code, describeRun(["escaped"], escaped)).toBe(0);
      expect(escaped.report.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "W905",
          message: expect.stringContaining("LS1.a/b~c"),
        }),
      );
      for (const segment of ["a/b~c", "a~1b~c"]) {
        const raw = await agent("apply-source-patch", review(segment), project);
        expect(raw.report.error, segment).toMatchObject({
          code: "A002",
          reason: "invalid-pointer",
        });
      }
    },
  },
  {
    claim: "After A004, re-inspect and rebuild.",
    async check() {
      const project = await freshProject("starter");
      const source = (await starterPlc()).object.source;
      const edit = (s: any, value: string) =>
        guardedPatch(s, [uidTest(s), describeOp(s, value)], false);
      expect(
        (await agent("apply-source-patch", edit(source, "First"), project))
          .code,
      ).toBe(0);
      const stale = await agent(
        "apply-source-patch",
        edit(source, "Second"),
        project,
      );
      expect(stale.report.error).toMatchObject({
        code: "A004",
        expectedIntegrity: source.integrity,
        actualIntegrity: integrity(await readFile(join(project, source.file))),
      });
      const rebuilt = (await inspectSource(project, "PLC1")).object.source;
      expect(rebuilt.integrity).toBe(stale.report.error.actualIntegrity);
      const applied = await agent(
        "apply-source-patch",
        edit(rebuilt, "Second"),
        project,
      );
      expect(applied.code, describeRun(["rebuilt"], applied)).toBe(0);
    },
  },
  {
    claim:
      "When compilation fails (no guards returned), hash the raw source bytes and guard a schema or semantic repair with UID tests; see `thermite guide agent-requests`. Invalid JSON needs an ordinary edit, then validation.",
    async check() {
      const project = await freshProject("starter");
      // A wire to a missing device: the sources load but do not compile.
      await editJson(join(project, WIRES), (file) => {
        file.objects[0].endpoints[1].device = "PLC9";
      });
      const failed = await agent(
        "inspect",
        withSource({ selector: { by: "designation", value: "PLC1" } }),
        project,
      );
      expect(failed.code).toBe(1);
      expect(failed.result).toBeUndefined();
      expect(codesOf(failed)).toContain("E101");
      // The hash recipe's value (the fenced-block test checks the recipe
      // prints exactly this) guards the repair.
      const device = "/objects/0/endpoints/1/device";
      const repaired = await agent(
        "apply-source-patch",
        await patchRequest(
          project,
          WIRES,
          [
            { op: "test", path: device, value: "PLC9" },
            { op: "replace", path: device, value: "PLC1" },
          ],
          false,
        ),
        project,
      );
      expect(repaired.code, describeRun(["repair"], repaired)).toBe(0);
      // Once it compiles, guards return.
      expect(
        (await inspectSource(project, "PLC1")).object.source,
      ).toMatchObject({ patchEligible: true });
      // Schema errors use the same hashed, UID-tested loop; syntax errors
      // cannot be patched and need an ordinary JSON edit first.
      const plc = (await starterPlc()).object.source;
      const cases = [
        {
          code: "E002",
          broken: (text: string) => text.replace(/\}\s*$/, ""),
          operations: [
            uidTest(plc),
            { op: "replace", path: "/objects/1/designation", value: "PLC1" },
          ],
        },
        {
          code: "E012",
          broken: (text: string) => {
            const file = JSON.parse(text);
            file.objects[1].unexpected = true;
            return JSON.stringify(file, null, 2);
          },
          operations: [
            uidTest(plc),
            { op: "remove", path: "/objects/1/unexpected" },
          ],
        },
        {
          code: "E013",
          broken: (text: string) =>
            text.replace(plc.uid, plc.uid.toUpperCase()),
          operations: [
            uidTest({ ...plc, uid: plc.uid.toUpperCase() }),
            { op: "replace", path: "/objects/1/uid", value: plc.uid },
          ],
        },
      ];
      await parallel(cases, async ({ code, broken, operations }) => {
        const copy = await freshProject("starter");
        const path = join(copy, plc.file);
        const original = await readFile(path, "utf8");
        expect(plc.uid).not.toBe(plc.uid.toUpperCase());
        await writeFile(path, broken(original));
        const before = await hashTree(copy);
        const input = await patchRequest(copy, plc.file, operations, true);
        const dry = await agent("apply-source-patch", input, copy);
        expect(await hashTree(copy), code).toEqual(before);
        if (code === "E002") {
          expect(dry.code).toBe(1);
          expect(dry.report.error).toMatchObject({
            code: "A006",
            file: plc.file,
          });
          expect(codesOf(dry)).toContain(code);
          await writeFile(path, original);
        } else {
          expect(dry.code, describeRun(["schema repair dry-run"], dry)).toBe(0);
          const applied = await agent(
            "apply-source-patch",
            { ...input, dryRun: false },
            copy,
          );
          expect(
            applied.code,
            describeRun(["schema repair apply"], applied),
          ).toBe(0);
        }
        expect((await ok(["validate", "."], copy)).code, code).toBe(0);
      });
    },
  },
];
