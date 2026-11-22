import { expect, it } from "vitest";
import { compileProject } from "@thermite/compiler";
import { createQueryEngine } from "@thermite/query";
import {
  createInternalApplySourcePatchTool,
  defaultApplySourcePatchDependencies as defaults,
  type ApplySourcePatchDependencies,
} from "../src/apply-source-patch.js";
import { captureProjectControlledSnapshot } from "../src/patch-filesystem.js";
import { reserveProjectWrite } from "../src/project-write-lock.js";
import { createInternalReadTools } from "../src/read-tools.js";
import {
  expectExplained,
  failureExplanationFixture,
  fault,
  failAt,
} from "./failure-explanation-fixture.js";

type Injection = (
  d: ApplySourcePatchDependencies,
  hit: () => void,
) => ApplySourcePatchDependencies;
const cases: [string, Injection][] = [
  [
    "project load",
    (d, hit) => ({ ...d, loadProject: failAt(d.loadProject, 1, hit) }),
  ],
  [
    "precommit load",
    (d, hit) => ({ ...d, loadProject: failAt(d.loadProject, 2, hit) }),
  ],
  [
    "staged compile",
    (d, hit) => ({ ...d, compileProject: failAt(d.compileProject, 1, hit) }),
  ],
  [
    "stage creation",
    (d, hit) => ({
      ...d,
      filesystem: {
        ...d.filesystem,
        mkdtemp: failAt(d.filesystem.mkdtemp, 1, hit),
      },
    }),
  ],
  [
    "copy",
    (d, hit) => ({
      ...d,
      filesystem: {
        ...d.filesystem,
        copyFile: failAt(d.filesystem.copyFile, 1, hit),
      },
    }),
  ],
  [
    "cleanup",
    (d, hit) => ({
      ...d,
      filesystem: { ...d.filesystem, rm: failAt(d.filesystem.rm, 1, hit) },
    }),
  ],
  [
    "enumeration",
    (d, hit) => ({
      ...d,
      filesystem: {
        ...d.filesystem,
        readdir: failAt(d.filesystem.readdir, 1, hit),
      },
    }),
  ],
  [
    "stage write",
    (d, hit) => ({
      ...d,
      filesystem: {
        ...d.filesystem,
        writeFile: failAt(d.filesystem.writeFile, 1, hit),
      },
    }),
  ],
  [
    "scan",
    (d, hit) => ({
      ...d,
      scanProjectTree: async () => {
        hit();
        throw fault();
      },
    }),
  ],
  [
    "initial snapshot",
    (d, hit) => ({
      ...d,
      captureSnapshot: failAt(
        (p) => captureProjectControlledSnapshot(p, d.filesystem),
        1,
        hit,
      ),
    }),
  ],
  [
    "precommit snapshot",
    (d, hit) => ({
      ...d,
      captureSnapshot: failAt(
        (p) => captureProjectControlledSnapshot(p, d.filesystem),
        2,
        hit,
      ),
    }),
  ],
  [
    "reservation",
    (d, hit) => ({
      ...d,
      reserveProjectWrite: () => {
        hit();
        throw fault();
      },
    }),
  ],
  [
    "release after success",
    (d, hit) => ({
      ...d,
      reserveProjectWrite: (p) => {
        const reserved = reserveProjectWrite(p);
        return !reserved.ok
          ? reserved
          : {
              ...reserved,
              release: () => {
                reserved.release();
                hit();
                throw fault();
              },
            };
      },
    }),
  ],
  [
    "first commit write",
    (d, hit) => ({
      ...d,
      writeFileAtomically: failAt(d.writeFileAtomically, 1, hit),
    }),
  ],
  [
    "second commit write",
    (d, hit) => ({
      ...d,
      writeFileAtomically: failAt(d.writeFileAtomically, 2, hit),
    }),
  ],
  [
    "second commit and rollback",
    (d, hit) => {
      let calls = 0;
      return {
        ...d,
        writeFileAtomically: async (...args) => {
          if (++calls >= 2) {
            hit();
            throw fault();
          }
          return d.writeFileAtomically(...args);
        },
      };
    },
  ],
  [
    "source-chain exception",
    (d, hit) => ({
      ...d,
      validateSourceChain: async () => {
        hit();
        throw fault();
      },
    }),
  ],
  [
    "source-chain refusal",
    (d, hit) => ({
      ...d,
      validateSourceChain: async () => {
        hit();
        return false;
      },
    }),
  ],
  [
    "lstat",
    (d, hit) => ({
      ...d,
      filesystem: {
        ...d.filesystem,
        lstat: failAt(d.filesystem.lstat, 3, hit),
      },
    }),
  ],
  [
    "realpath",
    (d, hit) => ({
      ...d,
      filesystem: {
        ...d.filesystem,
        realpath: failAt(d.filesystem.realpath, 1, hit),
      },
    }),
  ],
  [
    "readFile",
    (d, hit) => ({
      ...d,
      filesystem: {
        ...d.filesystem,
        readFile: failAt(d.filesystem.readFile, 1, hit),
      },
    }),
  ],
];

