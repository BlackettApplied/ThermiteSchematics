import type { ElkLayoutOptionDescription } from "elkjs/lib/elk-api.js";
import { afterEach, expect, it, vi } from "vitest";
import {
  circuitInlineContext,
  circuitLayoutContext,
} from "../src/layout/circuit-inline-context.js";
import {
  validateElkRuntimeOptions,
  validateLayoutOptions,
} from "../src/layout/elk-contract.js";
import { defaultElkMetadata } from "../src/layout/elk-metadata.js";
import { createElkEngine } from "../src/layout/elk-runtime.js";
import { elkWorkLedger, elkWorkScope } from "../src/layout/elk-work.js";
import { ELK_OPTIONS } from "../src/layout/options.js";
import {
  layoutPresentationGraph,
  type ElkAdapterBuild,
} from "../src/layout/elk-adapter.js";
import { buildPresentationGraph } from "../src/presentation.js";
import { compileCoreFixture, selectCoreSubgraph } from "./fixtures.js";

const build: ElkAdapterBuild = {
  graph: { id: "root", children: [{ id: "leaf" }] },
  optionAssignments: [
    {
      targetKind: "parent",
      targetId: "root",
      option: ELK_OPTIONS.direction,
      value: "RIGHT",
    },
  ],
};

function metadata() {
  const prototype = Reflect.getPrototypeOf(createElkEngine());
  if (!prototype) throw new Error("Missing ELK prototype");
  return vi.spyOn(prototype, "knownLayoutOptions");
}

afterEach(() => vi.restoreAllMocks());

it("queries pinned metadata once per render, sharing concurrent default engines", async () => {
  const native = metadata();
  const render = () =>
    circuitInlineContext.run(circuitLayoutContext(), async () => {
      const [first, second] = await Promise.all([
        validateElkRuntimeOptions(build),
        validateElkRuntimeOptions(build),
      ]);
      expect(first).toEqual(second);
      expect(first).toEqual([
        {
          id: ELK_OPTIONS.direction,
          type: "ENUM",
          targets: ["PARENTS"],
        },
      ]);
    });
  await render();
  expect(native).toHaveBeenCalledTimes(1);
  await render();
  expect(native).toHaveBeenCalledTimes(2);
});

it("isolates cached metadata from public engine queries and caller snapshots", async () => {
  const native = metadata(),
    engine = createElkEngine(),
    reader = defaultElkMetadata(engine);
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    const original = structuredClone(
      await validateElkRuntimeOptions(build, reader),
    );
    const cached = await reader.knownLayoutOptions();
    const entry = cached.find((d) => d.id === ELK_OPTIONS.direction);
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Missing direction metadata");
    expect(Reflect.set(entry, "type", "WRONG")).toBe(false);
    if (!entry.targets) throw new Error("Missing metadata targets");
    expect(Reflect.set(entry.targets, 0, "WRONG")).toBe(false);
    const queried = await engine.knownLayoutOptions();
    queried.splice(0);
    const snapshot = await validateElkRuntimeOptions(build, reader);
    const direction = snapshot[0];
    if (!direction) throw new Error("Missing direction snapshot");
    Reflect.set(direction.targets, 0, "WRONG");
    await expect(validateElkRuntimeOptions(build, reader)).resolves.toEqual(
      original,
    );
    expect(native).toHaveBeenCalledTimes(2);
  });
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    await expect(validateElkRuntimeOptions(build, reader)).resolves.toEqual([
      { id: ELK_OPTIONS.direction, type: "ENUM", targets: ["PARENTS"] },
    ]);
  });
  expect(native).toHaveBeenCalledTimes(3);
  await reader.knownLayoutOptions();
  await reader.knownLayoutOptions();
  expect(native).toHaveBeenCalledTimes(5);
});

it("validates each later request and preserves target-before-metadata failure order", async () => {
  const native = metadata();
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    await validateElkRuntimeOptions(build);
    const wrongTarget: ElkAdapterBuild = {
      ...build,
      optionAssignments: [
        {
          ...build.optionAssignments[0],
          targetKind: "parent",
          targetId: "missing",
          option: "invalid-option",
          value: "1",
        },
      ],
    };
    await expect(validateElkRuntimeOptions(wrongTarget)).rejects.toThrow(
      new Error(
        "ELK adapter invariant: invalid-option targets non-parent missing",
      ),
    );
    await expect(
      validateElkRuntimeOptions({
        ...build,
        optionAssignments: [
          {
            targetKind: "node",
            targetId: "leaf",
            option: ELK_OPTIONS.direction,
            value: "DOWN",
          },
        ],
      }),
    ).rejects.toThrow(
      new Error(`ELK option ${ELK_OPTIONS.direction} cannot target node leaf.`),
    );
    await expect(
      validateElkRuntimeOptions({
        ...wrongTarget,
        optionAssignments: [
          {
            targetKind: "parent",
            targetId: "root",
            option: "invalid-option",
            value: "1",
          },
        ],
      }),
    ).rejects.toThrow(
      new Error("ELK option metadata is missing invalid-option."),
    );
    expect(native).toHaveBeenCalledTimes(1);
  });
});

