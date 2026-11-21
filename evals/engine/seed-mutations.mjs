// Maintainer recipe; expected diagnostics below are authored assertions, never
// learned from the compiler. Review changed expectations like checker changes.
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { corpus, json } from "./support.mjs";
import { createMutationContext } from "./seed-mutation-context.mjs";
import {
  addRequiredProperties,
  addPropertyTypes,
  addUnknownProperties,
  addStringPatterns,
  addEnums,
  addCardinality,
  addObjectKinds,
  addManifestVersion,
  addIdentities,
  addReferences,
  addTypeKinds,
  addEndpoints,
  addLibraryCases,
  addCableLandings,
  addPotentialRatings,
  addRequiredConnection,
  addDisjointFaults,
  addRatingsOnlyPairs,
  addPartialPotentials,
  addDeferredConnections,
  addAssessments,
  addJsonErrors,
  attachAlternatives,
  addManyTypeAlternative,
} from "./seed-mutation-classes.mjs";
export function mutationRecipe() {
  const context = createMutationContext();
  addRequiredProperties(context);
  addPropertyTypes(context);
  addUnknownProperties(context);
  addStringPatterns(context);
  addEnums(context);
  addCardinality(context);
  addObjectKinds(context);
  addManifestVersion(context);
  addIdentities(context);
  addReferences(context);
  addTypeKinds(context);
  addEndpoints(context);
  addLibraryCases(context);
  addCableLandings(context);
  addPotentialRatings(context);
  addRequiredConnection(context);
  addDisjointFaults(context);
  addRatingsOnlyPairs(context);
  addPartialPotentials(context);
  addDeferredConnections(context);
  addAssessments(context);
  addJsonErrors(context);
  const typeIds = attachAlternatives(context);
  addManyTypeAlternative(context, typeIds);
  return { format: "thermite-eval-mutations/1.0", cases: context.rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await writeFile(join(corpus, "mutations.json"), json(mutationRecipe()));
