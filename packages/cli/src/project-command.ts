import type { Command } from "commander";
import { resolve } from "node:path";

/** Shared path syntax for the two project lifecycle commands. */
export function projectCommand(
  program: Command,
  name: "validate" | "lock",
): Command {
  return program
    .command(name)
    .description(
      name === "validate"
        ? "validate an electrical-system project"
        : "create or verify the local-library lock",
    )
    .argument("[path]", "project directory or direct manifest path")
    .option(
      "--project <path>",
      "alias for [path]: project directory or direct manifest path",
    )
    .addHelpText(
      "after",
      "\nDefaults to the current directory. If both [path] and --project are supplied, they must resolve to the same path.",
    );
}

export function projectPath(
  command: Command,
  inputPath: string | undefined,
  cwd = process.cwd(),
): string | undefined {
  const { project } = command.opts<{ project?: string }>();
  if (
    inputPath !== undefined &&
    project !== undefined &&
    resolve(cwd, inputPath) !== resolve(cwd, project)
  )
    command.error("error: [path] and --project refer to different paths");
  return inputPath ?? project;
}
