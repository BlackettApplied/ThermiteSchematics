// Committed planning rates, never presented as subscription charges.
export function estimateCost(normalized, model, table) {
  if (model === null)
    return {
      estimate: true,
      currency: table.currency,
      tableVersion: table.version,
      basis: table.basis,
      amount: 0,
      partial: false,
      unknownModels: [],
    };
  const entries = normalized.modelUsage
    ? Object.entries(normalized.modelUsage).map(([id, u]) => [
        id,
        {
          inputTokens:
            (u.inputTokens ?? 0) +
            (u.cacheReadInputTokens ?? 0) +
            (u.cacheCreationInputTokens ?? 0),
          outputTokens: u.outputTokens ?? 0,
          cachedInputTokens: u.cacheReadInputTokens ?? 0,
        },
      ])
    : [[model, normalized.usage]];
  let amount = 0;
  const unknownModels = [];
  for (const [id, u] of entries) {
    const rate = table.models[id];
    if (!rate) {
      unknownModels.push(id);
      continue;
    }
    amount +=
      ((u.inputTokens - u.cachedInputTokens) * rate.input +
        u.cachedInputTokens * rate.cachedInput +
        u.outputTokens * rate.output) /
      1e6;
  }
  return {
    estimate: true,
    currency: table.currency,
    tableVersion: table.version,
    basis: table.basis,
    amount: unknownModels.length ? null : amount,
    partial: normalized.usage.partial || unknownModels.length > 0,
    unknownModels,
    providerReportedCostUSD: normalized.reportedCostUSD ?? null,
  };
}
