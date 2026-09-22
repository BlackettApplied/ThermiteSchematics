import {
  connectionReviewRule,
  completenessWarningRule,
} from "./completeness.js";
import { communicationConnectionsRule } from "./communication.js";
import { connectorAssembliesRule } from "./connector-assemblies.js";
import { circuitSymbolsRule } from "./circuit-symbols.js";
import { channelAssignmentsRule, terminalOrderRule } from "./documentation.js";
import { duplicatePotentialIntentRule } from "./duplicate-potential-intent.js";
import { exclusiveTerminalAssignmentRule } from "./exclusive-terminal-assignment.js";
import { invalidCableConductorRule } from "./invalid-cable-conductor.js";
import { nominalVoltageClassRule } from "./nominal-voltage-class.js";
import { potentialConflictRule } from "./potential-conflict.js";
import type { ElectricalRule } from "./types.js";
import { voltageTypeCompatibilityRule } from "./voltage-type-compatibility.js";

/** Fixed M3 evaluation order with one sole producer per stable diagnostic code. */
export const ELECTRICAL_RULES: readonly ElectricalRule[] = Object.freeze([
  invalidCableConductorRule,
  exclusiveTerminalAssignmentRule,
  potentialConflictRule,
  voltageTypeCompatibilityRule,
  nominalVoltageClassRule,
  duplicatePotentialIntentRule,
  channelAssignmentsRule,
  terminalOrderRule,
  communicationConnectionsRule,
  connectorAssembliesRule,
  connectionReviewRule,
  circuitSymbolsRule,
  completenessWarningRule("W903"),
  completenessWarningRule("W904"),
  completenessWarningRule("W905"),
]);
