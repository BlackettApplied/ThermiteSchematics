import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { module, context } = JSON.parse(readFileSync(process.argv[2], "utf8"));
try {
  const message = await (
    await import(pathToFileURL(module).href)
  ).default({ ...context, env: process.env });
  console.log(
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: message ?? "Reference complete" },
    }),
  );
  console.log(
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  );
} catch (error) {
  console.error(error.stack ?? error.message);
  console.log(
    JSON.stringify({
      type: "result",
      is_error: true,
      subtype: "reference_error",
      result: error.message,
    }),
  );
  process.exitCode = 1;
}
