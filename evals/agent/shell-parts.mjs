import { literalShellBody, shellWords } from "./acquisition-command.mjs";
import { posix } from "node:path";
import { gitOperation } from "./repository-command.mjs";
const separators = new Set(["&&", "||", ";", "|", "&", "\n"]);
function split(text) {
  const tokens = shellWords(text, { literal: true });
  if (!tokens || tokens.some((t) => t.control && ["<<", "("].includes(t.value)))
    return null;
  const parts = [];
  let start = 0;
  for (let i = 0; i <= tokens.length; i++) {
    if (
      i === tokens.length ||
      (tokens[i].control && separators.has(tokens[i].value))
    ) {
      if (i > start) {
        const selected = tokens.slice(start, i);
        parts.push({
          tokens: selected,
          text: selected.map((t) => t.literal).join(" "),
          separator: tokens[i]?.value,
        });
      }
      start = i + 1;
    }
  }
  return parts;
}
const fileReaders = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "rg",
  "grep",
  "wc",
  "stat",
  "ls",
  "test",
]);
const interpreters = /^(?:sh|bash|zsh|python[\d.]*|node|bun|perl|ruby|deno)$/;

export function decodedShellBody(input) {
  if (!/[\\$]/.test(input)) {
    const words = shellWords(input);
    if (
      words?.length === 3 &&
      /^(?:\/[\w/.-]+\/)?(?:zsh|bash|sh)$/.test(words[0]) &&
      ["-lc", "-c"].includes(words[1])
    )
      return words[2];
  }
  return literalShellBody(input);
}

function literalReferences(text, files) {
  return [...files].some((file) => {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[\\s"'=<>:(])(?:\\./)?${escaped}(?=$|[\\s"';&|<>),])`,
    ).test(text);
  });
}

function commandsOf(tokens) {
  const words = tokens
    .filter((token) => !token.control)
    .map((token) => token.value);
  let head = 0;
  while (words[head]) {
    if (["-u", "--unset"].includes(words[head]) && head > 0) head += 2;
    else if (
      ["env", "command"].includes(posix.basename(words[head])) ||
      /^(?:-i|--ignore-environment|--|--unset=.+|[A-Za-z_]\w*=.*)$/.test(
        words[head],
      )
    )
      head++;
    else break;
  }
  return words.slice(head);
}

function copyOutput(command, args, files) {
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const output = operands.pop();
  if (!output) return;
  for (const input of operands.map((path) => posix.normalize(path))) {
    if (!files.has(input)) continue;
    if (command === "mv") files.delete(input);
    if (!output.endsWith("/")) files.add(posix.normalize(output));
    files.add(posix.join(output, posix.basename(input)));
  }
}

function sedScripts(args) {
  const scripts = [];
  let positional;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      positional ??= args[i + 1];
      break;
    }
    if (arg === "--expression" || /^-[Einr]*e$/.test(arg))
      scripts.push(args[++i]);
    else if (arg.startsWith("--expression=")) scripts.push(arg.slice(13));
    else if (/^-[Einr]*e.+/.test(arg))
      scripts.push(arg.replace(/^-[Einr]*e/, ""));
    else if (arg === "-f" || arg === "--file") return [];
    else if (!arg.startsWith("-")) positional ??= arg;
  }
  return scripts.length ? scripts : [positional];
}

function sedExecutes(args, files) {
  for (const script of sedScripts(args)) {
    for (const instruction of script?.split(/[;\n]/) ?? []) {
      const text = instruction
        .trim()
        .replace(
          /^(?:(?:[\d$]+|\/[^/]*\/)(?:\s*,\s*(?:[\d$]+|\/[^/]*\/))?)\s*!?\s*/,
          "",
        );
      if (/^e(?:\s|$)/.test(text)) return true;
      const flags = /^s(.)(?:\\.|(?!\1).)*\1(?:\\.|(?!\1).)*\1(.*)$/.exec(
        text,
      )?.[2];
      if (flags && /^[a-z0-9]*e/.test(flags)) return true;
      const output =
        /^w\s+(.+)$/.exec(text)?.[1] ??
        /^[a-z0-9]*w\s+(.+)$/.exec(flags ?? "")?.[1];
      if (output) files.add(posix.normalize(output));
    }
  }
  return false;
}

