// Output destinations are shell operands. Leave the original command available
// to the caller for evidence and local source checks.
export function argvWithoutOutputRedirects(tokens) {
  if (!tokens) return null;
  const argv = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.control) {
      argv.push(token);
      continue;
    }
    const destination = tokens[++i];
    if (!destination || destination.control || !destination.value) return null;
    if (token.value === ">&") {
      if (!/^\d+$/.test(destination.literal)) return null;
    } else if (
      ![">", ">>"].includes(token.value) ||
      !literalPath(destination)
    ) {
      return null;
    }
  }
  return argv;
}

function literalPath({ literal }) {
  // Remove single-quoted text and protected characters before checking for
  // substitutions. Double quotes protect globs but allow variable expansion.
  const active = literal.replace(
    /\\[\s\S]|'[^']*'|"(?:\\[\s\S]|[^"\\])*"/g,
    (span) =>
      span.startsWith('"') && /\$/.test(span.replace(/\\[\s\S]/g, ""))
        ? "$"
        : "",
  );
  return !/[$*?\[{}]/.test(active) && !/^[~#]/.test(active);
}
