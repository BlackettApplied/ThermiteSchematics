import {
  CORE_SYMBOL_BINDINGS,
  symbolProfile,
  resolveSensorSupply,
  SYMBOL_PROFILES,
  appendJsonPointer,
  boundedAlternatives,
  formatAllowedValues,
  DIAGNOSTIC_MESSAGE_ALLOWED_LIMIT,
  normalizeDiagnosticFile,
  type CoreSymbolBinding,
  type Diagnostic,
  type DiagnosticAlternatives,
  type SymbolProfile,
  type SymbolRendererFamily,
  type ValidatedDeviceType,
} from "@thermite/schema";

import type {
  InstanceTypeResolution,
  ResolveLoadedProjectResult,
} from "./resolution.js";
import { symbolFunctionMatchesShape } from "./symbol-shapes.js";

const FAMILIES: readonly SymbolRendererFamily[] = [
  "power",
  "control",
  "loads",
  "circuit",
  "signal-loop",
];
const ROOTED = ["power", "control", "loads"] as const;
const MAX_DEVICE_NAMES = 10;

const MAX_FUNCTION_NAMES = 10;
const PROFILE_LOOKUP =
  "W111.allowed in `thermite validate <project> --json` (complete profile IDs)";

function supports(
  profile: SymbolProfile,
  family: SymbolRendererFamily,
): boolean {
  return profile.support.some((s) => s.family === family);
}

function profileAlternatives(
  binding?: CoreSymbolBinding,
): DiagnosticAlternatives<string> {
  const values = binding?.equivalent
    ? [binding.equivalent]
    : SYMBOL_PROFILES.map((p) => p.id);
  return {
    ...boundedAlternatives(values, PROFILE_LOOKUP),
    allowedLookup: PROFILE_LOOKUP,
  };
}

function supportedReplacements(): string {
  const groups = [
    {
      label: "circuit",
      profiles: SYMBOL_PROFILES.filter((p) => supports(p, "circuit")),
    },
  ];
  const rooted = new Map<
    string,
    { families: string[]; profiles: SymbolProfile[] }
  >();
  for (const family of ROOTED) {
    const profiles = SYMBOL_PROFILES.filter((p) => supports(p, family));
    const key = profiles.map((p) => p.id).join(",");
    const group = rooted.get(key) ?? { families: [], profiles };
    group.families.push(family);
    rooted.set(key, group);
  }
  for (const group of rooted.values())
    groups.push({
      label: `rooted ${group.families.join("/")}`,
      profiles: group.profiles,
    });
  groups.push({
    label: "signal-loop only (not circuit or rooted)",
    profiles: SYMBOL_PROFILES.filter(
      (p) =>
        supports(p, "signal-loop") &&
        !supports(p, "circuit") &&
        !ROOTED.some((f) => supports(p, f)),
    ),
  });

  let budget = DIAGNOSTIC_MESSAGE_ALLOWED_LIMIT;
  const text = groups.map((group, i) => {
    // Reserve a few names for each later family, sharing T2's ten-value budget
    // across the complete message rather than printing ten for every family.
    const reserved = groups
      .slice(i + 1)
      .reduce((n, g) => n + Math.min(2, g.profiles.length), 0);
    const shown = Math.min(
      group.profiles.length,
      Math.max(0, budget - reserved),
    );
    budget -= shown;
    const alternatives = boundedAlternatives(group.profiles.map((p) => p.id));
    const values = formatAllowedValues({
      ...alternatives,
      allowed: alternatives.allowed.slice(0, shown),
    });
    return `${group.label}: ${values}`;
  });
  // G3 will add `thermite guide symbols`; JSON validation already exposes all IDs.
  return `Supported profiles by family: ${text.join("; ")}. Full IDs: W111.allowed in validate --json. Shapes still apply.`;
}

