import type { IrDeviceTypeFunction } from "@thermite/compiler";
import { InvalidSymbolMappingError } from "../errors.js";
import type { SymbolDefinition } from "./types.js";
function invalidMapping(detail: string): never {
  throw new InvalidSymbolMappingError(`Invalid symbol mapping: ${detail}`);
}
function assertMapping(condition: unknown, detail: string): asserts condition {
  if (!condition) invalidMapping(detail);
}
export function expectFunctionFacts(
  definition: IrDeviceTypeFunction,
  expectedKind: IrDeviceTypeFunction["kind"],
  context: string,
  expectedState?: "open" | "closed",
  expectedDirection?: "input" | "output",
): void {
  assertMapping(
    definition.kind === expectedKind,
    `${context} expected kind ${expectedKind}; received ${definition.kind}.`,
  );
  if (expectedState !== undefined) {
    assertMapping(
      definition.kind === "contact" &&
        definition.normal_state === expectedState,
      `${context} expected contact state ${expectedState}.`,
    );
  }
  if (expectedDirection !== undefined) {
    assertMapping(
      definition.kind === "channel" &&
        definition.direction === expectedDirection,
      `${context} expected channel direction ${expectedDirection}.`,
    );
  }
}

export function validateFunctionSymbolFacts(
  definition: IrDeviceTypeFunction,
  symbolId: SymbolDefinition["id"],
  context: string,
): void {
  switch (symbolId) {
    case "ais:source-winding":
      expectFunctionFacts(definition, "source", context);
      assertMapping(
        definition.terminalKeys.length === 2,
        `${context} requires source/2.`,
      );
      return;
    case "ais:power-source-dc":
      expectFunctionFacts(definition, "source", context);
      return;
    case "ais:ac-load":
    case "ais:motor":
    case "ais:lamp":
    case "ais:dc-load":
      expectFunctionFacts(definition, "load", context);
      return;
    case "ais:breaker-pole":
    case "ais:overload-pole":
      expectFunctionFacts(definition, "contact", context);
      return;
    case "ais:contact-no":
    case "ais:disconnector":
    case "ais:estop-no":
    case "ais:selector-no":
    case "ais:pushbutton-no":
    case "ais:switch-no":
      expectFunctionFacts(definition, "contact", context, "open");
      return;
    case "ais:contact-nc":
    case "ais:estop-nc":
    case "ais:selector-nc":
    case "ais:pushbutton-nc":
    case "ais:switch-nc":
    case "ais:overload-contact-nc":
      expectFunctionFacts(definition, "contact", context, "closed");
      return;
    case "ais:coil":
      expectFunctionFacts(definition, "coil", context);
      return;
    case "ais:fuse":
      assertMapping(
        ["contact", "other"].includes(definition.kind),
        `${context} requires contact or other.`,
      );
      return;
    case "ais:terminal":
      expectFunctionFacts(definition, "bus", context);
      return;
    case "ais:plc-di":
      expectFunctionFacts(definition, "channel", context, undefined, "input");
      return;
    case "ais:plc-do":
      expectFunctionFacts(definition, "channel", context, undefined, "output");
      return;
    default:
      invalidMapping(`${context} uses a non-function symbol ${symbolId}.`);
  }
}
