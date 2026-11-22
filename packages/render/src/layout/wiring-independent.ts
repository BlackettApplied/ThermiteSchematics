import { wiringLandingInkFits } from "./wiring-landing-ink.js";
import type { ElkNode, ELK } from "elkjs/lib/elk-api.js";
import { independentWiringInput } from "./wiring-landings.js";
import { independentWiringRoutes } from "./wiring-independent-guard.js";
import {
  wiringGeometryInUnits,
  wiringSolverInput,
  WIRING_UNITS_PER_MM,
} from "./wiring-unit-space.js";
import {
  assertTopologyIdentities,
  assertTopologyRouteEndpoints,
} from "./topology-conservation.js";
import { circuitConductorNonRegression } from "./circuit-route-quality.js";
import { circuitCrossingGuard } from "./circuit-native-guard.js";
import { ElkWorkBudgetError } from "./elk-work.js";

export const MAX_INDEPENDENT_WIRING_LAYOUTS = 2;
function conserved(graph: ElkNode, expected: ElkNode) {
  try {
    assertTopologyIdentities(graph, expected);
    assertTopologyRouteEndpoints(graph);
    return true;
  } catch {
    return false;
  }
}
export async function chooseIndependentWiring(
  input: ElkNode,
  baseline: ElkNode,
  engine: ELK,
  admit?: (candidate: ElkNode, original: ElkNode) => boolean,
  strokes?: ReadonlyMap<string, number>,
) {
  const plan = independentWiringInput(input, baseline);
  if (!plan) return baseline;
  const solver = wiringSolverInput(plan.input),
    expected = structuredClone(solver);
  let native: ElkNode;
  try {
    native = await engine.layout(solver);
  } catch (error) {
    if (error instanceof ElkWorkBudgetError) return baseline;
    throw error;
  }
  if (!conserved(native, expected)) return baseline;
  const candidate = wiringGeometryInUnits(native, 1 / WIRING_UNITS_PER_MM);
  if (
    !conserved(candidate, plan.input) ||
    !independentWiringRoutes(candidate, plan.aliases) ||
    !wiringLandingInkFits(candidate, plan.aliases, strokes) ||
    !circuitConductorNonRegression(candidate, baseline) ||
    !circuitCrossingGuard(candidate, baseline) ||
    (admit && !admit(candidate, baseline))
  )
    return baseline;
  return candidate;
}