it("keeps injected engines separate and rechecks their changing metadata", async () => {
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    await validateElkRuntimeOptions(build);
    const custom = createElkEngine();
    const descriptions: ElkLayoutOptionDescription[] = [];
    const query = vi.fn(async () => structuredClone(descriptions));
    custom.knownLayoutOptions = query;
    await expect(validateElkRuntimeOptions(build, custom)).rejects.toThrow(
      new Error(`ELK option metadata is missing ${ELK_OPTIONS.direction}.`),
    );
    descriptions.push({
      id: ELK_OPTIONS.direction,
      type: "INT",
      targets: ["PARENTS"],
    });
    await expect(validateElkRuntimeOptions(build, custom)).rejects.toThrow(
      new Error(
        `ELK option ${ELK_OPTIONS.direction} has type INT; expected ENUM.`,
      ),
    );
    descriptions.splice(0, 1, {
      id: ELK_OPTIONS.direction,
      type: "ENUM",
      targets: ["PARENTS"],
    });
    expect(await validateElkRuntimeOptions(build, custom)).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(3);
  });
});

it("does not cache a metadata failure or query metadata before a bad target", async () => {
  const failure = new Error("metadata unavailable"),
    native = metadata();
  native.mockRejectedValueOnce(failure);
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    await expect(
      validateElkRuntimeOptions({
        ...build,
        optionAssignments: [
          {
            targetKind: "parent",
            targetId: "missing",
            option: ELK_OPTIONS.direction,
            value: "RIGHT",
          },
        ],
      }),
    ).rejects.toThrow(
      new Error(
        `ELK adapter invariant: ${ELK_OPTIONS.direction} targets non-parent missing`,
      ),
    );
    expect(native).not.toHaveBeenCalled();
    await expect(validateElkRuntimeOptions(build)).rejects.toBe(failure);
    await expect(validateElkRuntimeOptions(build)).resolves.toHaveLength(1);
    expect(native).toHaveBeenCalledTimes(2);
  });
});

it("leaves logical work, layout hits and exhaustion independent of metadata warmth", async () => {
  const native = metadata();
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    const engine = createElkEngine(),
      work = elkWorkLedger("metadata", 2),
      reader = defaultElkMetadata(engine);
    await elkWorkScope.run(work, async () => {
      for (let i = 0; i < 2; i++) {
        await validateElkRuntimeOptions(build, reader);
        await engine.layout({ id: "root" });
      }
      expect(work).toMatchObject({ calls: 2, dispatches: 1, cacheHits: 1 });
      await validateElkRuntimeOptions(build, reader);
      await expect(engine.layout({ id: "root" })).rejects.toThrow(
        "Shared logical ELK layout budget exhausted.",
      );
      expect(work).toMatchObject({ calls: 2, dispatches: 1, cacheHits: 1 });
      expect(native).toHaveBeenCalledTimes(1);
    });
  });
});

it("adapter dispatch reuses only its own default engine metadata", async () => {
  const native = metadata(),
    engine = createElkEngine();
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    await validateLayoutOptions(build, engine);
    await validateLayoutOptions(build, createElkEngine());
    expect(native).toHaveBeenCalledTimes(1);
    const injected = createElkEngine();
    const query = vi.fn(async () => []);
    injected.knownLayoutOptions = query;
    for (let i = 0; i < 2; i++)
      await expect(
        validateLayoutOptions(build, injected, injected),
      ).rejects.toThrow(
        new Error(`ELK option metadata is missing ${ELK_OPTIONS.direction}.`),
      );
    expect(query).toHaveBeenCalledTimes(2);
  });
});

it("actual adapter requests reuse metadata while keeping valid layout results", async () => {
  const ir = await compileCoreFixture();
  const presentation = buildPresentationGraph({
    ir,
    selected: selectCoreSubgraph(ir, "K1", "control", "left-to-right"),
  });
  expect(presentation.ok).toBe(true);
  if (!presentation.ok) throw new Error("Missing presentation");
  const native = metadata();
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    const first = await layoutPresentationGraph(presentation.value.graph);
    const second = await layoutPresentationGraph(presentation.value.graph);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(native).toHaveBeenCalledTimes(1);
    const injected = createElkEngine(),
      query = vi.fn(async () => []);
    injected.knownLayoutOptions = query;
    await expect(
      layoutPresentationGraph(presentation.value.graph, { engine: injected }),
    ).rejects.toThrow(
      new Error(`ELK option metadata is missing ${ELK_OPTIONS.algorithm}.`),
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});

it("copies native metadata before freezing it, leaving provider-owned data mutable", async () => {
  const row = { id: ELK_OPTIONS.direction, type: "ENUM", targets: ["PARENTS"] };
  const source = [row];
  const native = metadata().mockResolvedValue(source);
  await circuitInlineContext.run(circuitLayoutContext(), async () => {
    const original = structuredClone(await validateElkRuntimeOptions(build));
    expect(Reflect.set(row, "type", "WRONG")).toBe(true);
    row.targets.splice(0);
    source.splice(0);
    await expect(validateElkRuntimeOptions(build)).resolves.toEqual(original);
    expect(native).toHaveBeenCalledTimes(1);
  });
});
