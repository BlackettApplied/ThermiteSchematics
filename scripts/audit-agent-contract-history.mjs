import { auditContractHistory } from "./agent-contract-history.mjs";
const result = auditContractHistory();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.additiveOnly ? 0 : 1;
