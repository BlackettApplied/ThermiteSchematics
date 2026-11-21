import { posix } from "node:path";
const acquirers = /^(?:degit|tiged|giget)(?:@[^/]+)?$/;

// These tools download repository trees even when the default GitHub host is
// implicit in owner/repo. No repository acquisition earns an issue exemption.
export function repositoryAcquisition(words = []) {
  const head = posix.basename(words[0] ?? "");
  let index = 0;
  if (["npx", "bunx"].includes(head)) index = 1;
  else if (
    (head === "bun" && words[1] === "x") ||
    (["pnpm", "yarn"].includes(head) && words[1] === "dlx")
  )
    index = 2;
  if (index)
    while (words[index]?.startsWith("-")) {
      const flag = words[index++];
      if (["-p", "--package", "--cache", "--cwd"].includes(flag)) index++;
    }
  if (!acquirers.test(posix.basename(words[index] ?? ""))) return false;
  return words
    .slice(index + 1)
    .some(
      (arg) =>
        !arg.startsWith("-") &&
        /^(?:[\w.-]+\/[\w.-]+(?:[/#].*)?|(?:github|gh|gitlab|bitbucket|sourcehut):.+|[a-z][a-z+.-]*:\/\/.+|git@.+:.+)$/i.test(
          arg,
        ),
    );
}

// Help is local regardless of which subcommand's help is requested. Stop at
// -- so a repository/path literally named --help is not mistaken for a flag.
export function localCommand(words = []) {
  const command = posix.basename(words[0] ?? ""),
    args = words.slice(1),
    flags = args.slice(
      0,
      args.indexOf("--") < 0 ? args.length : args.indexOf("--"),
    );
  if (command === "gh")
    return (
      args[0] === "help" || flags.some((arg) => ["--help", "-h"].includes(arg))
    );
  if (command !== "git") return false;
  const operation = gitOperation(args);
  return (
    operation[0] === "help" ||
    (operation[0] === "archive" &&
      !operation.some((arg) => /^--remote(?:=|$)/.test(arg)))
  );
}
export function gitOperation(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith("-"))
    index += ["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(
      args[index],
    )
      ? 2
      : 1;
  return args.slice(index);
}
