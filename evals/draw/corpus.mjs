import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { hash, json, readJson, command } from "./support.mjs";
import * as requests from "./corpus/requests.mjs";
const flows = ["left-to-right", "top-to-bottom"];
export function cases(quick = false) {
  const list = [];
  const add = (id, project, request, recipe) => {
    for (const flow of flows)
      list.push({
        id: `${id}-${flow}`,
        project,
        request:
          id === "functional-symbols" && flow === "top-to-bottom"
            ? "examples/functional-symbols/packet-top-to-bottom.request.json"
            : request,
        recipe,
        flow,
      });
  };
  add(
    "init-starter",
    "packages/cli/templates/starter-default",
    requests.starter,
    "starter",
  );
  add(
    "machine-demo",
    "examples/machine-demo",
    "examples/machine-demo/packet.request.json",
  );
  add("conveyor-line", "examples/conveyor-line", requests.conveyor);
  add(
    "motor-starter",
    "examples/motor-starter",
    "examples/alpha/motor-starter.packet.json",
  );
  add(
    "motor-starter-documentation",
    "examples/motor-starter",
    "examples/alpha/motor-starter-documentation.packet.json",
  );
  add(
    "operator-console",
    "examples/operator-console",
    "examples/operator-console/packet.request.json",
  );
  add(
    "functional-symbols",
    "examples/functional-symbols",
    "examples/functional-symbols/packet-left-to-right.request.json",
  );
  for (const name of [
    "circuit-pagination",
    "network-pagination",
    "cap-pagination",
    "connector-io",
    "self-loop-labels",
    "topology-coverage",
    "report-filtering",
    "assembly-note-bounds",
  ])
    add(name, `examples/${name}`, `examples/${name}/packet.json`);
  add(
    "analog-output",
    "packages/cli/fixtures/analog-output",
    "packages/cli/fixtures/analog-output/packet.request.json",
    "field",
  );
  add(
    "signal-loop",
    "packages/cli/fixtures/signal-loop",
    requests.signal,
    "field",
  );
  add(
    "ea-f3-wide-label",
    "packages/cli/templates/starter-default",
    requests.wide,
    "wide",
  );
  if (quick)
    return list.filter((x) =>
      [
        "init-starter-left-to-right",
        "init-starter-top-to-bottom",
        "machine-demo-left-to-right",
        "ea-f3-wide-label-left-to-right",
        "functional-symbols-top-to-bottom",
      ].includes(x.id),
    );
  for (const [project, request] of [
    ["motor-starter", requests.sweepPower],
    [
      "functional-symbols",
      "examples/functional-symbols/packet-left-to-right.request.json",
    ],
    ["report-filtering", "examples/report-filtering/packet.json"],
  ])
    for (const size of ["tabloid", "a3", "letter"])
      for (const orientation of ["landscape", "portrait"])
        for (const layout of ["standard", "compact"])
          for (const flow of flows)
            list.push({
              id: `sweep-${project}-${size}-${orientation}-${layout}-${flow}`,
              project: `examples/${project}`,
              request,
              flow,
              sweep: { project, size, orientation, layout },
            });
  return list;
}
export async function sourceFiles(root, selection = {}) {
  const roots = selection.roots ?? [
    ...new Set([
      ...cases().map((c) => c.project),
      "packages/core-library/library",
      "packages/core-library/versions",
      "libraries/field-interfaces",
      "libraries/industrial-pilot",
    ]),
  ];
  const requests =
    selection.requests ??
    cases()
      .filter((c) => typeof c.request === "string")
      .map((c) => c.request);
  const listed = await command(root, "git", [
    "ls-files",
    "-z",
    "--",
    ...roots,
    ...requests,
  ]);
  if (listed.code !== 0) throw Error(listed.stderr);
  const paths = [
    ...new Set(
      listed.stdout
        .split("\0")
        .filter(
          (p) =>
            p.endsWith(".json") && !/(^|\/)(package|tsconfig)\.json$/.test(p),
        ),
    ),
  ].sort();
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (p) => [p, hash(await readFile(join(root, p)))]),
    ),
  );
}
export async function createSeal(root, selection) {
  const revision = await command(root, "git", ["rev-parse", "HEAD"]);
  if (revision.code !== 0) throw Error(revision.stderr);
  return {
    format: "thermite-draw-corpus/2.0",
    base: revision.stdout.trim(),
    casesSha256: hash(json(cases())),
    files: await sourceFiles(root, selection),
    deferred: ["D1/D2 agent-produced packets: E2 checkpoint outputs pending"],
  };
}
export const contentSeal = ({ format, casesSha256, files }) =>
  hash(json({ format, casesSha256, files }));
