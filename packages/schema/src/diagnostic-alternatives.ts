/** A JSON scalar that a diagnostic can list as one valid alternative. */
export type DiagnosticAllowedValue = string | number | boolean | null;

/** Structured fields listing at most this many valid alternatives. */
export const DIAGNOSTIC_ALLOWED_LIMIT = 50;

/** Diagnostic messages quote at most this many valid alternatives. */
export const DIAGNOSTIC_MESSAGE_ALLOWED_LIMIT = 10;

/**
 * Additive repair-discovery fields shared by diagnostics and tool errors.
 * `allowed` holds the first {@link DIAGNOSTIC_ALLOWED_LIMIT} values of the
 * complete valid set and `allowedCount` its size. `allowedLookup` names an
 * exact place to read the complete set whenever `allowed` is truncated.
 */
export interface DiagnosticAlternatives<
  Value extends DiagnosticAllowedValue = DiagnosticAllowedValue,
> {
  allowed: Value[];
  allowedCount: number;
  allowedLookup?: string;
}

/**
 * Bound a complete, already ordered valid set. The lookup is attached only
 * when the structured list cannot carry every value.
 */
export function boundedAlternatives<Value extends DiagnosticAllowedValue>(
  values: readonly Value[],
  truncatedLookup?: string,
): DiagnosticAlternatives<Value> {
  return {
    allowed: values.slice(0, DIAGNOSTIC_ALLOWED_LIMIT),
    allowedCount: values.length,
    ...(values.length > DIAGNOSTIC_ALLOWED_LIMIT &&
    truncatedLookup !== undefined
      ? { allowedLookup: truncatedLookup }
      : {}),
  };
}

/**
 * Quote at most {@link DIAGNOSTIC_MESSAGE_ALLOWED_LIMIT} values for a message,
 * followed by the number of values omitted from the message and, when the
 * alternatives carry one, the lookup for the complete set.
 */
export function formatAllowedValues(
  alternatives: Readonly<DiagnosticAlternatives>,
): string {
  const shown = alternatives.allowed.slice(0, DIAGNOSTIC_MESSAGE_ALLOWED_LIMIT);
  const list = `[${shown.map((value) => JSON.stringify(value)).join(", ")}]`;
  const omitted = alternatives.allowedCount - shown.length;
  if (omitted <= 0) return list;
  return alternatives.allowedLookup === undefined
    ? `${list} and ${omitted} more`
    : `${list} and ${omitted} more; full list: ${alternatives.allowedLookup}`;
}
