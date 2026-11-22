import { nativeWinner } from "./rooted-search.js";
import type { RootedSearch } from "./rooted-search.js";
import type { PaperPage } from "./types.js";
import { compareCandidates } from "./rooted-score.js";
import { actualChoices, cardGroups } from "../off-view/choices.js";

import { MAX_MIXED_LAYOUTS } from "./rooted-limits.js";
export { MAX_MIXED_LAYOUTS } from "./rooted-limits.js";
type Profile = RootedSearch["prepared"][number]["profile"];

/** Change one card's quadrant within a uniform group. All boxes are from the
 * original candidate generator; mixed choices can escape a uniform local trap.
 * Keep the previous winners, share a finite budget fairly across profiles. */
export async function mixedPlacements(
  run: RootedSearch,
  page: PaperPage,
  baseline: ReadonlyMap<string, number>,
  tryLayout: (
    profile: Profile,
    choices: Record<string, number>,
  ) => Promise<void>,
  baselineDetours?: ReadonlyMap<string, number>,
) {
  const start = run.attempts;
  for (const [index, { p, profile }] of run.prepared.entries()) {
    if (run.settled) break;
    const budget = Math.floor(
      (MAX_MIXED_LAYOUTS - run.attempts + start) /
        (run.prepared.length - index),
    );
    const end = run.attempts + budget;
    const best = run.candidates
      .filter((c) => c.profile === profile)
      .sort((a, b) =>
        compareCandidates(
          a,
          b,
          baseline,
          page,
          baselineDetours,
          nativeWinner(run),
          run.localityReference,
        ),
      )[0];
    const seed = best?.prepared ?? p;
    for (const ids of cardGroups(seed).filter((g) => g.length > 1))
      for (const quadrant of [-1, -2, -3, -4]) {
        const uniform = {
          ...actualChoices(seed),
          ...Object.fromEntries(ids.map((id) => [id, quadrant])),
        };
        for (const id of ids)
          for (const other of [-1, -2, -3, -4]) {
            if (run.attempts >= end) break;
            if (other === quadrant) continue;
            await tryLayout(profile, { ...uniform, [id]: other });
          }
      }
  }
}
