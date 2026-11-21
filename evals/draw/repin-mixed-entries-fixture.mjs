import { markerId } from "./locators.mjs";

export function fixtureIdentityEntries(
  a,
  b,
  moved,
  fresh,
  oldToken,
  newToken,
  freshTokens,
  crop,
  scope,
  oldView,
  newView,
) {
  return [
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "retire",
      markerId: markerId(b),
      scope: scope(),
      cause: "fixed",
      causeClass: "fixed-tag",
      note: "K2 no longer leaks a key",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "rename",
      from: { markerId: markerId(a), scope: scope() },
      to: { markerId: markerId(moved), scope: scope(newView) },
      pairs: [
        { from: oldToken, to: newToken, view: { from: oldView, to: newView } },
      ],
      causeClass: "report-title-rename",
      note: "Same instance, renamed view",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "new-defect",
      to: { markerId: markerId(fresh), scope: scope(newView) },
      instances: freshTokens,
      crop,
      causeClass: "new-wire-offset",
      note: "Reviewed real stroke gap",
      classification: "drawing",
    },
  ];
}
export function fixtureEnvelopeEntries(d, policy) {
  return [
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "envelope-drift",
      markerId: markerId(d),
      metric: "advanceRatio",
      from: [0.75, 1.2, 1.2, 1.35],
      to: [1.2, 1.25, 1.25, 1.3],
      observed: [1.25, 1.25],
      coverage: "full",
      causeClass: "report-text-envelope",
      note: "Full measured range",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "envelope-drift",
      markerId: markerId(d),
      metric: "occurrences",
      from: [1, 1],
      to: [2, 2],
      observed: [2, 2],
      coverage: "full",
      causeClass: "report-text-envelope",
      note: "Both retained texts",
      classification: "drawing",
    },
    {
      reviewed: true,
      signOff: {
        kind: "agent",
        by: "Synthetic reviewer fixture (not an approval)",
      },
      action: "envelope-drift",
      markerId: markerId(policy),
      metric: "occurrences",
      from: [3, 3],
      to: [4, 4],
      observed: [4, 4],
      coverage: "full",
      causeClass: "policy-count-drift",
      note: "Unchanged ISO policy, new count",
      classification: "policy-gap",
    },
  ];
}
