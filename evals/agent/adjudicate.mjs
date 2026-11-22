#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { adjudicateRun } from "./records.mjs";
const { values } = parseArgs({
  options: {
    run: { type: "string" },
    resolution: { type: "string" },
    reason: { type: "string" },
    operator: { type: "string" },
  },
});
if (!values.run)
  throw new Error(
    "Use --run <attempt-directory> --resolution <infrastructure|agent-failure> --reason <text> --operator <name>",
  );
console.log(JSON.stringify(adjudicateRun(resolve(values.run), values)));
