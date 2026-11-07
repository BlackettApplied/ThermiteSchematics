import { ctx, type HelpSpec, type OptionSpec } from "./harness.js";

interface Words {
  readonly words: string[];
  readonly comment?: string;
}
/**
 * Splits a command line. Strict mode accepts only the subset this test can
 * execute: words, quotes without expansion, `<...>` placeholders and a trailing
 * comment. Lenient mode is for inline prose fragments such as `--flow a|b`.
 */
export function splitWords(line: string, strict: boolean): Words {
  const words: string[] = [];
  let word: string | undefined;
  const push = () => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  for (let i = 0; i < line.length;) {
    const c = line[i]!;
    if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end < 0) throw new Error(`Unclosed quote in: ${line}`);
      const inner = line.slice(i + 1, end);
      if (strict && c === '"' && /[$`\\]/.test(inner))
        throw new Error(`Shell expansion is not executable here: ${line}`);
      word = (word ?? "") + inner;
      i = end + 1;
    } else if (/\s/.test(c)) {
      push();
      i += 1;
    } else if (c === "#" && word === undefined) {
      push();
      return { words, comment: line.slice(i + 1).trim() };
    } else if (c === "<") {
      const end = line.indexOf(">", i);
      if (end < 0) throw new Error(`Unclosed placeholder in: ${line}`);
      word = (word ?? "") + line.slice(i, end + 1);
      i = end + 1;
    } else if (strict && /[|&;>$`\\()*?{}[\]!~]/.test(c)) {
      throw new Error(`Unsupported shell syntax "${c}" in: ${line}`);
    } else {
      word = (word ?? "") + c;
      i += 1;
    }
  }
  push();
  return { words };
}
export const isPlaceholder = (word: string) => /<[^<>]*>/.test(word);
/** Expands `<a|b>` alternative words; any other placeholder is unexecutable. */
export function expandAlternatives(words: readonly string[]): string[][] {
  let lines: string[][] = [[]];
  for (const word of words) {
    const alternatives = /^<([^<>|]+(?:\|[^<>|]+)+)>$/.exec(word);
    if (alternatives) {
      const values = alternatives[1]!.split("|");
      lines = lines.flatMap((line) => values.map((value) => [...line, value]));
    } else if (isPlaceholder(word)) {
      throw new Error(`No real value for placeholder ${word}.`);
    } else lines = lines.map((line) => [...line, word]);
  }
  return lines;
}
export const expectedCode = (comment: string | undefined) =>
  /^([A-Z]+\d{3})\b/.exec(comment ?? "")?.[1];

function checkValue(option: OptionSpec, value: string, where: string) {
  if (isPlaceholder(value) || option.choices === undefined) return [];
  const values = value.split("|");
  if (values.length > 1)
    return [...values].sort().join("|") === [...option.choices].sort().join("|")
      ? []
      : [`${where}: ${value} must list exactly ${option.choices.join("|")}`];
  return option.choices.includes(value)
    ? []
    : [`${where}: ${value} is not one of ${option.choices.join("|")}`];
}
/** A prose fragment may name a value-taking flag without its value. */
function checkOptions(
  words: readonly string[],
  spec: HelpSpec,
  where: string,
  fragment = false,
) {
  const problems: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!.replace(/^\[|\]$/g, "");
    if (!word.startsWith("-") || word === "-") continue;
    const option = spec.options.find((o) => o.flags.includes(word));
    if (option === undefined) {
      problems.push(`${where}: unknown option ${word}`);
      continue;
    }
    if (!option.takesValue) continue;
    const value = words[i + 1];
    if (value === undefined || (fragment && value.startsWith("-"))) {
      if (!fragment) problems.push(`${where}: ${word} needs a value`);
      continue;
    }
    i += 1;
    problems.push(...checkValue(option, value, `${where} ${word}`));
  }
  return problems;
}
/** Problems with a `thermite ...` word list against the real command tree. */
export function checkCommand(
  words: readonly string[],
  where: string,
  fragment = false,
): string[] {
  const [name, ...rest] = words;
  const command = name === undefined ? undefined : ctx.tree.commands.get(name);
  if (command === undefined) return [`${where}: unknown command ${name}`];
  if (name !== "agent") return checkOptions(rest, command, where, fragment);
  const [tool, ...options] = rest;
  // A bare `thermite agent` names the command group, not an invocation.
  if (tool === undefined) return [];
  if (tool === "<tool>")
    return [...ctx.tree.tools].flatMap(([n, spec]) =>
      checkOptions(options, spec, `${where} (${n})`, fragment),
    );
  const spec = ctx.tree.tools.get(tool);
  return spec === undefined
    ? [`${where}: unknown agent tool ${tool}`]
    : checkOptions(options, spec, where, fragment);
}
