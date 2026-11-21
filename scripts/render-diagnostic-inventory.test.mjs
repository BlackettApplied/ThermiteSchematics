import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateScopePolicies } from "./render-diagnostic-policies.mjs";
import { diagnosticInventory } from "./render-diagnostic-inventory.mjs";

it("all R001–R006 construction sites and context wrappers remain audited", () => {
  const expected = JSON.parse(
    readFileSync(
      new URL("./render-diagnostic-sites.json", import.meta.url),
      "utf8",
    ),
  );
  const actual = diagnosticInventory();
  expect(actual.sites.map(({ line, ...site }) => site)).toEqual(expected.sites);
  expect(actual.wrappers).toEqual(expected.wrappers);
  expect(validateScopePolicies(expected, actual)).toEqual([]);
  // All 144 original sites remain; broader semantic coverage is additional.
  for (const legacy of expected.legacySites)
    expect(
      actual.sites.some(
        (site) =>
          site.path === legacy.path &&
          site.owner === legacy.owner &&
          site.kind === legacy.kind &&
          site.factory === legacy.factory &&
          legacy.codes.every((code) => site.codes.includes(code)),
      ),
      legacy.id,
    ).toBe(true);
});

it("scope categories cannot claim a code without a named executable public probe", () => {
  const expected = JSON.parse(
    readFileSync(
      new URL("./render-diagnostic-sites.json", import.meta.url),
      "utf8",
    ),
  );
  expected.policies["public-boundary"].probes = [];
  expect(
    validateScopePolicies(expected, {
      sites: expected.sites,
      wrappers: expected.wrappers,
    }),
  ).toContain(
    "Missing R001 public probe for packages/render/src/view-request-errors.ts",
  );
});
