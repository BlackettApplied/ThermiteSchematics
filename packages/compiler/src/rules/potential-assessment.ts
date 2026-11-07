import type { Diagnostic } from "@thermite/schema";
import { compareNatural, summarizeAffected } from "../diagnostic-summary.js";
import { compareSourceRef } from "../ir.js";
import type { RuleContext } from "./context.js";
import {
  declaredVoltageTypeMismatch,
  positiveNominalVoltageMismatch,
} from "./terminal-compatibility.js";
import type { ElectricalRule } from "./types.js";

type Terminal = RuleContext["ir"]["terminals"][number];
type Net = RuleContext["ir"]["nets"][number];
type VoltageFacts = Pick<
  NonNullable<Terminal["rating"]>,
  "voltage_type" | "nominal_voltage"
>;

function hasVoltageFacts(facts: VoltageFacts | undefined): boolean {
  return (
    facts?.voltage_type !== undefined || facts?.nominal_voltage !== undefined
  );
}

export function displayNet(context: RuleContext, net: Net): string {
  const terminals = net.terminalIds
    .map((id) => context.displayTerminal(id))
    .sort(compareNatural);
  // The first terminal gives numeric-aware, human-readable net ordering without
  // changing the stable hashed net ID. Bound very large net memberships as well.
  return `${terminals.slice(0, 10).join(", ")}${terminals.length > 10 ? ` and ${terminals.length - 10} more` : ""} [${net.id}]`;
}

function ratedNets(context: RuleContext): Net[] {
  return context.ir.nets
    .filter(
      (net) =>
        !context.topologicallyAffectedNetIds.has(net.id) &&
        net.conductiveElementIds.length > 0 &&
        context.terminalsForNet(net).filter((t) => hasVoltageFacts(t.rating))
          .length >= 2,
    )
    .sort((a, b) =>
      compareNatural(displayNet(context, a), displayNet(context, b)),
    );
}

function comparable(terminal: Terminal): boolean {
  const rating = terminal.rating;
  if (!rating) return false;
  // A zero rating is a reference, not evidence of a mismatching supply class.
  if (rating.nominal_voltage !== undefined && rating.nominal_voltage <= 0)
    return false;
  // Roles are opaque author facts. Recognize only explicit reference/return or
  // ambiguous-rating tokens; never infer polarity or a rating from prose.
  const role = (terminal.role ?? "").toLowerCase().split(/[^a-z0-9]+/u);
  if (
    /^0\s*v(?:dc|ac)?$/iu.test((terminal.role ?? "").trim()) ||
    (role.includes("ac") && role.includes("dc")) ||
    role.some((token) =>
      [
        "neutral",
        "earth",
        "ground",
        "pe",
        "fe",
        "gnd",
        "common",
        "com",
        "return",
        "negative",
        "minus",
        "neg",
        "0v",
        "mixed",
        "multi",
        "multirated",
        "dual",
      ].includes(token),
    )
  )
    return false;
  // Only ambiguous signal keys yield to an explicit non-reference role: a
  // contact's COM or a digital input's M may describe a signal. Unambiguous
  // reference/return keys remain excluded even with generic roles like output.
  if (
    terminal.role !== undefined &&
    terminal.role.trim() !== "" &&
    /^(?:n|\d*m|com|common)$/iu.test(terminal.id.terminalKey)
  )
    return true;
  // Name-based exclusions only, including shared DC negative/return spellings.
  // They suppress comparisons; they never infer polarity or voltage. Numeric
  // 0V/GND suffixes and numbered M commons do not establish voltage classes.
  return !/^(?:n|pe|fe|gnd(?:[.\s]?\d+)?|0\s*v(?:dc|ac)?(?:\.\d+|\s+\d+)?|com|common|return|\d*m|[vl]-|-[vl]|-)$/iu.test(
    terminal.id.terminalKey,
  );
}

function ratingSource(
  context: RuleContext,
  t: Terminal,
  rating = JSON.stringify(t.rating),
) {
  return {
    file: t.source.file,
    line: t.source.line,
    column: t.source.column,
    note: `Terminal ${JSON.stringify(context.displayTerminal(t.id))} declares rating ${rating} here.`,
  };
}

function disagree(
  a: Terminal,
  b: Terminal,
  undeclared: ReadonlySet<keyof VoltageFacts>,
): boolean {
  if (!comparable(a) || !comparable(b)) return false;
  const x = a.rating!,
    y = b.rating!;
  if (undeclared.has("voltage_type") && declaredVoltageTypeMismatch(x, y))
    return true;
  // The scalar schema has no voltage-reference or alternative-rating set.
  // Unequal AC nominal values may be line-to-line versus line-to-neutral;
  // unknown/multi-rated classes cannot establish a nominal conflict either.
  // Only explicit DC/DC positive nominal classes are comparable here. Missing
  // AC/DC fields (including multi-rated terminals) cannot establish that conflict.
  return (
    undeclared.has("nominal_voltage") &&
    x.voltage_type === "DC" &&
    y.voltage_type === "DC" &&
    positiveNominalVoltageMismatch(x, y)
  );
}

