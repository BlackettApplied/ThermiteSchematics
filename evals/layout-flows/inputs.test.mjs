import { expect, it } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { flowVariant, withoutFlow, population } from "./inputs.mjs";
it("covers every tracked library example and every corpus request twice", async () => {
  const actual = await population(resolve(".")),
    expected = execFileSync("git", ["ls-files", "libraries"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((p) => /^libraries\/[^/]+\/examples\/.+\/system\.json$/u.test(p))
      .map((p) => p.slice(0, -"/system.json".length))
      .sort();
  expect(
    actual
      .filter((s) => s.kind === "library")
      .map((s) => s.project)
      .sort(),
  ).toEqual(expected);
  expect(actual.filter((s) => s.kind === "corpus")).toHaveLength(124);
  expect(actual.length * 2).toBe((expected.length + 124) * 2);
  for (const spec of actual.filter((s) => s.kind === "library")) {
    expect(spec.project).not.toContain("\\");
    expect([
      `${spec.project}/packet.request.json`,
      `${spec.project}/packet.json`,
    ]).toContain(spec.request);
    expect(
      JSON.parse(await readFile(join(resolve("."), spec.request), "utf8"))
        .views,
    ).toBeInstanceOf(Array);
  }
});
it("changes only eligible flow fields and preserves the authored paper and selections", async () => {
  const root = resolve("."),
    dest = await mkdtemp(join(tmpdir(), "layout-flow-")),
    request = JSON.parse(
      await readFile(
        join(root, "examples/operator-console/packet.request.json"),
        "utf8",
      ),
    ),
    circuit = JSON.parse(
      await readFile(
        join(
          root,
          "libraries/siemens-pilot/examples/6es7132-4bb31-0aa0/packet.request.json",
        ),
        "utf8",
      ),
    );
  request.views.unshift(...circuit.views);
  const before = JSON.stringify(request);
  try {
    const variant = await flowVariant(
      { project: "examples/operator-console" },
      request,
      "top-to-bottom",
      root,
      dest,
      async () => {
        throw Error("Unexpected lock");
      },
    );
    expect(withoutFlow(variant)).toEqual(withoutFlow(request));
    expect(JSON.stringify(request)).toBe(before);
    expect(
      variant.views
        .filter((v) => v.format === "circuit-view-request/0.1")
        .map((v) => v.flow),
    ).toEqual(
      request.views
        .filter((v) => v.format === "circuit-view-request/0.1")
        .map(() => "top-to-bottom"),
    );
    for (const v of variant.views.filter(
      (v) => v.format === "wiring-view-request/0.1",
    ))
      expect(Object.hasOwn(v, "flow")).toBe(false);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});
