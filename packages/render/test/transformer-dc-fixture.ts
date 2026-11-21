import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject } from "@thermite/compiler";
import { transformerRoot } from "./transformer-control-fixture.js";
export const dcNames = [
  ["T2", "T1"],
  ["G1", "T1"],
  ["PS1", "T1"],
  ["PS1", "A9"],
] as const;
export type DcBranch = "direct" | "contact" | "mixed" | "missing-base-input";
export async function dcTransformerFixture(
  supply: string,
  transformer: string,
  branch: DcBranch,
  reordered = false,
) {
  const root = await mkdtemp(join(tmpdir(), "thermite-dc-transformer-"));
  try {
    await cp(transformerRoot, root, { recursive: true });
    const source = JSON.parse(
      await readFile(join(root, "source.json"), "utf8"),
    );
    source.objects = source.objects.filter(
      (o: any) => o.kind !== "wire" || ["W1", "W2"].includes(o.designation),
    );
    let n = 900;
    const uid = () =>
      `62d10000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const wire = (designation: string, a: string, b: string) =>
      source.objects.push({
        kind: "wire",
        uid: uid(),
        designation,
        endpoints: [a, b].map((s) => {
          const i = s.lastIndexOf(".");
          return { device: s.slice(0, i), terminal: s.slice(i + 1) };
        }),
      });
    for (const o of source.objects) {
      if (o.designation === "T1") o.designation = transformer;
      for (const e of o.endpoints ?? [])
        if (e.device === "T1") e.device = transformer;
    }
    source.objects.push({
      kind: "device",
      uid: uid(),
      designation: supply,
      type: "core:psu-24vdc",
    });
    const strip = source.objects.find((o: any) => o.designation === "XT1");
    delete strip.connectionReview.terminals["3"];
    delete strip.connectionReview.terminals["4"];
    wire("WL", `${supply}.L`, "XT1.3");
    wire("WN", `${supply}.N`, "XT1.4");
    if (branch !== "missing-base-input") wire("WA", `${supply}.+`, "R1.A1");
    wire("WB", `${supply}.-`, "R1.A2");
    if (branch !== "missing-base-input")
      wire("WC", `${transformer}.X2`, "R1.A2");
    if (branch === "contact") {
      source.objects.push({
        kind: "device",
        uid: uid(),
        designation: "K2",
        type: "core:relay-1co",
      });
      wire("WD", "R1.A1", "K2.11");
      wire("WE", "K2.14", `${transformer}.X1`);
    }
    if (branch === "mixed" || branch === "missing-base-input")
      wire("WD", `${transformer}.X1`, "R1.A1");
    if (reordered) {
      for (const o of source.objects) o.uid = uid();
      source.objects.reverse();
    }
    await writeFile(join(root, "source.json"), JSON.stringify(source));
    const c = await compileProject(root);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    return {
      root,
      ir: c.ir,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
