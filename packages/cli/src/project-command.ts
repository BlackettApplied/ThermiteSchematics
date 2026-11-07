import type { Command } from "commander";

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
      "alias for [path]: project directory or direct manifest path; use only one form",
    )
    .addHelpText(
      "after",
      "\nDefaults to the current directory. Supply [path] or --project <path>, not both.",
    );
}

export function projectPath(
  command: Command,
  inputPath: string | undefined,
): string | undefined {
  const { project } = command.opts<{ project?: string }>();
  if (inputPath !== undefined && project !== undefined)
    command.error("error: specify either [path] or --project <path>, not both");
  return inputPath ?? project;
}