function executesIn(tail, files, executable) {
  const lines = tail.split("\n");
  let pipeInput = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = split(line);
    if (
      !parts &&
      (/^\s*(?:\$\(|`)/.test(line) ||
        /\b(?:bash|sh|zsh)\s+-[\w]*c\b.*(?:\$\(|`)/.test(line)) &&
      literalReferences(line, files)
    )
      return true;
    for (const part of parts ?? []) {
      const [head = "", ...args] = commandsOf(part.tokens);
      const command = posix.basename(head);
      const [gitVerb, ...gitArgs] = command === "git" ? gitOperation(args) : [];
      const named =
        args.some((arg) => files.has(posix.normalize(arg))) ||
        (gitVerb === "show" &&
          gitArgs.some((arg) => {
            const colon = arg.indexOf(":");
            return (
              colon >= 0 && files.has(posix.normalize(arg.slice(colon + 1)))
            );
          }));
      const input = named || pipeInput;
      if (
        files.has(posix.normalize(head)) &&
        (head.includes("/") || executable.has(posix.normalize(head)))
      )
        return true;
      if (["cp", "mv"].includes(command)) copyOutput(command, args, files);
      if (command === "chmod")
        for (const arg of args) {
          const name = posix.normalize(arg);
          if (files.has(name)) executable.add(name);
        }
      if (
        interpreters.test(command) ||
        ["source", ".", "xargs"].includes(command)
      ) {
        const index = /^(?:sh|bash|zsh)$/.test(command)
          ? args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
          : -1;
        const script = index >= 0 ? (args[index + 1] ?? "") : "";
        if (
          input ||
          (script &&
            ((/(?:\$\(|`)/.test(script) && literalReferences(script, files)) ||
              executesIn(script, files, executable)))
        )
          return true;
      }
      if (input && command === "sed" && sedExecutes(args, files)) return true;
      const data =
        fileReaders.has(command) ||
        command === "sed" ||
        ["diff", "show"].includes(gitVerb);
      if (data && input) {
        const redirect = part.tokens.findIndex(
          (token) => token.control && [">", ">>"].includes(token.value),
        );
        if (redirect >= 0 && part.tokens[redirect + 1])
          files.add(posix.normalize(part.tokens[redirect + 1].value));
      }
      pipeInput = part.separator === "|" && input && data;
    }
    const here = /<<\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/.exec(line);
    if (here) {
      const end = lines.indexOf(here[2], i + 1);
      if (end < 0) continue;
      const body = lines.slice(i + 1, end).join("\n");
      if (
        literalReferences(body, files) &&
        /\b(?:exec|eval|source|system|spawn|subprocess)\b/.test(body)
      )
        return true;
      i = end;
    }
  }
  return false;
}

// Track a literal Markdown output and copies through subsequent shell commands.
// Reading or staging file data keeps it inert until it reaches an execution sink.
export function executedOutput(header, tail) {
  const tokens = shellWords(header, { literal: true });
  const index = tokens?.findIndex(
    (token) => token.control && [">", ">>"].includes(token.value),
  );
  const output = index >= 0 && tokens[index + 1]?.value;
  return output
    ? executesIn(tail, new Set([posix.normalize(output)]), new Set())
    : false;
}
export function shellParts(input, laterShell = "") {
  const text = literalShellBody(input),
    lines = text.split("\n"),
    parts = [];
  let pending = [];
  for (let i = 0; i < lines.length; i++) {
    const header = shellWords(lines[i], { literal: true });
    const index = header?.findIndex((t) => t.control && t.value === "<<");
    if (index === undefined || index < 0) {
      pending.push(lines[i]);
      continue;
    }
    const delimiter = header[index + 1];
    if (!delimiter) return null;
    let end = i + 1;
    while (end < lines.length && lines[end] !== delimiter.value) end++;
    if (end === lines.length) return null;
    const head = header
      .filter((_, j) => j !== index && j !== index + 1)
      .map((t) => t.literal)
      .join(" ");
    pending.push(head);
    const selected = split(pending.join("\n"));
    if (!selected?.length) return null;
    selected.at(-1).heredoc = {
      body: lines.slice(i + 1, end).join("\n"),
      quoted: /^["']/.test(delimiter.literal),
      executed: executedOutput(
        head,
        lines
          .slice(end + 1)
          .concat(laterShell)
          .join("\n"),
      ),
    };
    parts.push(...selected);
    pending = [];
    i = end;
  }
  const final = split(pending.join("\n"));
  return final ? [...parts, ...final] : null;
}
export function aggregateParts(results) {
  if (results.some((result) => result.class === "source-read"))
    return { class: "source-read" };
  return {
    class: results.some((result) => result.class === "issue-lookup")
      ? "issue-lookup"
      : "other",
    ...(results.some((result) => result.libraryAcquisition)
      ? { libraryAcquisition: true }
      : {}),
  };
}
