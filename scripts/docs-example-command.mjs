// The watch recipe accepts command words and quoted paths, not shell programs.
// Only documented launchers are replaced with the built engine's entry point.
export function watchArguments(line) {
  const tokens = commandTokens(line);
  const words = tokens.map((token) => token.value);
  if (words[0] === "thermite" && words[1] === "watch") return words.slice(1);
  const launchers = new Set(["thermite.mjs", "/path/to/thermite/thermite.mjs"]);
  // Placeholder identity is syntax, not the decoded filename. The live POSIX
  // examples use exactly this expansion; quoted/escaped literal dollars do not.
  const variable = tokens[1]?.raw === '"$thermite_entry"';
  if (
    words[0] === "bun" &&
    (launchers.has(words[1]) || variable) &&
    words[2] === "watch"
  )
    return words.slice(2);
  throw new Error(`Unsupported watch launcher: ${line}`);
}
function commandTokens(line) {
  const words = [];
  let word = "",
    quote,
    started = false,
    start = 0;
  const push = (end) => {
    if (started) words.push({ value: word, raw: line.slice(start, end) });
    word = "";
    started = false;
  };
  for (let index = 0; index < line.length; index++) {
    const c = line[index];
    if (!started && !/\s/.test(c)) start = index;
    if (quote === "'") {
      if (c === "'") quote = undefined;
      else word += c;
    } else if (c === "\\" && (quote === '"' || !quote)) {
      if (++index === line.length)
        throw new Error("Unfinished watch command escape");
      const next = line[index];
      started = true;
      // Preserve Windows path separators in double-quoted arguments.
      word += quote && !/["\\$`]/.test(next) ? `\\${next}` : next;
    } else if (quote === '"') {
      if (c === '"') quote = undefined;
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) push(index);
    else if (/[;&|<>`]/.test(c))
      throw new Error("Unsupported watch shell operator");
    else {
      word += c;
      started = true;
    }
  }
  if (quote) throw new Error("Unclosed watch command quote");
  push(line.length);
  if (words.slice(2).some(({ value }) => /[$`]/.test(value)))
    throw new Error("Unsupported watch argument expansion");
  return words;
}