function functionFamilies(
  type: ValidatedDeviceType,
  key: string,
  profile?: SymbolProfile,
): SymbolRendererFamily[] {
  const families = new Set<SymbolRendererFamily>();
  // Render resolves explicit marks before consulting any profile. E206 separately
  // validates each mark against the declared electrical facts.
  if (Object.hasOwn(type.circuitSymbols ?? {}, key)) families.add("circuit");
  if (
    profile?.id === "thermite:sensor-3wire" &&
    type.functions[key]!.kind === "channel" &&
    type.functions[key]!.direction !== "output"
  )
    return FAMILIES.filter((f) => families.has(f));
  const fn = type.functions[key]!;
  if (
    profile?.id === "thermite:sensor-3wire" &&
    fn.kind === "load" &&
    fn.terminals.length === 2 &&
    !resolveSensorSupply(
      fn.terminals.map((key) => ({ key, role: type.terminals[key]?.role })),
    ).ok
  )
    return FAMILIES.filter((f) => families.has(f));
  const sensorFunctions = Object.values(type.functions);
  const sensorSupplies = sensorFunctions.filter(
    (f) => f.kind === "load" && f.terminals.length === 2,
  );
  const sensorOutputs = sensorFunctions.filter(
    (f) =>
      f.kind === "channel" &&
      f.direction === "output" &&
      f.terminals.length === 1,
  );
  const completeSensor =
    sensorSupplies.length === 1 &&
    sensorOutputs.length === 1 &&
    resolveSensorSupply(
      sensorSupplies[0]!.terminals.map((key) => ({
        key,
        role: type.terminals[key]?.role,
      })),
    ).ok &&
    new Set([...sensorSupplies[0]!.terminals, ...sensorOutputs[0]!.terminals])
      .size === 3;
  for (const support of profile?.support ?? []) {
    if (
      profile?.id === "thermite:sensor-3wire" &&
      ROOTED.includes(support.family as (typeof ROOTED)[number]) &&
      !completeSensor
    )
      continue;
    if (
      support.functions.some((shape) =>
        symbolFunctionMatchesShape(type, type.functions[key]!, shape),
      )
    )
      families.add(support.family);
  }
  return FAMILIES.filter((f) => families.has(f));
}

function terminalFamilies(
  type: ValidatedDeviceType,
  profile?: SymbolProfile,
): SymbolRendererFamily[] {
  const count = Object.keys(type.terminals).length;
  return FAMILIES.filter((family) =>
    profile?.support.some(
      (s) =>
        s.family === family &&
        s.terminalOnly &&
        count >= s.terminalOnly.minTerminals,
    ),
  );
}

function drawableFunctions(type: ValidatedDeviceType) {
  return Object.entries(type.functions)
    .filter(([, f]) => f.kind !== "mechanism")
    .sort(([a], [b]) => compareDesignations(a, b));
}

function unfitFunctions(type: ValidatedDeviceType, profile?: SymbolProfile) {
  return drawableFunctions(type).filter(
    ([key]) => functionFamilies(type, key, profile).length === 0,
  );
}

function describeFunctions(
  functions: ReturnType<typeof drawableFunctions>,
): string {
  const names = functions
    .slice(0, MAX_FUNCTION_NAMES)
    .map(
      ([key, f]) => `${JSON.stringify(key)} (${f.kind}/${f.terminals.length})`,
    )
    .join(", ");
  const rest = functions.length - MAX_FUNCTION_NAMES;
  return rest > 0 ? `${names} and ${rest} more` : names;
}

function explicitMarkAdvice(): string {
  return "Give these functions an explicit circuitSymbols mark (E206 checks it), or move them to a separate device type.";
}

function replacementAdvice(
  type: ValidatedDeviceType,
  binding?: CoreSymbolBinding,
  partial = false,
): string {
  const repair = partial ? explicitMarkAdvice() : "";
  if (!binding?.equivalent) return partial ? repair : supportedReplacements();
  const equivalent = SYMBOL_PROFILES.find((p) => p.id === binding.equivalent)!;
  const families = new Set(terminalFamilies(type, equivalent));
  for (const [key] of drawableFunctions(type))
    for (const family of functionFamilies(type, key, equivalent))
      families.add(family);
  const fits =
    FAMILIES.filter((f) => families.has(f)).join(", ") ||
    "none for the declared functions";
  const parts = repair ? [repair] : [];
  parts.push(`Declared functions fit: ${fits}.`);
  if (!ROOTED.some((f) => families.has(f)))
    parts.push(
      "No rooted power/control/loads function binding fits the declared functions; use a circuit view for supported functions.",
    );
  const remaining = unfitFunctions(type, equivalent);
  if (remaining.length)
    parts.push(
      `${remaining.length} function${remaining.length === 1 ? " still needs an explicit circuitSymbols mark" : "s still need explicit circuitSymbols marks"} or a separate type.`,
    );
  return parts.join(" ");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Locale-independent natural order; digit runs are compared without precision loss. */
function compareDesignations(left: string, right: string): number {
  const a = left.match(/\d+|\D+/gu) ?? [];
  const b = right.match(/\d+|\D+/gu) ?? [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]!,
      y = b[i]!;
    if (/^\d+$/u.test(x) && /^\d+$/u.test(y)) {
      const nx = x.replace(/^0+/u, "") || "0",
        ny = y.replace(/^0+/u, "") || "0";
      const order = nx.length - ny.length || compareText(nx, ny);
      if (order) return order;
    } else {
      const order = compareText(x, y);
      if (order) return order;
    }
  }
  return a.length - b.length || compareText(left, right);
}

/** Advisory source-backed check. Every non-mechanism function must fit a catalog
 * family or have an explicit circuit mark. Terminal-only roles permit devices
 * without drawable functions; they never excuse an unsupported selected function.
 */
