import { literalShellBody, shellWords } from "./acquisition-command.mjs";
import { decodedShellBody, executedOutput } from "./shell-parts.mjs";
// Quoted Markdown here-docs are authored report data, not source requests.
export function sourceScanInput(
  name,
  values,
  completed = false,
  laterShell = "",
) {
  if (!/^(?:command_execution|bash|shell|exec_command)$/i.test(name))
    return values.join("\n");
  return values
    .map((input) => withoutMarkdownBodies(input, completed, laterShell))
    .join("\n");
}
function withoutMarkdownBodies(input, completed, laterShell) {
  const original = literalShellBody(input);
  const decoded = decodedShellBody(input);
  const lines = decoded.split("\n");
  let removed = false,
    recognized = false;
  for (let i = 0; i < lines.length; i++) {
    const header =
      /^\s*cat\s+(>>?)\s*(?:'([^']+\.md)'|"([^"]+\.md)"|([^\s<>;&|]+\.md))\s+<<\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\5\s*$/.exec(
        lines[i],
      );
    if (!header || (header[1] === ">>" && !completed)) {
      if (lines[i].includes("<<")) {
        // Never mistake lines in somebody else's heredoc for a new command.
        const marker = /<<\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/.exec(
          lines[i],
        );
        if (
          !marker ||
          lines[i].indexOf("<<") !== marker.index ||
          lines[i][marker.index - 1] === "<"
        )
          return original;
        const end = lines.indexOf(marker[2], i + 1);
        if (end < 0) return original;
        i = end;
      } else if (!shellWords(lines[i]) || lines[i].endsWith("\\")) {
        return original;
      }
      continue;
    }
    const output = header[2] ?? header[3] ?? header[4],
      delimiter = header[6];
    let end = i + 1;
    while (end < lines.length && lines[end] !== delimiter) end++;
    if (end === lines.length) continue;
    recognized = true;
    if (
      executedOutput(
        lines[i],
        lines
          .slice(end + 1)
          .concat(laterShell)
          .join("\n"),
      )
    ) {
      i = end;
      continue;
    }
    removed = true;
    lines[i] = `cat > ${JSON.stringify(output)}`;
    for (let j = i + 1; j <= end; j++) lines[j] = "";
    i = end;
  }
  return removed || recognized ? lines.filter(Boolean).join("\n") : original;
}
