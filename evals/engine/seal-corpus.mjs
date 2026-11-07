// Explicit maintainer operation. Inspect fixture/checker changes first.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { corpus, json, version } from "./support.mjs";
import { corpusInventory } from "./provenance.mjs";

export async function sealCorpus(destination = corpus) {
  await writeFile(
    join(destination, "manifest.json"),
    json({
      format: "thermite-eval-corpus/1.0",
      evalsVersion: version,
      provenance: [
        {
          path: "topology/",
          source:
            "Original synthetic E1 fixture; reduced from EA serial patch/diagnostic controls",
          purpose:
            "Physical continuity, split streams, guarded edits, reference and rule mutations; no equipment certification",
        },
        {
          path: "ratings-pair/",
          source: "Original synthetic E1 fixture based on CO F6",
          purpose:
            "Conflicting explicit ratings with/without declared potentials; current validation gap",
        },
        {
          path: "mutations.json",
          source:
            "engine/seed-mutations.mjs; EA F7, PU/CO authoring mistakes, GI retrieval failures; V2 #37/#78 synthetic follow-ups",
          purpose:
            "Fixed code/pointer mutations and actionable diagnostic predicates; markers are checker-side only",
        },
        {
          path: "baselines.json",
          source: "Original synthetic E1 variants of topology",
          purpose: "Twelve clean baseline recipes; zero diagnostics required",
        },
      ],
      generatedProject: {
        source: "engine/generate.mjs (adapted from EA synthetic ring recipe)",
        purpose:
          "300 eight-terminal devices of three types, binary-tree branches, seeded cross-pin wires and hub landings; multi-terminal bus functions do not join nets; generated only in temporary scratch",
        expected: { devices: 300, wires: 1500, terminals: 2400, nets: 1142 },
      },
      files: await corpusInventory(destination),
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await sealCorpus();