it.each(cases)("explains schema-repair failure at %s", async (name, inject) => {
  const { fixture, input } = await failureExplanationFixture();
  try {
    let hit = false;
    const result = await createInternalApplySourcePatchTool(
      {},
      inject(defaults, () => {
        hit = true;
      }),
    ).applySourcePatch(input);
    expect(hit, name).toBe(true);
    if (name === "release after success") {
      expect(result.ok).toBe(true);
      expect(result.diagnostics.some((d) => d.code === "W801")).toBe(true);
    } else {
      expectExplained(result);
      if (!result.ok && result.error === null)
        expect(
          result.diagnostics.some(
            (d) => d.code === "E001" && d.message.includes("EFAULT"),
          ),
        ).toBe(true);
    }
  } finally {
    await fixture.cleanup();
  }
});

const requests = {
  resolve: { target: { by: "designation", value: "TARGET" } },
  inspect: { selector: { by: "designation", value: "TARGET" } },
  query: {
    query: {
      operation: "neighbors",
      selector: { by: "designation", value: "TARGET" },
    },
  },
  validate: {},
  createView: {
    spec: {
      format: "schematic-view-request/0.2",
      root: { by: "designation", value: "TARGET" },
      intent: { kind: "loads" },
      flow: "left-to-right",
    },
  },
} as const;

it.each(Object.keys(requests) as (keyof typeof requests)[])(
  "explains %s compiler failures and exceptions",
  async (name) => {
    const { fixture } = await failureExplanationFixture();
    try {
      const input = {
        format: "agent-tool-request/0.1",
        project: fixture.projectRoot,
        ...requests[name],
      } as never;
      expectExplained(await createInternalReadTools()[name](input));
      const thrown = createInternalReadTools(
        {},
        {
          compileProject: async () => {
            throw fault();
          },
          createQueryEngine,
        },
      );
      expectExplained(await thrown[name](input));
    } finally {
      await fixture.cleanup();
    }
  },
);

it("explains read-tool query/render exceptions", async () => {
  const { fixture, input } = await failureExplanationFixture();
  try {
    expect(
      (await createInternalApplySourcePatchTool().applySourcePatch(input)).ok,
    ).toBe(true);
    const tools = createInternalReadTools(
      {},
      {
        compileProject,
        createQueryEngine: () => {
          throw fault();
        },
        renderSchematic: async () => {
          throw fault();
        },
      },
    );
    for (const name of ["resolve", "inspect", "query", "createView"] as const)
      expectExplained(
        await tools[name]({
          format: "agent-tool-request/0.1",
          project: fixture.projectRoot,
          ...requests[name],
        } as never),
      );
  } finally {
    await fixture.cleanup();
  }
});
