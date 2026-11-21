import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
export function recordReviewFlags({ type, result, keys, renderKind, flag }) {
  if (type.connectionCoverage.status === "partial")
    flag("partial-model", type.connectionCoverage.notes);
  if (keys.length && !result.sources.some((source) => source.diagramReviewed))
    flag(
      "diagram-not-reviewed",
      "No electrical source records a reviewed manufacturer connection diagram.",
    );
  for (const source of result.sources.filter(
    (source) => !source.diagramReviewed,
  ))
    flag(
      "source-diagram-not-reviewed",
      `${source.id}: manufacturer diagram review is not recorded.`,
    );
  flag(
    "identity-document-review",
    "Exact order identity and declared document revision require comparison with the manufacturer source.",
  );
  if (keys.length)
    flag(
      "ratings-review",
      "Review every declared voltage/current unit and operating limit; missing ratings and ratings applicability are not inferred by this fixture.",
    );
  const unrated = keys.filter((key) => !type.terminals[key].rating);
  if (unrated.length)
    flag(
      "terminals-without-ratings",
      `No terminal rating declared for: ${unrated.join(", ")}. Review applicability against the source.`,
    );
  if (
    !result.sources.some((source) => source.url === type.catalog.document?.url)
  )
    flag(
      "catalog-document-evidence",
      "Catalog document URL is missing or does not match a listed manufacturer source.",
    );
  if (renderKind !== "circuit")
    flag(
      "no-circuit-coverage",
      "The generated packet is an inventory overview; it does not establish circuit-symbol coverage.",
    );
}
function makeVerificationObjects({ type, keys, links, uid }, boundaryName) {
  const objects = [
    { kind: "device", uid: uid(1), designation: "D1", type: type.id },
  ];
  keys.forEach((key, index) => {
    objects.push({
      kind: "device",
      uid: uid(1000 + index),
      designation: `B${index + 1}`,
      type: `${boundaryName}:endpoint-${index + 1}`,
    });
    objects.push({
      kind: "wire",
      uid: uid(100000 + index),
      designation: `W${index + 1}`,
      endpoints: [
        { device: "D1", terminal: key },
        { device: `B${index + 1}`, terminal: "1" },
      ],
    });
  });
  links.forEach((link, index) =>
    objects.push({
      kind: "jumper",
      uid: uid(200000 + index),
      designation: `FIXED${index + 1}`,
      description: `${link.sourceId}: ${link.reason}`,
      endpoints: [
        { device: "D1", terminal: link.from },
        { device: "D1", terminal: link.to },
      ],
    }),
  );
  return objects;
}
export async function createCandidateFixture(context) {
  const { output, report, type, keys } = context;
  const fixture = await mkdtemp(join(output, "fixture-"));
  report.outputs.fixture = fixture;
  const library = join(fixture, "candidate"),
    boundary = join(fixture, "boundary");
  await mkdir(library);
  await mkdir(boundary);
  const libraryName = type.id.split(":")[0];
  const boundaryName =
    libraryName === "batch-boundary" ? "batch-test-boundary" : "batch-boundary";
  const objects = makeVerificationObjects(context, boundaryName);
  const sourcePath = join(fixture, "source.json"),
    typePath = join(library, "type.json");
  await writeCandidateFiles({
    ...context,
    fixture,
    library,
    boundary,
    libraryName,
    boundaryName,
    objects,
    sourcePath,
    typePath,
  });
  return { fixture, objects, sourcePath, typePath };
}
async function writeCandidateFiles({
  fixture,
  library,
  boundary,
  libraryName,
  boundaryName,
  objects,
  sourcePath,
  typePath,
  snapshots,
  json,
  keys,
  type,
  job,
}) {
  await writeFile(typePath, snapshots.get("type.json"));
  await writeFile(
    join(library, "library.json"),
    json({ name: libraryName, version: "0.1.0", sources: ["type.json"] }),
  );
  await writeFile(
    join(boundary, "library.json"),
    json({ name: boundaryName, version: "0.1.0", sources: ["types.json"] }),
  );
  await writeFile(
    join(boundary, "types.json"),
    json({
      types: keys.map((key, index) => ({
        kind: "device_type",
        id: `${boundaryName}:endpoint-${index + 1}`,
        description:
          "Synthetic unenergized test endpoint; no installed source or load",
        symbol: "thermite:terminal-strip",
        terminals: { 1: { role: type.terminals[key].role ?? "passive" } },
        functions: {},
        connectionCoverage: {
          status: "partial",
          notes:
            "Invented test boundary only. No installed supply, load, protection, conductor size or bonding is specified.",
        },
      })),
    }),
  );
  await writeFile(
    join(fixture, "system.json"),
    json({
      format: "electrical-system/0.1",
      project: {
        name: `${job.expectedOrderNumber} component verification`,
      },
      sources: ["source.json"],
      libraries: [
        { name: libraryName, version: "0.1.0", path: "candidate" },
        ...(keys.length
          ? [{ name: boundaryName, version: "0.1.0", path: "boundary" }]
          : []),
      ],
    }),
  );
  await writeFile(sourcePath, json({ objects }));
}
