import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileProject } from "@thermite/compiler";
import { applyDolRecipe } from "./dol-control-probes-fixture.js";
export type DolCase =
  "saved" | "p4" | "p5" | "rm3" | "fuse-short" | "fuse-equal" | "rail-contacts";
export const flows = ["left-to-right", "top-to-bottom"] as const;
export const actuation = (root: string, flow: (typeof flows)[number]) => ({
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: root },
  family: "control" as const,
  flow,
});
export async function dolFixture(name: DolCase, reordered = false) {
  const root = await mkdtemp(join(tmpdir(), "thermite-dol-junction-"));
  try {
    await cp(
      `packages/core-library/test/fixtures/${name === "rm3" ? "rm3" : "dol-starter"}`,
      root,
      { recursive: true },
    );
    const path = join(root, name === "rm3" ? "starter.json" : "source.json"),
      original = JSON.parse(
        await readFile(
          name.startsWith("fuse-") || name === "rail-contacts"
            ? new URL(
                `./fixtures/dol-control-junctions/${name}.json`,
                import.meta.url,
              )
            : path,
          "utf8",
        ),
      );
    const source =
      name === "p4" || name === "p5"
        ? applyDolRecipe(original, name)
        : original;
    if (reordered) {
      const ids = new Map(
        source.objects.map((o: any, i: number) => [
          o.uid,
          `63000000-0000-4000-8000-${String(1000 - i).padStart(12, "0")}`,
        ]),
      );
      const remap = (v: any): any =>
        typeof v === "string"
          ? (ids.get(v) ?? v)
          : Array.isArray(v)
            ? v.map(remap)
            : v && typeof v === "object"
              ? Object.fromEntries(
                  Object.entries(v).map(([k, x]) => [k, remap(x)]),
                )
              : v;
      source.objects = remap(source.objects).reverse();
    }
    await writeFile(path, JSON.stringify(source));
    const compiled = await compileProject(root);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    return {
      ir: compiled.ir,
      root,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
