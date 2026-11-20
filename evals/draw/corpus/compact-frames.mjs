import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { json, readJson } from "../support.mjs";
import { conveyor, rooted } from "./requests.mjs";

const paperVariants = [
  { size: "tabloid", orientation: "landscape", marginMm: 10 },
  { size: "letter", orientation: "portrait", marginMm: 5 },
];

export function compactFrameCases(flows) {
  return [
    ["machine-demo", "examples/machine-demo/packet.request.json", "M2"],
    ["conveyor-line", conveyor, "M1"],
  ].flatMap(([project, request, frameRoot]) =>
    paperVariants.flatMap((page) =>
      ["standard", "compact"].flatMap((layout) =>
        flows.map((flow) => ({
          id: `p03-${project}-${page.size}-${page.orientation}-${layout}-${flow}`,
          project: `examples/${project}`,
          request,
          recipe: "compact-frame",
          frameRequest: { layout, page },
          frameRoot,
          flow,
          ...(project === "conveyor-line" &&
          page.size === "tabloid" &&
          layout === "standard" &&
          flow === "top-to-bottom"
            ? {
                extraPowerRoot: "PS1",
                useDesignations: [
                  "W-PWR-004",
                  "W-PWR-005",
                  "W-PWR-007",
                  "W-PWR-008",
                ],
              }
            : {}),
        })),
      ),
    ),
  );
}

export function applyCompactFrameRequest(spec, request) {
  const views = request.views.filter(
    (view) => view.family === "power" && view.root?.value === spec.frameRoot,
  );
  assert.equal(
    views.length,
    1,
    `Expected one authored power view for ${spec.id}`,
  );
  if (spec.extraPowerRoot)
    views.push({ ...rooted(spec.extraPowerRoot, "power"), flow: spec.flow });
  Object.assign(request, spec.frameRequest, { views, index: false });
}

/** Upgrade only the clone's presentation. Keep the authored title and page data. */
export async function useCompactPresentation(project, spec) {
  const manifest = await readJson(join(project, "system.json"));
  const path = join(project, manifest.presentation);
  const presentation = await readJson(path);
  delete presentation.$schema;
  presentation.format = "project-presentation/0.3";
  await writeFile(path, json(presentation));
  if (spec.useDesignations) {
    // The additional AC-input view uses the existing designations for branches
    // shown as off-view notes. This copy keeps every electrical source fact.
    const source = join(project, "connections/power-incoming.json");
    const incoming = await readJson(source);
    for (const wire of incoming.objects)
      if (spec.useDesignations.includes(wire.designation))
        delete wire.properties.label;
    await writeFile(source, json(incoming));
  }
}
