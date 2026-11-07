import assert from "node:assert/strict";
import { markerId } from "./locators.mjs";
import { hash } from "./support.mjs";
// Storage sharing only. Expanded markers still have full source identities and
// exact scopes. No matching wildcard, dictionary index or measurement enters ID.
export function expandRegistry(scopeSets, severityBands, groups) {
  for (const dictionary of [scopeSets, severityBands])
    for (const [id, value] of Object.entries(dictionary))
      assert.equal(
        id,
        hash(JSON.stringify(value)).slice(0, 8),
        "Shared definition changed without a new content ID; serialize a reviewed proposal",
      );
  const markers = groups.flatMap(({ defects, ...identity }) =>
    defects.map((defect) => {
      const { scopes, bands, ...fields } = defect;
      assert(scopeSets[scopes], `Unknown scope set ${scopes}`);
      assert(severityBands[bands], `Unknown severity band ${bands}`);
      const marker = {
        ...identity,
        ...fields,
        scopes: scopeSets[scopes],
        bands: severityBands[bands],
        count: fields.count ?? [1, 1],
      };
      return { ...marker, id: markerId(marker) };
    }),
  );
  return {
    format: "thermite-draw-expectations/2.0",
    markers: markers.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
