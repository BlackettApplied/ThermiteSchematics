import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";
export const transformerRoot =
  "packages/core-library/test/fixtures/transformer-control";
export const transformerFlows = ["left-to-right", "top-to-bottom"] as const;
export const transformerRequest = (
  flow: (typeof transformerFlows)[number],
  root = "R1",
) => ({
  format: "schematic-view-request/0.1" as const,
  root: { by: "designation" as const, value: root },
  family: "control" as const,
  flow,
});
export async function transformerFixture(mode = "normal") {
  const root = await mkdtemp(join(tmpdir(), "thermite-transformer-"));
  try {
    await cp(transformerRoot, root, { recursive: true });
    const source = JSON.parse(
      await readFile(join(root, "source.json"), "utf8"),
    );
    const system = JSON.parse(
      await readFile(join(root, "system.json"), "utf8"),
    );
    let n = 100;
    const uid = () =>
      `62000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const wire = (name: string, a: string, b: string) =>
      source.objects.push({
        kind: "wire",
        uid: uid(),
        designation: name,
        endpoints: [a, b].map((s) => {
          const [device, terminal] = s.split(".");
          return { device, terminal };
        }),
      });
    if (mode === "matrix")
      for (const o of source.objects) {
        if (o.designation === "T1") o.designation = "DUT";
        for (const e of o.endpoints ?? [])
          if (e.device === "T1") e.device = "DUT";
      }
    const endpoint = (wire: string) =>
      source.objects.find((o: any) => o.designation === wire).endpoints[0];
    if (mode === "reversed")
      for (const name of ["W3", "W4", "W5", "W6"])
        endpoint(name).terminal = ["W3", "W5"].includes(name) ? "X2" : "X1";
    if (mode === "same") endpoint("W4").terminal = "X1";
    if (mode === "short") wire("W-short", "T1.X1", "T1.X2");
    if (mode === "no-input")
      source.objects = source.objects.filter(
        (o: any) => o.designation !== "W3",
      );
    if (mode === "no-return")
      source.objects = source.objects.filter(
        (o: any) => o.designation !== "W4",
      );
    if (["cross-device", "ambiguous", "blocked", "far-pair"].includes(mode)) {
      source.objects.push({
        kind: "device",
        uid: uid(),
        designation: "T2",
        type: "core:control-transformer",
      });
      if (
        mode === "cross-device" ||
        mode === "blocked" ||
        mode === "far-pair"
      ) {
        endpoint("W4").device = "T2";
        if (mode === "blocked") wire("W7", "T1.X1", "T2.X1");
        if (mode === "far-pair") {
          wire("W7", "R1.A1", "XT1.3");
          wire("W8", "XT1.3", "T2.X1");
          wire("W9", "R1.A2", "XT1.4");
          wire("W10", "XT1.4", "T1.X2");
        }
      } else {
        wire("W7", "T2.X1", "R1.A1");
        wire("W8", "T2.X2", "R1.A2");
      }
    }
    if (
      [
        "mixed",
        "array-reversed",
        "renamed",
        "missing-roles",
        "wrong-shape",
      ].includes(mode)
    ) {
      const t = JSON.parse(
        await readFile(
          "packages/core-library/versions/0.2.0/types/control-transformer.json",
          "utf8",
        ),
      ).types[0];
      t.id = "local:winding";
      source.objects.find((o: any) => o.designation === "T1").type = t.id;
      if (mode === "mixed") {
        t.terminals.Y1 = { role: "secondary" };
        t.terminals.Y2 = { role: "secondary" };
        t.functions.another = { kind: "source", terminals: ["Y1", "Y2"] };
        endpoint("W4").terminal = "Y2";
      }
      if (mode === "array-reversed") t.functions.secondary.terminals.reverse();
      if (mode === "missing-roles") {
        delete t.terminals.X1.role;
        delete t.terminals.X2.role;
      }
      if (mode === "wrong-shape") {
        t.functions.secondary.kind = "other";
        t.internal_relations = [];
      }
      if (mode === "renamed") {
        t.functions.output = t.functions.secondary;
        delete t.functions.secondary;
        t.internal_relations = [];
        t.terminals.P = t.terminals.X1;
        t.terminals.Q = t.terminals.X2;
        delete t.terminals.X1;
        delete t.terminals.X2;
        t.functions.output.terminals = ["Q", "P"];
        for (const o of source.objects) {
          if (o.designation === "T1") o.designation = "Z77";
          if (o.designation === "R1") o.designation = "RY9";
          for (const e of o.endpoints ?? []) {
            if (e.device === "T1") {
              e.device = "Z77";
              e.terminal =
                e.terminal === "X1"
                  ? "P"
                  : e.terminal === "X2"
                    ? "Q"
                    : e.terminal;
            }
            if (e.device === "R1") e.device = "RY9";
          }
          o.uid = uid();
        }
        source.objects.reverse();
      }
      await mkdir(join(root, "local"));
      await writeFile(
        join(root, "local/library.json"),
        JSON.stringify({
          name: "local",
          version: "0.1.0",
          sources: ["types.json"],
        }),
      );
      await writeFile(
        join(root, "local/types.json"),
        JSON.stringify({ types: [t] }),
      );
      system.libraries.push({ name: "local", version: "0.1.0", path: "local" });
    }
    await writeFile(join(root, "source.json"), JSON.stringify(source));
    await writeFile(join(root, "system.json"), JSON.stringify(system));
    if (system.libraries.length > 1) {
      const l = await lockProject(root);
      if (!l.ok) throw Error(JSON.stringify(l.diagnostics));
    }
    const c = await compileProject(root);
    if (!c.ok) throw Error(JSON.stringify(c.diagnostics));
    return {
      root,
      ir: c.ir,
      diagnostics: c.diagnostics,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
