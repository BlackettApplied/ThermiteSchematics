import { expect, it } from "vitest";
import { flatten, type GuideModel } from "./guide-model.js";

const runtimeSentence =
  "When using a runtime package, check existing issues at\nhttps://github.com/BlackettApplied/ThermiteSchematics/issues.";
const frameSentence =
  "For packet frames, use presentation 0.3 named slots; see `thermite guide drawing-frames`.";
const oldFrameSentence =
  "For packet frames, use presentation 0.3 named slots; see `docs/drawing-frames.md`.";

interface LedgerProblems {
  missingClaims: string[];
  unclassified: string[];
  stale: string[];
  alsoChecked: string[];
}
const controls = [
  {
    name: "rejects removal of the restored runtime issue sentence",
    from: runtimeSentence,
    to: "",
    expected: {
      missingClaims: [],
      unclassified: [],
      stale: [flatten(runtimeSentence)],
      alsoChecked: [],
    },
  },
  {
    name: "rejects removal of the offline frame pointer sentence",
    from: frameSentence,
    to: "",
    expected: {
      missingClaims: [frameSentence],
      unclassified: [],
      stale: [],
      alsoChecked: [],
    },
  },
  {
    name: "rejects reverting the frame pointer to a repository path",
    from: frameSentence,
    to: oldFrameSentence,
    expected: {
      missingClaims: [frameSentence],
      unclassified: [oldFrameSentence],
      stale: [],
      alsoChecked: [],
    },
  },
];

export function repairControls(
  mutate: (from: string, to: string) => GuideModel,
  problems: (model: GuideModel) => LedgerProblems,
) {
  it.each(controls)("$name", ({ from, to, expected }) => {
    expect(problems(mutate(from, to))).toEqual(expected);
  });
}
