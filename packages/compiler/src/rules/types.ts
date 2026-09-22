import type { Diagnostic } from "@thermite/schema";

import type { RuleContext } from "./context.js";

export type M3RuleId =
  | "E200"
  | "E201"
  | "E202"
  | "E203"
  | "E204"
  | "E205"
  | "E206"
  | "E207"
  | "W903"
  | "W904"
  | "W905"
  | "E300"
  | "E301"
  | "E302"
  | "W902";

/** Internal rule contract. The diagnostic code is the stable rule identity. */
export interface ElectricalRule {
  readonly id: M3RuleId;
  evaluate(context: RuleContext): readonly Diagnostic[];
}
