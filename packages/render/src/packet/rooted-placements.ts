import {
  economyExhausted,
  validateEconomyCandidate,
} from "./rooted-economy.js";
import { mixedPlacements } from "./rooted-mixed.js";
import {
  actualChoices,
  placementChoices,
  cardGroups,
} from "../off-view/choices.js";
import { repositionDrawing } from "../off-view/prepared.js";
import { required } from "../presentation/util.js";
import type {
  CompiledProjectPresentation,
  ElectricalIr,
} from "@thermite/compiler";
import type { PreparedSchematicDrawing } from "../renderer.js";
import type { SchematicViewRequest } from "../types.js";
import type { PaperPage } from "./types.js";
import { buildRootedCandidates, type RootedCandidate } from "./rooted-build.js";
import { recordRootedDiagnostic } from "./rooted-constraint.js";
import {
  compareCandidates,
  candidateUtilisation,
  newJogs,
  newDetours,
} from "./rooted-score.js";
import {
  nativeWinner,
  rootedWinner,
  MAX_PLACEMENT_LAYOUTS,
  type RootedSearch,
} from "./rooted-search.js";
import { searchSettled } from "./rooted-settled.js";
type Profile = RootedSearch["prepared"][number]["profile"];
import { INITIAL_PLACEMENT_LAYOUTS } from "./rooted-limits.js";
async function tryPlacement(
  ir: Readonly<ElectricalIr>,
  _request: SchematicViewRequest,
  _presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  run: RootedSearch,
  profile: Profile,
  choices: Readonly<Record<string, number>>,
) {
  const key = choiceKey(profile, choices);
  if (
    run.settled ||
    economyExhausted(run) ||
    run.attempts + Number(!!run.jogRetryReserved) >= MAX_PLACEMENT_LAYOUTS ||
    run.tried.has(key)
  )
    return;
  run.tried.add(key);
  run.attempts++;
  const base = required(
    run.prepared.find((v) => v.profile === profile),
    "Missing prepared profile",
  );
  const prepared = await repositionDrawing(base.p, choices);
  if (!prepared.ok) return;
  const candidates = buildRootedCandidates(
    ir,
    prepared.value,
    page,
    profile,
    false,
    false,
    run.referenceOffset ?? 0,
  );
  recordRootedDiagnostic(run.diagnostics, candidates);
  if (candidates.ok) {
    run.candidates.push(...candidates.value);
    trimCandidates(run, page);
    if (
      run.validatedCandidate &&
      !run.candidates.includes(run.validatedCandidate)
    )
      run.candidates.push(run.validatedCandidate);
    validateEconomyCandidate(ir, run, page);
    run.settled = searchSettled(run, page);
  }
}
function choiceKey(
  profile: Profile,
  choices: Readonly<Record<string, number>>,
) {
  return `${profile ?? "standard"}:${JSON.stringify(
    Object.entries(choices)
      .filter(([, v]) => v !== 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )}`;
}
function trimCandidates(run: RootedSearch, page: PaperPage) {
  const baseline = nativeWinner(run)?.jogs ?? new Map<string, number>();
  run.candidates = [undefined, "compact", "dense"].flatMap((profile) => {
    const byLayout = new Map<PreparedSchematicDrawing, RootedCandidate>();
    for (const c of run.candidates.filter((c) => c.profile === profile)) {
      const previous = byLayout.get(c.prepared);
      if (
        !previous ||
        compareCandidates(
          c,
          previous,
          baseline,
          page,
          nativeWinner(run)?.detours,
          nativeWinner(run),
          run.localityReference,
        ) < 0
      )
        byLayout.set(c.prepared, c);
    }
    const ordered = [...byLayout.values()].sort((a, b) =>
      compareCandidates(
        a,
        b,
        baseline,
        page,
        nativeWinner(run)?.detours,
        nativeWinner(run),
        run.localityReference,
      ),
    );
    const compact = [...ordered].sort(
      (a, b) =>
        a.prepared.layout.width * a.prepared.layout.height -
        b.prepared.layout.width * b.prepared.layout.height,
    )[0];
    return [
      ...new Set([...ordered.slice(0, 3), ...(compact ? [compact] : [])]),
    ];
  });
}
function profileWinner(run: RootedSearch, page: PaperPage, profile: Profile) {
  return rootedWinner(
    { ...run, candidates: run.candidates.filter((c) => c.profile === profile) },
    page,
  );
}
export async function placements(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  run: RootedSearch,
) {
  await initialPlacements(ir, request, presentation, page, run);
  const winner = rootedWinner(run, page),
    native = nativeWinner(run);
  if (
    !run.settled &&
    (!winner ||
      !native ||
      winner.drafts.length > native.drafts.length ||
      candidateUtilisation(winner, page) < 0.4 ||
      newJogs(winner, native.jogs) > 0 ||
      newDetours(winner, native.detours ?? new Map()) > 0)
  )
    await mixedPlacements(
      run,
      page,
      native?.jogs ?? new Map(),
      (profile, choices) =>
        tryPlacement(ir, request, presentation, page, run, profile, choices),
      native?.detours,
    );
}