export const declaredRatingConflictRule: ElectricalRule = {
  id: "W303",
  evaluate(context): Diagnostic[] {
    return ratedNets(context).flatMap((net) => {
      const potentials = context.potentialsForNet(net);
      // Compatible partial declarations assess their union of authored fields.
      // A field declared anywhere remains owned by E300/E301/E302; compare only
      // the omitted fields using the same conservative rating comparisons.
      const undeclared = new Set(
        (["voltage_type", "nominal_voltage"] as const).filter(
          (field) => !potentials.some((p) => p.electrical[field] !== undefined),
        ),
      );
      if (!undeclared.size) return [];
      const terminals = context.terminalsForNet(net);
      const conflicting = terminals
        .filter((a) =>
          terminals.some((b) => a !== b && disagree(a, b, undeclared)),
        )
        .sort((a, b) =>
          compareNatural(
            context.displayTerminal(a.id),
            context.displayTerminal(b.id),
          ),
        );
      if (!conflicting.length) return [];
      const declarations = conflicting.map(
        (t) =>
          `${context.displayTerminal(t.id)} rating ${JSON.stringify(t.rating)} at ${t.source.file}:${t.source.line}:${t.source.column} ${t.source.jsonPointer}`,
      );
      // Anchor at a real conductive assignment, preserving one location per net.
      const source = net.terminalIds
        .flatMap((id) =>
          context
            .conductiveElementIdsForTerminal(id)
            .map(
              (element) => context.directTerminalAssignment(element, id).source,
            ),
        )
        .sort(compareSourceRef)[0]!;
      const assessment = potentials.some((p) => hasVoltageFacts(p.electrical))
        ? `Potential intent on this net does not declare ${[...undeclared].join(" and ")}; voltage compatibility for this field is unassessed.`
        : "No potential declares voltage facts on this net; voltage compatibility is unassessed.";
      return [
        {
          ...source,
          code: "W303",
          severity: "warning",
          message: `Net ${JSON.stringify(net.id)}: these declared ratings disagree: ${declarations.join("; ")}. ${assessment}`,
          related: conflicting.map((t) => ratingSource(context, t)),
        },
      ];
    });
  },
};

export const unassessedRatedNetsRule: ElectricalRule = {
  id: "I304",
  evaluate(context): Diagnostic[] {
    // I304 membership is intentionally unchanged: any authored voltage fact
    // keeps the net out of this summary, even if another field is unassessed.
    const nets = ratedNets(context).filter(
      (net) =>
        !context
          .potentialsForNet(net)
          .some((p) => hasVoltageFacts(p.electrical)),
    );
    if (!nets.length) return [];
    return [
      {
        ...context.ir.project.source,
        code: "I304",
        severity: "info",
        message: `Voltage compatibility is unassessed on rated nets without voltage facts in potentials (${summarizeAffected(
          nets.map((net) => displayNet(context, net)),
          "net",
        )}). Ratings describe equipment capability; potentials declare net intent.`,
      },
    ];
  },
};

/** A single equipment rating cannot establish the voltage intent of its net. */
export const unassessedSingleRatedNetsRule: ElectricalRule = {
  id: "I305",
  evaluate(context): Diagnostic[] {
    const entries = context.ir.nets
      .flatMap((net) => {
        if (
          context.topologicallyAffectedNetIds.has(net.id) ||
          net.conductiveElementIds.length === 0 ||
          context
            .potentialsForNet(net)
            .some((p) => hasVoltageFacts(p.electrical))
        )
          return [];
        // Count all voltage-rated terminals before applying exclusions. I304's
        // multi-rated membership remains unchanged, including reference ratings.
        const rated = context
          .terminalsForNet(net)
          .filter((t) => hasVoltageFacts(t.rating));
        const [terminal] = rated;
        if (rated.length !== 1 || !terminal || !comparable(terminal)) return [];
        // Hydrated IR can reorder object keys without changing authored facts.
        const rating = JSON.stringify(
          terminal.rating,
          Object.keys(terminal.rating ?? {}).sort(),
        );
        return [
          {
            terminal,
            rating,
            summary: `${context.displayTerminal(terminal.id)} rating ${rating} [${net.id}]`,
          },
        ];
      })
      .sort((a, b) => compareNatural(a.summary, b.summary));
    if (!entries.length) return [];
    return [
      {
        ...context.ir.project.source,
        code: "I305",
        severity: "info",
        message: `Voltage compatibility is unassessed on connected nets with one comparable voltage-rated terminal and no voltage facts in potentials (${summarizeAffected(
          entries.map((e) => e.summary),
          "net",
        )}). Ratings describe equipment capability; potentials declare net intent. No supply path was assessed.`,
        related: entries
          .slice(0, 10)
          .map(({ terminal, rating }) =>
            ratingSource(context, terminal, rating),
          ),
      },
    ];
  },
};