export function symbolProfileDiagnostics(
  resolved: ResolveLoadedProjectResult,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const byType = new Map<string, InstanceTypeResolution[]>();
  for (const entry of resolved.instanceTypesByUid.values()) {
    if (
      entry.instance.kind !== "device" ||
      entry.typeEntry.type.kind !== "device_type"
    )
      continue;
    const entries = byType.get(entry.typeEntry.type.id) ?? [];
    entries.push(entry);
    byType.set(entry.typeEntry.type.id, entries);
  }
  for (const entries of byType.values()) {
    const { typeEntry } = entries[0]!;
    const type = typeEntry.type;
    if (type.kind !== "device_type" || type.symbol === undefined) continue;
    const coreAlias = CORE_SYMBOL_BINDINGS.find(
      (b) => b.symbol === type.symbol,
    );
    const profile = SYMBOL_PROFILES.find((p) => p.id === symbolProfile(type));
    const roleProblems =
      profile?.id === "thermite:sensor-3wire"
        ? Object.entries(type.functions)
            .sort(([a], [b]) => compareDesignations(a, b))
            .flatMap(([key, fn]) => {
              if (fn.kind !== "load" || fn.terminals.length !== 2) return [];
              const roles = resolveSensorSupply(
                fn.terminals.map((key) => ({
                  key,
                  role: type.terminals[key]?.role,
                })),
              );
              return roles.ok
                ? []
                : [`${JSON.stringify(key)}: ${roles.reason}`];
            })
        : [];
    const functions = drawableFunctions(type);
    const unfit = unfitFunctions(type, profile);
    if (
      unfit.length === 0 &&
      roleProblems.length === 0 &&
      (functions.length > 0 || terminalFamilies(type, profile).length > 0)
    )
      continue;

    const devices = entries
      .map((e) => e.instance)
      .sort(
        (a, b) =>
          compareDesignations(a.designation ?? a.uid, b.designation ?? b.uid) ||
          compareText(a.uid, b.uid),
      );
    const names = devices
      .slice(0, MAX_DEVICE_NAMES)
      .map((d) => JSON.stringify(d.designation ?? d.uid))
      .join(", ");
    const extra =
      devices.length > MAX_DEVICE_NAMES
        ? ` and ${devices.length - MAX_DEVICE_NAMES} more`
        : "";
    const subject = `${devices.length === 1 ? "Device" : "Devices"} ${names}${extra}`;
    const context = `${subject} type ${JSON.stringify(type.id)} symbol ${JSON.stringify(type.symbol)}`;
    const parts: string[] = [];
    if (!profile) {
      parts.push(`${context}: unknown profile.`);
      if (functions.length > 0)
        parts.push(
          unfit.length === functions.length
            ? functions.length === 1
              ? "The declared function has no cataloged family support."
              : `None of ${functions.length} functions has cataloged family support.`
            : `${unfit.length} of ${functions.length} functions lack cataloged family support; explicit marks support the others.`,
        );
    } else {
      parts.push(`${context}.`);
      if (unfit.length)
        parts.push(
          `Functions with no cataloged family: ${describeFunctions(unfit)}.`,
        );
    }
    if (roleProblems.length)
      parts.push(
        `Invalid sensor supply roles: ${roleProblems.slice(0, MAX_FUNCTION_NAMES).join(" ")}${roleProblems.length > MAX_FUNCTION_NAMES ? ` and ${roleProblems.length - MAX_FUNCTION_NAMES} more invalid ${roleProblems.length - MAX_FUNCTION_NAMES === 1 ? "supply" : "supplies"}.` : ""}`,
      );
    if (functions.length === 0) {
      const requirements = profile?.support
        .filter((s) => s.terminalOnly)
        .map(
          (s) =>
            `${s.family}/${s.role} needs at least ${s.terminalOnly!.minTerminals} type terminals`,
        )
        .join("; ");
      parts.push(
        `No drawable functions or supported terminal role (${Object.keys(type.terminals).length} type terminals${requirements ? `; ${requirements}` : ""}).`,
      );
    }
    if (roleProblems.length)
      parts.push(
        "Author exactly one supply_positive and one supply_return role on the supply function terminals, or remove both roles to use authored terminal order. Circuit marks cannot establish sensor polarity.",
      );
    else
      parts.push(
        replacementAdvice(
          type,
          coreAlias,
          unfit.length > 0 && unfit.length < functions.length,
        ),
      );

    const jsonPointer = appendJsonPointer(
      typeEntry.source.jsonPointer,
      "symbol",
    );
    const location = typeEntry.document.nodes.get(jsonPointer)?.value;
    diagnostics.push({
      code: "W111",
      severity: "warning",
      message: parts.join(" "),
      ...profileAlternatives(coreAlias),
      file: normalizeDiagnosticFile(typeEntry.document.file),
      line: location?.line ?? typeEntry.source.line,
      column: location?.column ?? typeEntry.source.column,
      jsonPointer,
      ...(devices.length === 1 ? { uid: devices[0]!.uid } : {}),
    });
  }
  return diagnostics;
}