async function initialPlacements(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  run: RootedSearch,
) {
  for (let rank = 1; rank <= 3; rank++)
    for (const { p, profile } of run.prepared)
      await tryPlacement(
        ir,
        request,
        presentation,
        page,
        run,
        profile,
        placementChoices(p, rank),
      );
  for (const rank of [-1, -2, -3, -4])
    for (const { p, profile } of run.prepared)
      await tryPlacement(
        ir,
        request,
        presentation,
        page,
        run,
        profile,
        placementChoices(p, rank),
      );
  await devicePlacements(ir, request, presentation, page, run);
  await coordinatePlacements(ir, request, presentation, page, run);
}
async function devicePlacements(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  run: RootedSearch,
) {
  const budget = Math.floor(
    (INITIAL_PLACEMENT_LAYOUTS - run.attempts) /
      Math.max(1, run.prepared.length),
  );
  for (const { p, profile } of run.prepared) {
    const end = run.attempts + budget;
    for (const ids of cardGroups(p)) {
      const choices = run.candidates.filter((c) => c.profile === profile);
      const best = profileWinner(run, page, profile);
      const small = [...choices].sort(
        (a, b) =>
          a.prepared.layout.width * a.prepared.layout.height -
          b.prepared.layout.width * b.prepared.layout.height,
      )[0];
      const seeds = [
        ...new Set(
          [best?.prepared, small?.prepared].filter(
            (c): c is PreparedSchematicDrawing => !!c,
          ),
        ),
      ];
      if (!seeds.length) seeds.push(p);
      for (const seed of seeds) {
        const count = Math.max(
          ...seed.graph.nodes.flatMap((n) =>
            n.kind === "junction"
              ? []
              : n.labels
                  .filter((l) => ids.includes(l.id))
                  .map((l) => l.offView?.placementCount ?? 1),
          ),
        );
        for (const rank of [
          -1,
          -2,
          -3,
          -4,
          ...Array.from({ length: Math.min(48, count) }, (_, i) => i),
        ]) {
          if (run.attempts >= end) break;
          const all = placementChoices(seed, rank);
          await tryPlacement(ir, request, presentation, page, run, profile, {
            ...actualChoices(seed),
            ...Object.fromEntries(ids.map((id) => [id, all[id] ?? 0])),
          });
        }
      }
      if (run.attempts >= end) break;
    }
  }
}
async function coordinatePlacements(
  ir: Readonly<ElectricalIr>,
  request: SchematicViewRequest,
  presentation: CompiledProjectPresentation | undefined,
  page: PaperPage,
  run: RootedSearch,
) {
  // Coordinate search keeps other cards fixed. Global rank changes alone can
  // improve one rail while worsening its neighbours and hiding a printable grid.
  const budget = Math.floor(
    (INITIAL_PLACEMENT_LAYOUTS - run.attempts) /
      Math.max(1, run.prepared.length),
  );
  for (const { profile } of run.prepared) {
    const end = Math.min(INITIAL_PLACEMENT_LAYOUTS, run.attempts + budget);
    let best = profileWinner(run, page, profile);
    if (!best) continue;
    const cards = best.prepared.graph.nodes.flatMap((n) =>
      n.kind === "junction"
        ? []
        : n.labels
            .filter((l) => l.offView)
            .map((l) => ({
              l,
              growth: n.height - (n.contentBox?.height ?? n.height),
            })),
    );
    cards.sort((a, b) => b.growth - a.growth);
    for (const { l } of cards) {
      const ranks = [0, 1, 2, 3, 4, 7, 8, 12, 16, 20];
      for (const rank of ranks) {
        if (run.attempts >= end) break;
        if (rank >= (l.offView?.placementCount ?? 0)) continue;
        best = required(
          profileWinner(run, page, profile),
          "Missing rooted geometry",
        );
        const choices = Object.fromEntries(
          best.prepared.graph.nodes.flatMap((n) =>
            n.kind === "junction"
              ? []
              : n.labels.flatMap((c) =>
                  c.offView ? [[c.id, c.offView.placementRank ?? 0]] : [],
                ),
          ),
        );
        await tryPlacement(ir, request, presentation, page, run, profile, {
          ...choices,
          [l.id]: rank,
        });
      }
      if (run.attempts >= end) break;
    }
  }
}