export async function verifyCorpus(root, kitRoot, selection) {
  const manifest = await readJson(join(kitRoot, "corpus/manifest.json")),
    actual = await createSeal(root, selection);
  const changed = [
    ...new Set([...Object.keys(manifest.files), ...Object.keys(actual.files)]),
  ]
    .filter((p) => manifest.files[p] !== actual.files[p])
    .sort();
  return {
    seal: contentSeal(actual),
    reference: contentSeal(manifest),
    changedFiles: changed,
    inventoryChanged: manifest.casesSha256 !== actual.casesSha256,
    actual,
  };
}
export async function prepare(c, root, dest, cli) {
  let project = join(root, c.project);
  if (c.recipe) {
    project = join(dest, "project");
    await cp(join(root, c.project), project, { recursive: true });
    if (["starter", "wide"].includes(c.recipe)) {
      // Fixed template UUIDs; init's only electrical transformation is a local core copy.
      const starterSystem = await readJson(join(project, "system.json"));
      const version = starterSystem.libraries.find(
        (l) => l.name === "core",
      )?.version;
      const libraryDirectory =
        version === "0.1.0" ? "library" : `versions/${version}`;
      await cp(
        join(root, "packages/core-library", libraryDirectory),
        join(project, "libraries/core"),
        { recursive: true },
      );
      const system = await readJson(join(project, "system.json"));
      system.libraries[0].path = "libraries/core";
      await writeFile(join(project, "system.json"), json(system));
      const presentation = await readJson(join(project, "presentation.json"));
      presentation.format = "project-presentation/0.2";
      presentation.page = {
        size: "tabloid",
        orientation: "landscape",
        marginMm: 10,
      };
      await writeFile(join(project, "presentation.json"), json(presentation));
      if (c.recipe === "wide") {
        const p = join(project, "connections/control-power.json"),
          source = await readJson(p);
        source.objects.find((o) => o.kind === "wire").properties.label =
          "W".repeat(120);
        await writeFile(p, json(source));
      }
    } else {
      for (const name of ["field-interfaces", "industrial-pilot"])
        await cp(join(root, "libraries", name), join(project, name), {
          recursive: true,
        });
      await writeFile(
        join(project, "system.json"),
        json({
          format: "electrical-system/0.1",
          project: {
            name: `${c.recipe === "field" ? "Synthetic field-interface" : "Drawing"} fixture`,
          },
          sources: ["source.json"],
          libraries: ["field-interfaces", "industrial-pilot"].map((name) => ({
            name,
            version: "0.1.0",
            path: name,
          })),
        }),
      );
    }
    const lock = await cli(["lock", project]);
    if (lock.code !== 0) throw Error(`Fixture lock failed: ${lock.stderr}`);
  }
  let request =
    typeof c.request === "string"
      ? await readJson(join(root, c.request))
      : structuredClone(c.request);
  for (const v of request.views)
    if (!v.format.startsWith("documentation-")) v.flow = c.flow;
  // Operator wiring and communication views have no flow field in their schemas.
  for (const v of request.views)
    if (
      [
        "wiring-view-request/0.1",
        "communication-view-request/0.1",
        "connector-assembly-view-request/0.1",
      ].includes(v.format)
    )
      delete v.flow;
  if (c.recipe === "field" && c.flow === "top-to-bottom")
    request.page = { ...request.page, orientation: "portrait" };
  if (c.sweep) {
    request.page = {
      ...request.page,
      size: c.sweep.size,
      orientation: c.sweep.orientation,
    };
    request.layout = c.sweep.layout;
  }
  await mkdir(dest, { recursive: true });
  const input = join(dest, "request.json");
  await writeFile(input, json(request));
  return { project, input, request, source: relative(root, project) };
}
