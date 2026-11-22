import type { IrDeviceType, IrDeviceTypeFunction } from "@thermite/compiler";
import type { FunctionSymbolRule } from "./mappings.js";

type Identity = Pick<
  FunctionSymbolRule,
  "symbolId" | "classification" | "traversalRole"
>;
const CONTACT: Pick<Identity, "classification" | "traversalRole"> = {
  classification: "power-contact",
  traversalRole: "power-contact",
};
const PROTECTION: Pick<Identity, "classification" | "traversalRole"> = {
  classification: "protection",
  traversalRole: "breaker-pole",
};
const MARKS: Readonly<Record<string, Identity | undefined>> = {
  fuse: { symbolId: "ais:fuse", ...PROTECTION },
  breaker: { symbolId: "ais:breaker-pole", ...PROTECTION },
  overload: {
    symbolId: "ais:overload-pole",
    classification: "overload",
    traversalRole: "overload-pole",
  },
  "contact-no": { symbolId: "ais:contact-no", ...CONTACT },
  "contact-nc": { symbolId: "ais:contact-nc", ...CONTACT },
  "switch-no": { symbolId: "ais:switch-no", ...CONTACT },
  "switch-nc": { symbolId: "ais:switch-nc", ...CONTACT },
  "pushbutton-no": { symbolId: "ais:pushbutton-no", ...CONTACT },
  "pushbutton-nc": { symbolId: "ais:pushbutton-nc", ...CONTACT },
};

export function protectionPowerRefusal(
  profile: string | undefined,
  mark: string | undefined,
  fn: { kind: string; normal_state?: "open" | "closed" },
): string | undefined {
  if (
    !["thermite:fuse", "thermite:breaker", "thermite:overload"].includes(
      profile ?? "",
    ) ||
    !["contact", "other"].includes(fn.kind) ||
    mark === undefined ||
    (Object.hasOwn(MARKS, mark) &&
      (fn.kind === "contact" ||
        mark === (profile === "thermite:overload" ? "overload" : "fuse")))
  )
    return;
  return `Unsupported power protection identity: normal_state=${fn.kind === "contact" ? JSON.stringify(fn.normal_state) : "not applicable"}, circuitSymbols=${JSON.stringify(mark)}. No rooted power primitive for this authored mark. Use a circuit view to retain the authored identity.`;
}

/** Resolve only power ink. Control keeps its independently bounded identity policy. */
export function protectionPowerRule(
  profile: string,
  type: IrDeviceType,
  fn: IrDeviceTypeFunction,
  rule: FunctionSymbolRule,
): FunctionSymbolRule | undefined {
  if (!["contact", "other"].includes(fn.kind)) return rule;
  const mark = type.circuitSymbols?.[fn.key];
  if (protectionPowerRefusal(profile, mark, fn)) return;
  const identity =
    mark === undefined
      ? profile === "thermite:fuse" &&
        fn.kind === "contact" &&
        fn.normal_state === "open"
        ? MARKS["contact-no"]
        : undefined
      : MARKS[mark];
  return identity ? { ...rule, ...identity } : rule;
}
