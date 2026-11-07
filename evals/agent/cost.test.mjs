import { it, expect } from "vitest";
import { estimateCost } from "./cost.mjs";
it("auxiliary models use their own table rates and retain reported cost", () => {
  const normalized = {
      usage: { partial: false },
      reportedCostUSD: 1.23,
      modelUsage: {
        main: { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 50 },
        aux: { inputTokens: 500, outputTokens: 40 },
      },
    },
    table = {
      version: "test",
      currency: "USD",
      basis: "planning",
      models: {
        main: { input: 5, cachedInput: 0.5, output: 25 },
        aux: { input: 1, cachedInput: 0.1, output: 5 },
      },
    };
  const r = estimateCost(normalized, "main", table);
  expect(r.amount).toBeCloseTo((500 + 25 + 250 + 500 + 200) / 1e6);
  expect(r.providerReportedCostUSD).toBe(1.23);
  delete table.models.aux;
  const missing = estimateCost(normalized, "main", table);
  expect(missing.amount).toBe(null);
  expect(missing.unknownModels).toEqual(["aux"]);
  expect(missing.partial).toBe(true);
});
