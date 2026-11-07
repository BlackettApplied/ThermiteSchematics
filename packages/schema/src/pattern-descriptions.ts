const PORTABLE_RELATIVE_PATH =
  'a relative POSIX-style path with no leading "/", drive prefix, backslash or control character';
const CONTAINED_RELATIVE_PATH =
  'a relative POSIX-style path with no leading "/", drive prefix, backslash, control character, or empty, "." or ".." segment';

/**
 * Human-readable descriptions of the raw `pattern` regular expressions used by
 * the canonical schemas. Every canonical pattern must have an entry; the schema
 * tests enforce that.
 */
const SCHEMA_PATTERN_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  [
    "^[EIW][0-9]{3}$",
    'a diagnostic code beginning with "E", "I" or "W", followed by three digits',
  ],
  [
    "^(?:/(?:[^~]|~[01])*)*$",
    'an empty JSON pointer or slash-prefixed segments with "~" escaped as "~0" and "/" as "~1"',
  ],
  ["\\S", "text containing at least one non-whitespace character"],
  [
    "^[^\\u0009\\u000a\\u000d\\u0085\\u2028\\u2029]+$",
    "one non-empty line with no tab, line feed, carriage return, NEL, line separator or paragraph separator",
  ],
  ["^#[0-9a-f]{6}$", 'a lowercase hexadecimal color "#rrggbb"'],
  [
    "^(?!/)(?![A-Za-z]:)(?![\\s\\S]*\\\\)[^\\u0000-\\u001f\\u007f-\\u009f]+$",
    PORTABLE_RELATIVE_PATH,
  ],
  [
    "^(?![A-Za-z]:)(?![\\s\\S]*\\\\)(?!\\.{1,2}(?:/|$))(?![\\s\\S]*/\\.{1,2}(?:/|$))[^\\u0000-\\u001f\\u007f-\\u009f/]+(?:/[^\\u0000-\\u001f\\u007f-\\u009f/]+)*$",
    CONTAINED_RELATIVE_PATH,
  ],
  [
    "^(?!/)(?![A-Za-z]:)(?![\\s\\S]*\\\\)(?!\\.{1,2}(?:/|$))(?![\\s\\S]*/\\.{1,2}(?:/|$))[^\\u0000-\\u001f\\u007f-\\u009f/]+(?:/[^\\u0000-\\u001f\\u007f-\\u009f/]+)*$",
    CONTAINED_RELATIVE_PATH,
  ],
  [
    "^sha256-[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$",
    '"sha256-" followed by a canonical 44-character padded base64 SHA-256 digest',
  ],
  [
    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    "a lowercase canonical UUID (8-4-4-4-12 hexadecimal digits, version 1-8, RFC variant 8, 9, a or b)",
  ],
  [
    "^(?!\\s)(?![\\s\\S]*\\s$)[^\\u0000-\\u001f\\u007f-\\u009f]*$",
    "text with no control character and no leading or trailing whitespace",
  ],
  [
    "^[^\\s:\\u0000-\\u001f\\u007f-\\u009f]+:[^\\s:\\u0000-\\u001f\\u007f-\\u009f]+$",
    'a namespaced type ID "<library>:<name>" with exactly one colon and no whitespace or control character',
  ],
  [
    "^[^\\s:\\u0000-\\u001f\\u007f-\\u009f]+$",
    "a non-empty name with no whitespace, colon or control character",
  ],
  [
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$",
    'a semantic version such as "1.0.0" or "1.0.0-rc.1"',
  ],
  ["^https://[^\\s]+$", "an https:// URL with no whitespace"],
]);

/** Describe a raw schema pattern, quoting the regex when no description exists. */
export function describeSchemaPattern(pattern: string): string {
  return SCHEMA_PATTERN_DESCRIPTIONS.get(pattern) ?? `/${pattern}/`;
}

/** Whether a raw schema pattern has a curated human-readable description. */
export function hasSchemaPatternDescription(pattern: string): boolean {
  return SCHEMA_PATTERN_DESCRIPTIONS.has(pattern);
}
