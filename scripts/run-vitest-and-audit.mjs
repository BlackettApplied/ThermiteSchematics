import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { readGitIndexEntries } from "./release-common.mjs";

import {
  RELEASE_REQUIRED_TESTS,
  RELEASE_REPOSITORY,
  assertReleaseAuthority,
  createReleaseAcceptanceEvidence,
  evidenceSha256,
  parseCanonicalEvidence,
  requiredTestsForLedgers,
  serializeEvidence,
} from "./release-evidence-audit.mjs";

const scriptPath = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = resolve(dirname(scriptPath), "..");
const VITEST_VERSION = "4.1.11";
const FIXED_VITEST_OPTIONS = Object.freeze({
  pool: "threads",
  testTimeout: 120000,
  hookTimeout: 120000,
});

function identifier(file, name) {
  return Object.freeze({ file, name });
}

const TASK1_SANDBOX_ROWS = [
  [
    "packages/schema/test/package-smoke.test.ts",
    "packed package > installs into an isolated consumer and validates through installed exports",
  ],
  [
    "packages/compiler/test/package-smoke.test.ts",
    "packed schema, core-library, compiler, query, render, agent-tools, and CLI packages > install together and expose initial agent contracts plus existing APIs and CLI commands",
  ],
  [
    "packages/cli/test/motor-starter-golden.test.ts",
    "Task 8 project-form and repeated-run determinism > matches goldens across repeated fresh CLI processes",
  ],
  [
    "packages/cli/test/query-cli.test.ts",
    "Task 7 exact dotted grammar and Commander addressing > handles quoted-space and leading-dash operands in subprocesses",
  ],
  [
    "packages/cli/test/query-cli.test.ts",
    "Task 7 corrupt-IR subprocess boundary > emits E001 with no stdout when json=false",
  ],
  [
    "packages/cli/test/query-cli.test.ts",
    "Task 7 corrupt-IR subprocess boundary > emits E001 with no stdout when json=true",
  ],
  [
    "packages/cli/test/agent-cli.test.ts",
    "M7 Task 7 thermite agent command namespace > proves the same split streams and exits in built subprocesses",
  ],
  [
    "packages/cli/test/cli.test.ts",
    "thermite compile > replaces an output symlink itself while preserving its former target",
  ],
  [
    "packages/cli/test/cli.test.ts",
    "M3 rule-aware CLI integration > keeps subprocess diagnostics JSON isolated from successful warning IR",
  ],
  [
    "packages/cli/test/cli.test.ts",
    "M3 rule-aware CLI integration > keeps subprocess rule-error diagnostics on stderr with no stdout IR",
  ],
  [
    "packages/cli/test/cli.test.ts",
    "M3 rule-aware CLI integration > rejects all nonexistent CLI surface in subprocesses",
  ],
  [
    "packages/agent-tools/test/determinism.test.ts",
    "D12 complete read-tool determinism > is byte-identical in two fresh Node processes on the active platform",
  ],
  [
    "packages/agent-tools/test/final-audit.test.ts",
    "M7 Task 9 final inventories > proves the docs-bypassing Prettier gate does not ignore an ordinary probe",
  ],
  [
    "packages/render/test/determinism.test.ts",
    "D8 end-to-end determinism > matches both complete source-state matrices in two fresh Node processes",
  ],
  [
    "packages/cli/test/render-cli.test.ts",
    "M5 Task 8 render warnings, expected failures, and tool boundaries > locks the Tier 2 view CLI human and JSON R004 product bytes end to end",
  ],
  [
    "packages/cli/test/render-cli.test.ts",
    "M6 Task 6 view subprocess stream and exit matrix > preserves every D9 row in a fresh process",
  ],
  [
    "packages/cli/test/render-cli.test.ts",
    "M5 Task 8 subprocess boundaries > preserves every Q/R stream shape and raw-code-unit identity in a fresh process",
  ],
  [
    "packages/cli/test/render-cli.test.ts",
    "M5 Task 8 subprocess boundaries > preserves compiler failures and end-of-options parsing in fresh processes",
  ],
  [
    "packages/cli/test/render-motor-starter-golden.test.ts",
    "M5 Task 8 and M6 Task 6 reviewed schematic CLI goldens > matches both split-stream goldens across repeated fresh CLI processes",
  ],
  [
    "packages/cli/test/render-motor-starter-golden.test.ts",
    "M6 amended Task 7 reviewed PNP schematic CLI goldens > matches the four PNP split-stream goldens across repeated fresh CLI processes",
  ],
  [
    "packages/cli/test/agent-motor-starter-golden.test.ts",
    "M7 Task 8 motor-starter agent product workflow > repeats every frozen workflow step through fresh built CLI processes",
  ],
  [
    "packages/compiler/test/loader.test.ts",
    "project loader > rejects a project root that is itself a directory link",
  ],
  [
    "packages/compiler/test/loader.test.ts",
    "project loader > rejects a library root that is itself a directory link",
  ],
  [
    "packages/compiler/test/loader.test.ts",
    "project loader > rejects a junction in a project glob static base",
  ],
  [
    "packages/compiler/test/loader.test.ts",
    "project loader > rejects a junction in a library glob static base",
  ],
  [
    "packages/agent-tools/test/patch-filesystem.test.ts",
    "D10 filesystem safety and rollback > detects a real runtime-created symlink or junction with the real scanner",
  ],
  [
    "packages/agent-tools/test/patch-filesystem.test.ts",
    "D10 filesystem safety and rollback > reports a real linked root as the frozen dot identifier",
  ],
  [
    "packages/agent-tools/test/patch-filesystem.test.ts",
    "D10 real source-chain rechecks > catches a real ancestor swap at the pre-first-write chain check",
  ],
  [
    "packages/agent-tools/test/patch-filesystem.test.ts",
    "D10 real source-chain rechecks > catches a real ancestor swap at a later per-target recheck and rolls back",
  ],
];

export const TASK1_SANDBOX_ALLOWLIST = Object.freeze(
  TASK1_SANDBOX_ROWS.map(([file, name]) => identifier(file, name)),
);

export const WINDOWS_ONLY_IDENTIFIERS = Object.freeze([
  identifier(
    "packages/compiler/test/loader.test.ts",
    "project loader > rejects a junction in a project glob static base",
  ),
  identifier(
    "packages/compiler/test/loader.test.ts",
    "project loader > rejects a junction in a library glob static base",
  ),
  identifier(
    "packages/compiler/test/loader.test.ts",
    "project loader > deduplicates Windows case variants by canonical physical path",
  ),
]);

export const CASE_SENSITIVE_FILESYSTEM_IDENTIFIER = identifier(
  "packages/compiler/test/loader.test.ts",
  "project loader > validates distinct case-variant files when the directory supports them",
);

export const CANDIDATE_IDENTIFIERS = Object.freeze([
  identifier(
    "packages/cli/test/release-install-smoke.test.ts",
    "shared release candidate offline install > installs the injected downloaded candidate without registry or lifecycle execution",
  ),
  identifier(
    "packages/cli/test/empty-folder-smoke.test.ts",
    "installed empty-folder release workflow > runs the complete workflow twice against the injected downloaded candidate",
  ),
]);

const SOURCE_REASON_COUNTS = [
  [
    "packages/schema/test/package-smoke.test.ts",
    [[`skip("The execution sandbox denied child-process creation.")`, 1]],
  ],
  [
    "packages/compiler/test/package-smoke.test.ts",
    [
      [
        `skip("RELEASE-EVIDENCE-DENIED: seven-component package-smoke child-process tier is unavailable.")`,
        2,
      ],
    ],
  ],
  [
    "packages/cli/test/motor-starter-golden.test.ts",
    [[`skip("The execution sandbox denied child-process creation.")`, 1]],
  ],
  [
    "packages/cli/test/query-cli.test.ts",
    [[`skip("The execution sandbox denied child-process creation.")`, 2]],
  ],
  [
    "packages/cli/test/agent-cli.test.ts",
    [
      [
        `skip("The execution sandbox denied agent CLI subprocess creation.")`,
        1,
      ],
    ],
  ],
  [
    "packages/cli/test/cli.test.ts",
    [
      [`skip("The filesystem denied file-symlink creation.")`, 1],
      [`skip("The execution sandbox denied child-process creation.")`, 3],
    ],
  ],
  [
    "packages/agent-tools/test/determinism.test.ts",
    [[`skip("The execution sandbox denied fresh Node child processes.")`, 1]],
  ],
  [
    "packages/agent-tools/test/final-audit.test.ts",
    [
      [
        `skip("The execution sandbox denied the Prettier probe child process.")`,
        1,
      ],
    ],
  ],
  [
    "packages/render/test/determinism.test.ts",
    [[`skip("The execution sandbox denied fresh-process render checks.")`, 1]],
  ],
  [
    "packages/cli/test/render-cli.test.ts",
    [[`skip("The execution sandbox denied child-process creation.")`, 4]],
  ],
  [
    "packages/cli/test/render-motor-starter-golden.test.ts",
    [[`skip("The execution sandbox denied child-process creation.")`, 2]],
  ],
  [
    "packages/cli/test/agent-motor-starter-golden.test.ts",
    [[`skip("The execution sandbox denied child-process creation.")`, 1]],
  ],
  [
    "packages/compiler/test/loader.test.ts",
    [
      [`skip("The filesystem denied directory-link creation.")`, 2],
      [`skip("Windows denied junction creation.")`, 2],
      [`skip("The fixture directory is not case-sensitive.")`, 1],
    ],
  ],
  [
    "packages/agent-tools/test/patch-filesystem.test.ts",
    [["context.skip(`${LINK_SKIP_PREFIX} (${code}).`)", 1]],
  ],
  [
    "packages/cli/test/release-install-smoke.test.ts",
    [
      ["skip(AUTHORITY_ABSENT_REASON)", 1],
      [
        `skip("RELEASE-EVIDENCE-DENIED: isolated offline global-install child-process tier is unavailable.")`,
        1,
      ],
    ],
  ],
  [
    "packages/cli/test/empty-folder-smoke.test.ts",
    [
      ["skip(AUTHORITY_ABSENT_REASON)", 1],
      [
        `skip("RELEASE-EVIDENCE-DENIED: installed empty-folder child-process tier is unavailable.")`,
        1,
      ],
    ],
  ],
];

const RETIRED_TASK1_PACKAGE_SMOKE_TEXTS = Object.freeze([
  [
    "packed schema",
    "compiler",
    "query",
    "render",
    "agent-tools",
    "and CLI packages",
  ].join(", "),
  ["The execution sandbox denied", "pack/install child processes."].join(" "),
  ["The execution sandbox denied", "package-smoke child processes."].join(" "),
]);

const STRICT_EPERM_HELPER_FILES = [
  "packages/compiler/test/package-smoke.test.ts",
  "packages/cli/test/motor-starter-golden.test.ts",
  "packages/cli/test/query-cli.test.ts",
  "packages/cli/test/agent-cli.test.ts",
  "packages/cli/test/cli.test.ts",
  "packages/agent-tools/test/determinism.test.ts",
  "packages/cli/test/render-cli.test.ts",
  "packages/cli/test/render-motor-starter-golden.test.ts",
  "packages/cli/test/agent-motor-starter-golden.test.ts",
  "packages/cli/test/release-install-smoke.test.ts",
  "packages/cli/test/empty-folder-smoke.test.ts",
];

function compactSource(text) {
  return text.replace(/\s+/gu, "");
}

function canonicalSkipCallText(value) {
  return value
    .replace(/\(\s+/u, "(")
    .replace(/,\s*\)$/u, ")")
    .replace(/\s+\)$/u, ")");
}

function inspectTestSource(file, text) {
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length !== 0) {
    throw new Error(`Unable to parse source-freeze file ${file}.`);
  }
  const skipCalls = [];
  const runIfCalls = [];
  const childProcessHelpers = [];
  const junctionHelpers = [];

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "isChildProcessDenied"
    ) {
      childProcessHelpers.push(compactSource(node.getText(sourceFile)));
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "junctionCreationWasDenied"
    ) {
      junctionHelpers.push(compactSource(node.getText(sourceFile)));
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const isSkip =
        (ts.isIdentifier(expression) && expression.text === "skip") ||
        (ts.isPropertyAccessExpression(expression) &&
          expression.name.text === "skip");
      if (isSkip) {
        let parent = node.parent;
        while (parent !== undefined && !ts.isIfStatement(parent)) {
          parent = parent.parent;
        }
        skipCalls.push({
          text: node.getText(sourceFile),
          predicate:
            parent === undefined
              ? ""
              : compactSource(parent.expression.getText(sourceFile)),
        });
      }
      if (
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        ts.isIdentifier(expression.expression.expression) &&
        expression.expression.expression.text === "it" &&
        expression.expression.name.text === "runIf"
      ) {
        const title = node.arguments[0];
        runIfCalls.push({
          predicate: compactSource(
            expression.arguments[0]?.getText(sourceFile) ?? "",
          ),
          title:
            title !== undefined && ts.isStringLiteral(title) ? title.text : "",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { skipCalls, runIfCalls, childProcessHelpers, junctionHelpers };
}

export function auditTask1SourceTexts(sources) {
  if (TASK1_SANDBOX_ALLOWLIST.length !== 29) {
    throw new Error(
      "The Task-1 sandbox allowlist must contain exactly 29 rows.",
    );
  }
  const allowlistKeys = new Set(TASK1_SANDBOX_ALLOWLIST.map(identifierKey));
  if (allowlistKeys.size !== 29) {
    throw new Error("The Task-1 sandbox allowlist contains a duplicate row.");
  }

  const facts = new Map(
    [...sources].map(([file, source]) => [
      file,
      inspectTestSource(file, source),
    ]),
  );
  for (const [file, source] of sources) {
    for (const retired of RETIRED_TASK1_PACKAGE_SMOKE_TEXTS) {
      if (source.includes(retired)) {
        throw new Error(
          `Retired Task-1 package-smoke text remains in ${file}.`,
        );
      }
    }
  }
  const skipCallCount = [...facts.values()].reduce(
    (sum, value) => sum + value.skipCalls.length,
    0,
  );
  const runIfCount = [...facts.values()].reduce(
    (sum, value) => sum + value.runIfCalls.length,
    0,
  );
  if (skipCallCount !== 31) {
    throw new Error(
      `Expected exactly 31 source-frozen skip call sites; found ${skipCallCount}.`,
    );
  }
  if (runIfCount !== 3) {
    throw new Error(
      `Expected exactly three source-frozen it.runIf call sites; found ${runIfCount}.`,
    );
  }

  for (const [file, reasons] of SOURCE_REASON_COUNTS) {
    const fileFacts = facts.get(file);
    if (fileFacts === undefined)
      throw new Error(`Missing source-freeze file ${file}.`);
    for (const [reason, expectedCount] of reasons) {
      const observedCount = fileFacts.skipCalls.filter(
        (call) => canonicalSkipCallText(call.text) === reason,
      ).length;
      if (observedCount !== expectedCount) {
        throw new Error(
          `Task-1 skip reason changed in ${file}: expected ${expectedCount}, found ${observedCount}.`,
        );
      }
    }
  }

  const strictHelper = `functionisChildProcessDenied(error:unknown):boolean{return(typeoferror==="object"&&error!==null&&"code"inerror&&error.code==="EPERM");}`;
  for (const file of STRICT_EPERM_HELPER_FILES) {
    const observed = facts.get(file)?.childProcessHelpers ?? [];
    if (observed.length !== 1 || observed[0] !== strictHelper) {
      throw new Error(`Task-1 skip source predicate changed in ${file}.`);
    }
  }

  const strictDirect = `typeoferror==="object"&&error!==null&&"code"inerror&&error.code==="EPERM"`;
  const predicateRows = [
    ["packages/schema/test/package-smoke.test.ts", strictDirect, 1],
    ["packages/compiler/test/package-smoke.test.ts", strictDirect, 1],
    [
      "packages/compiler/test/package-smoke.test.ts",
      "isChildProcessDenied(error)",
      1,
    ],
    [
      "packages/cli/test/motor-starter-golden.test.ts",
      "isChildProcessDenied(error)",
      1,
    ],
    ["packages/cli/test/query-cli.test.ts", "isChildProcessDenied(error)", 2],
    ["packages/cli/test/agent-cli.test.ts", "isChildProcessDenied(error)", 1],
    ["packages/cli/test/cli.test.ts", "isChildProcessDenied(error)", 3],
    [
      "packages/cli/test/cli.test.ts",
      `typeoferror==="object"&&error!==null&&"code"inerror&&(error.code==="EPERM"||error.code==="EACCES")`,
      1,
    ],
    [
      "packages/agent-tools/test/determinism.test.ts",
      "isChildProcessDenied(error)",
      1,
    ],
    ["packages/agent-tools/test/final-audit.test.ts", `exitCode==="EPERM"`, 1],
    ["packages/render/test/determinism.test.ts", strictDirect, 1],
    ["packages/cli/test/render-cli.test.ts", "isChildProcessDenied(error)", 4],
    [
      "packages/cli/test/render-motor-starter-golden.test.ts",
      "isChildProcessDenied(error)",
      2,
    ],
    [
      "packages/cli/test/agent-motor-starter-golden.test.ts",
      "isChildProcessDenied(error)",
      1,
    ],
    [
      "packages/cli/test/release-install-smoke.test.ts",
      "isChildProcessDenied(error)",
      1,
    ],
    [
      "packages/cli/test/release-install-smoke.test.ts",
      `authority.classifier==="absent"`,
      1,
    ],
    [
      "packages/cli/test/empty-folder-smoke.test.ts",
      "isChildProcessDenied(error)",
      1,
    ],
    [
      "packages/cli/test/empty-folder-smoke.test.ts",
      `authority.classifier==="absent"`,
      1,
    ],
    [
      "packages/compiler/test/loader.test.ts",
      "junctionCreationWasDenied(error)",
      4,
    ],
    [
      "packages/compiler/test/loader.test.ts",
      "upperStat.dev===lowerStat.dev&&upperStat.ino===lowerStat.ino",
      1,
    ],
    [
      "packages/agent-tools/test/patch-filesystem.test.ts",
      `code==="EPERM"||code==="EACCES"||code==="ENOSYS"`,
      1,
    ],
  ];
  for (const [file, predicate, expectedCount] of predicateRows) {
    const observedCount =
      facts.get(file)?.skipCalls.filter((call) => call.predicate === predicate)
        .length ?? 0;
    if (observedCount !== expectedCount) {
      throw new Error(`Task-1 skip source predicate changed in ${file}.`);
    }
  }

  const junctionHelper = `functionjunctionCreationWasDenied(error:unknown):boolean{return(typeoferror==="object"&&error!==null&&"code"inerror&&["EACCES","EPERM","ENOTSUP"].includes(String(error.code)));}`;
  const loaderFacts = facts.get("packages/compiler/test/loader.test.ts");
  if (
    loaderFacts?.junctionHelpers.length !== 1 ||
    loaderFacts.junctionHelpers[0] !== junctionHelper
  ) {
    throw new Error("Task-1 junction source predicate changed.");
  }
  const expectedRunIf = [
    "rejects a junction in a project glob static base",
    "rejects a junction in a library glob static base",
    "deduplicates Windows case variants by canonical physical path",
  ].map((title) => ({ predicate: `process.platform==="win32"`, title }));
  if (
    JSON.stringify(loaderFacts.runIfCalls) !== JSON.stringify(expectedRunIf)
  ) {
    throw new Error("Windows-only source predicate or title changed.");
  }
}

export async function auditTask1RepositorySources(
  repositoryRoot = REPOSITORY_ROOT,
) {
  const trackedTests = await trackedTestFiles(repositoryRoot);
  const sources = new Map(
    await Promise.all(
      [...trackedTests.keys()].map(async (file) => [
        file,
        await readFile(join(repositoryRoot, ...file.split("/")), "utf8"),
      ]),
    ),
  );
  auditTask1SourceTexts(sources);

  const [workflow, authority] = await Promise.all([
    readFile(join(repositoryRoot, ".github", "workflows", "ci.yml")),
    readFile(join(repositoryRoot, "scripts", "ordinary-ci.authority.yml")),
  ]);
  if (!workflow.equals(authority)) {
    throw new Error(
      ".github/workflows/ci.yml differs from its Task-1 byte authority.",
    );
  }
}

function identifierKey(value) {
  return `${value.file}\u0000${value.name}`;
}

function displayIdentifier(value) {
  return `${value.file} :: ${value.name}`;
}

function assertIdentifierShape(value) {
  if (
    typeof value.file !== "string" ||
    typeof value.name !== "string" ||
    value.file === "" ||
    value.name === ""
  ) {
    throw new Error("Invalid canonical test identifier.");
  }
  if (/[\\\u0000-\u001f\u007f]/u.test(value.file) || isAbsolute(value.file)) {
    throw new Error(
      `Invalid canonical test file ${JSON.stringify(value.file)}.`,
    );
  }
  if (
    value.file
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(
      `Invalid canonical test file ${JSON.stringify(value.file)}.`,
    );
  }
  if (/[\u0009\u000a\u000d\u0085\u2028\u2029]/u.test(value.name)) {
    throw new Error(
      `Invalid multiline canonical assertion name in ${value.file}.`,
    );
  }
}

export function auditAssertionOccurrences(
  occurrences,
  {
    platform = process.platform,
    authority = "ordinary",
    requireCompletePolicy = true,
    candidateSidecars = new Map(),
  } = {},
) {
  if (platform !== "win32" && platform !== "linux") {
    throw new Error(`Unsupported audit platform ${JSON.stringify(platform)}.`);
  }
  if (authority !== "ordinary" && authority !== "task") {
    throw new Error(
      `Unsupported audit authority ${JSON.stringify(authority)}.`,
    );
  }

  const ordinaryKeys = new Set(TASK1_SANDBOX_ALLOWLIST.map(identifierKey));
  const windowsOnlyKeys = new Set(WINDOWS_ONLY_IDENTIFIERS.map(identifierKey));
  const caseSensitiveKey = identifierKey(CASE_SENSITIVE_FILESYSTEM_IDENTIFIER);
  const candidateKeys = new Set(CANDIDATE_IDENTIFIERS.map(identifierKey));
  const enumerated = new Map();
  for (const row of [
    ...TASK1_SANDBOX_ALLOWLIST,
    ...WINDOWS_ONLY_IDENTIFIERS,
    CASE_SENSITIVE_FILESYSTEM_IDENTIFIER,
    ...CANDIDATE_IDENTIFIERS,
  ]) {
    enumerated.set(identifierKey(row), row);
  }

  const grouped = new Map();
  for (const occurrence of occurrences) {
    assertIdentifierShape(occurrence);
    const key = identifierKey(occurrence);
    const group = grouped.get(key) ?? [];
    group.push(occurrence);
    grouped.set(key, group);

    if (
      !new Set(["passed", "skipped", "failed", "pending", "todo"]).has(
        occurrence.status,
      )
    ) {
      throw new Error(
        `Unknown Vitest status for ${displayIdentifier(occurrence)}.`,
      );
    }
    if (
      occurrence.status === "failed" ||
      occurrence.status === "pending" ||
      occurrence.status === "todo"
    ) {
      throw new Error(
        `Disallowed ${occurrence.status} outcome for ${displayIdentifier(occurrence)}.`,
      );
    }
  }

  for (const [key, row] of enumerated) {
    const count = grouped.get(key)?.length ?? 0;
    if (count > 1 || (requireCompletePolicy && count !== 1)) {
      throw new Error(
        `Expected exactly one REQUIRED policy row for ${displayIdentifier(row)}; found ${count}.`,
      );
    }
  }

  for (const occurrence of occurrences) {
    const key = identifierKey(occurrence);
    if (candidateKeys.has(key)) {
      const sidecar = candidateSidecars.get(key);
      if (sidecar === undefined) {
        throw new Error(
          `Candidate assertion lacks its runtime sidecar: ${displayIdentifier(occurrence)}.`,
        );
      }
      if (occurrence.status === "skipped") {
        if (
          authority === "task" &&
          sidecar.outcome?.status === "executed" &&
          ["local-task6-complete", "protected-consumer-complete"].includes(
            sidecar.outcome.authorityClassifier,
          ) &&
          sidecar.outcome.branch === "RELEASE-CANDIDATE-INJECTED"
        ) {
          continue;
        }
        if (
          authority !== "ordinary" ||
          sidecar.outcome?.status !== "skipped" ||
          sidecar.outcome.authorityClassifier !== "absent" ||
          sidecar.outcome.branch !== "RELEASE-CANDIDATE-AUTHORITY-ABSENT" ||
          sidecar.outcome.reason !==
            "RELEASE-CANDIDATE-AUTHORITY-ABSENT: candidate injection is not available in ordinary CI."
        ) {
          throw new Error(
            `Candidate authority-absent branch mismatch: ${displayIdentifier(occurrence)}.`,
          );
        }
        continue;
      }
      if (
        occurrence.status !== "passed" ||
        authority !== "task" ||
        sidecar.outcome?.status !== "executed" ||
        !["local-task6-complete", "protected-consumer-complete"].includes(
          sidecar.outcome.authorityClassifier,
        ) ||
        sidecar.outcome.branch !== "RELEASE-CANDIDATE-INJECTED"
      ) {
        throw new Error(
          `Candidate injected branch mismatch: ${displayIdentifier(occurrence)}.`,
        );
      }
      continue;
    }
    if (occurrence.status === "passed") continue;
    if (platform === "linux" && windowsOnlyKeys.has(key)) continue;
    if (platform === "win32" && key === caseSensitiveKey) continue;
    if (authority === "ordinary" && ordinaryKeys.has(key)) continue;
    throw new Error(
      `Disallowed skipped outcome for ${displayIdentifier(occurrence)}.`,
    );
  }

  if (platform === "win32") {
    const deduplicationKey = identifierKey(WINDOWS_ONLY_IDENTIFIERS[2]);
    if (
      grouped.has(deduplicationKey) &&
      grouped.get(deduplicationKey)?.[0]?.status !== "passed"
    ) {
      throw new Error("The Windows case-deduplication assertion must pass.");
    }
  } else if (
    grouped.has(caseSensitiveKey) &&
    grouped.get(caseSensitiveKey)?.[0]?.status !== "passed"
  ) {
    throw new Error(
      "The case-sensitive-filesystem assertion must pass on Ubuntu.",
    );
  }

  return occurrences;
}

export async function trackedTestFiles(repositoryRoot = REPOSITORY_ROOT) {
  const entries = await readGitIndexEntries(repositoryRoot);
  const tracked = new Map();
  let runnerTracked = false;
  let task2PackageManifestTracked = false;
  for (const { path: file, mode } of entries) {
    if (file === "scripts/run-vitest-and-audit.mjs") runnerTracked = true;
    if (file === "packages/core-library/package.json") {
      task2PackageManifestTracked = true;
    }
    if (!file.endsWith(".test.ts")) continue;
    if (
      (mode !== "100644" && mode !== "100755") ||
      file.includes(String.fromCodePoint(92))
    ) {
      throw new Error(
        `Tracked test path is not an ordinary POSIX file: ${file}.`,
      );
    }
    tracked.set(file, mode);
  }
  const task1MetadataTest = "packages/compiler/test/package-metadata.test.ts";
  if (!tracked.has(task1MetadataTest)) {
    if (runnerTracked) {
      throw new Error(
        `Required tracked test file is absent: ${task1MetadataTest}.`,
      );
    }
    const pendingStat = await lstat(
      join(repositoryRoot, ...task1MetadataTest.split("/")),
    );
    if (!pendingStat.isFile() || pendingStat.isSymbolicLink()) {
      throw new Error(
        `Pending Task-1 test path is not ordinary: ${task1MetadataTest}.`,
      );
    }
    tracked.set(task1MetadataTest, "100644");
  }
  const task2CoreTest = "packages/core-library/test/package-files.test.ts";
  if (!tracked.has(task2CoreTest)) {
    const task2PackageManifest = "packages/core-library/package.json";
    if (task2PackageManifestTracked) {
      throw new Error(
        `Required tracked test file is absent: ${task2CoreTest}.`,
      );
    }
    const [manifestStat, testStat] = await Promise.all([
      lstat(join(repositoryRoot, ...task2PackageManifest.split("/"))),
      lstat(join(repositoryRoot, ...task2CoreTest.split("/"))),
    ]);
    if (
      !manifestStat.isFile() ||
      manifestStat.isSymbolicLink() ||
      !testStat.isFile() ||
      testStat.isSymbolicLink()
    ) {
      throw new Error(
        `Pending Task-2 package/test paths are not ordinary: ${task2CoreTest}.`,
      );
    }
    tracked.set(task2CoreTest, "100644");
  }
  for (const task6Test of [
    "packages/cli/test/release-package.test.ts",
    "packages/cli/test/release-install-smoke.test.ts",
    "packages/cli/test/empty-folder-smoke.test.ts",
  ]) {
    if (tracked.has(task6Test)) continue;
    const pendingStat = await lstat(
      join(repositoryRoot, ...task6Test.split("/")),
    );
    if (!pendingStat.isFile() || pendingStat.isSymbolicLink()) {
      throw new Error(
        `Pending Task-6 test path is not ordinary: ${task6Test}.`,
      );
    }
    tracked.set(task6Test, "100644");
  }
  const task9Test = "packages/cli/test/workflow-structure.test.ts";
  if (!tracked.has(task9Test)) {
    const pendingStat = await lstat(
      join(repositoryRoot, ...task9Test.split("/")),
    );
    if (!pendingStat.isFile() || pendingStat.isSymbolicLink()) {
      throw new Error(
        `Pending Task-9 test path is not ordinary: ${task9Test}.`,
      );
    }
    tracked.set(task9Test, "100644");
  }
  return tracked;
}

export async function normalizeVitestSuiteFile(
  rawName,
  repositoryRoot,
  trackedFiles,
) {
  if (typeof rawName !== "string" || !isAbsolute(rawName)) {
    throw new Error("Vitest suite names must be absolute paths.");
  }
  const sourceStat = await lstat(rawName);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("Vitest suite paths must identify ordinary files.");
  }
  const [canonicalRoot, canonicalFile] = await Promise.all([
    realpath(repositoryRoot),
    realpath(rawName),
  ]);
  const nativeRelative = relative(canonicalRoot, canonicalFile);
  if (
    nativeRelative === "" ||
    nativeRelative === ".." ||
    nativeRelative.startsWith(`..${sep}`) ||
    isAbsolute(nativeRelative)
  ) {
    throw new Error("Vitest suite path escaped the checkout.");
  }
  const backslash = String.fromCodePoint(92);
  const file =
    sep === backslash
      ? nativeRelative.replaceAll(backslash, "/")
      : nativeRelative;
  assertIdentifierShape({ file, name: "probe" });
  if (!trackedFiles.has(file)) {
    throw new Error(
      `Vitest suite path is not an exact-case tracked test file: ${file}.`,
    );
  }
  return file;
}

export function canonicalAssertionName(assertion) {
  if (
    !Array.isArray(assertion.ancestorTitles) ||
    !assertion.ancestorTitles.every((value) => typeof value === "string") ||
    typeof assertion.title !== "string"
  ) {
    throw new Error("Vitest assertion titles have an invalid shape.");
  }
  const components = [...assertion.ancestorTitles, assertion.title];
  if (
    components.some(
      (value) =>
        value === "" || /[\u0009\u000a\u000d\u0085\u2028\u2029]/u.test(value),
    )
  ) {
    throw new Error(
      "Vitest assertion title components must be nonempty and single-line.",
    );
  }
  return components.join(" > ");
}

export async function normalizeVitestReport(
  report,
  { repositoryRoot = REPOSITORY_ROOT, trackedFiles } = {},
) {
  if (
    typeof report !== "object" ||
    report === null ||
    !Array.isArray(report.testResults)
  ) {
    throw new Error("Vitest JSON report has an invalid root shape.");
  }
  const tracked = trackedFiles ?? (await trackedTestFiles(repositoryRoot));
  const occurrences = [];
  for (const suite of report.testResults) {
    if (
      typeof suite !== "object" ||
      suite === null ||
      !Array.isArray(suite.assertionResults)
    ) {
      throw new Error("Vitest JSON report has an invalid suite shape.");
    }
    const file = await normalizeVitestSuiteFile(
      suite.name,
      repositoryRoot,
      tracked,
    );
    for (const assertion of suite.assertionResults) {
      occurrences.push({
        file,
        name: canonicalAssertionName(assertion),
        status: assertion.status,
      });
    }
  }
  return occurrences;
}

const CANDIDATE_SIDECAR_FILES = Object.freeze([
  ["release-install-smoke.branch.json", CANDIDATE_IDENTIFIERS[0]],
  ["empty-folder-smoke.branch.json", CANDIDATE_IDENTIFIERS[1]],
]);

async function readCandidateSidecars(sidecarRoot, expectedFiles) {
  const names = (await readdir(sidecarRoot)).sort();
  const expectedNames = expectedFiles.map(([name]) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(
      "Candidate runtime sidecar set is missing or contains an extra file.",
    );
  }
  const records = new Map();
  for (const [name, identifier_] of expectedFiles) {
    const path = join(sidecarRoot, name);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error(`Candidate sidecar is non-ordinary: ${name}.`);
    const record = JSON.parse(await readFile(path, "utf8"));
    if (
      record?.format !== "thermite-schematics-release-test-branch/0.1" ||
      JSON.stringify(record.test) !== JSON.stringify(identifier_) ||
      record.outcome === null ||
      typeof record.outcome !== "object"
    ) {
      throw new Error(
        `Candidate sidecar has an invalid closed record: ${name}.`,
      );
    }
    const expectedOutcomeKeys =
      record.outcome.status === "skipped"
        ? ["status", "authorityClassifier", "branch", "reason"]
        : ["status", "authorityClassifier", "branch"];
    if (
      JSON.stringify(Object.keys(record)) !==
        JSON.stringify(["format", "test", "outcome"]) ||
      JSON.stringify(Object.keys(record.test)) !==
        JSON.stringify(["file", "name"]) ||
      JSON.stringify(Object.keys(record.outcome)) !==
        JSON.stringify(expectedOutcomeKeys)
    ) {
      throw new Error(
        `Candidate sidecar contains unknown or reordered keys: ${name}.`,
      );
    }
    records.set(identifierKey(identifier_), record);
  }
  return records;
}

export function createCanonicalTestEvidenceManifest(
  occurrences,
  required,
  candidateSidecars = new Map(),
) {
  const grouped = new Map();
  for (const occurrence of occurrences) {
    const key = identifierKey(occurrence);
    const group = grouped.get(key) ?? [];
    group.push(occurrence);
    grouped.set(key, group);
  }
  const seenRequired = new Set();
  const tests = required.map((row) => {
    assertIdentifierShape(row);
    const key = identifierKey(row);
    if (seenRequired.has(key)) {
      throw new Error(
        `Duplicate REQUIRED manifest row: ${displayIdentifier(row)}.`,
      );
    }
    seenRequired.add(key);
    const matches = grouped.get(key) ?? [];
    if (matches.length !== 1 || matches[0].status !== "passed") {
      throw new Error(
        `REQUIRED manifest row did not pass exactly once: ${displayIdentifier(row)}.`,
      );
    }
    const sidecar = candidateSidecars.get(key);
    const outcome =
      sidecar === undefined
        ? { status: "passed" }
        : {
            status: "passed",
            authorityClassifier: sidecar.outcome.authorityClassifier,
            branch: sidecar.outcome.branch,
          };
    return {
      identifier: { file: row.file, name: row.name },
      outcome,
    };
  });
  tests.sort((left, right) => {
    if (left.identifier.file !== right.identifier.file) {
      return left.identifier.file < right.identifier.file ? -1 : 1;
    }
    return left.identifier.name < right.identifier.name
      ? -1
      : left.identifier.name > right.identifier.name
        ? 1
        : 0;
  });
  return { format: "thermite-schematics-audited-tests/0.1", tests };
}

export function serializeCanonicalTestEvidenceManifest(manifest) {
  return `${JSON.stringify(manifest, undefined, 2)}\n`;
}

async function assertPinnedVitest(repositoryRoot) {
  const packageMetadata = JSON.parse(
    await readFile(
      join(repositoryRoot, "node_modules", "vitest", "package.json"),
      "utf8",
    ),
  );
  if (packageMetadata.version !== VITEST_VERSION) {
    throw new Error(
      `Expected repo-pinned Vitest ${VITEST_VERSION}; found ${String(packageMetadata.version)}.`,
    );
  }
}

async function runVitestProgrammatically(
  repositoryRoot,
  testFiles,
  rawReportPath,
) {
  const { startVitest } = await import("vitest/node");
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await startVitest("test", testFiles, {
      root: repositoryRoot,
      run: true,
      watch: false,
      reporters: ["json"],
      outputFile: rawReportPath,
      ...FIXED_VITEST_OPTIONS,
    });
    if (process.exitCode !== undefined && process.exitCode !== 0) {
      await printVitestFailures(rawReportPath);
      throw new Error(`Vitest exited with code ${String(process.exitCode)}.`);
    }
  } finally {
    process.exitCode = previousExitCode;
  }
}

async function printVitestFailures(rawReportPath) {
  try {
    const report = JSON.parse(await readFile(rawReportPath, "utf8"));
    const failures = [];
    for (const file of report.testResults ?? []) {
      const assertions = file.assertionResults ?? [];
      for (const assertion of assertions) {
        if (assertion.status === "failed") {
          failures.push({
            file: file.name,
            name: assertion.fullName,
            messages: assertion.failureMessages ?? [],
          });
        }
      }
      if (assertions.length === 0 && file.status === "failed") {
        failures.push({
          file: file.name,
          name: "(file-level failure)",
          messages: [file.message ?? ""],
        });
      }
    }
    process.stderr.write(
      `Vitest reported ${String(failures.length)} failed test(s).\n`,
    );
    for (const failure of failures) {
      process.stderr.write(`FAIL ${failure.file} > ${failure.name}\n`);
      for (const message of failure.messages) {
        const lines = String(message).split("\n").slice(0, 12);
        process.stderr.write(
          `${lines.map((line) => `    ${line}`).join("\n")}\n`,
        );
      }
    }
  } catch (error) {
    process.stderr.write(
      `Vitest failure details are unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

async function prepareProtectedConsumerInjection({
  repositoryRoot,
  candidatePath,
  authorityPath,
}) {
  if (!isAbsolute(candidatePath) || !isAbsolute(authorityPath)) {
    throw new Error("Protected consumer paths must be absolute.");
  }
  const candidateStats = await lstat(candidatePath, { bigint: true });
  if (
    !candidateStats.isFile() ||
    candidateStats.isSymbolicLink() ||
    candidateStats.nlink !== 1n
  ) {
    throw new Error("Protected consumer candidate is not an ordinary file.");
  }
  const [rootReal, candidateReal] = await Promise.all([
    realpath(repositoryRoot),
    realpath(candidatePath),
  ]);
  const candidateRelative = relative(rootReal, candidateReal);
  if (
    candidateRelative === "" ||
    (!candidateRelative.startsWith(`..${sep}`) &&
      candidateRelative !== ".." &&
      !isAbsolute(candidateRelative))
  ) {
    throw new Error(
      "Protected consumer candidate must be outside the checkout.",
    );
  }
  const authorityBytes = await readFile(authorityPath);
  const authority = assertReleaseAuthority(
    parseCanonicalEvidence(authorityBytes, "consumer authority"),
  );
  await verifyProtectedConsumerArtifactAuthority(authority);
  const candidateBytes = await readFile(candidatePath);
  const sha256 = createHash("sha256").update(candidateBytes).digest("hex");
  const previous = Object.fromEntries(
    [
      "THERMITE_SCHEMATICS_RELEASE_AUTHORITY",
      "THERMITE_SCHEMATICS_RELEASE_CANDIDATE",
      "THERMITE_SCHEMATICS_RELEASE_CANDIDATE_SHA256",
      "THERMITE_SCHEMATICS_RELEASE_AUTHORITY_JSON",
    ].map((key) => [key, process.env[key]]),
  );
  process.env.THERMITE_SCHEMATICS_RELEASE_AUTHORITY = "protected-consumer";
  process.env.THERMITE_SCHEMATICS_RELEASE_CANDIDATE = candidateReal;
  process.env.THERMITE_SCHEMATICS_RELEASE_CANDIDATE_SHA256 = sha256;
  process.env.THERMITE_SCHEMATICS_RELEASE_AUTHORITY_JSON =
    authorityBytes.toString("utf8");
  return {
    authority,
    candidatePath: candidateReal,
    candidateSha256: sha256,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

export async function verifyProtectedConsumerArtifactAuthority(
  authority,
  { environment = process.env, request = fetch } = {},
) {
  assertReleaseAuthority(authority);
  const token = environment.GITHUB_TOKEN;
  if (
    environment.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
    typeof token !== "string" ||
    token === ""
  ) {
    throw new Error("Protected consumer API authority is absent.");
  }
  const response = await request(
    `https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/artifacts/${authority.candidateArtifact.id}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Protected consumer artifact query failed with ${response.status}.`,
    );
  }
  const artifact = await response.json();
  if (
    String(artifact?.id) !== authority.candidateArtifact.id ||
    artifact?.name !== authority.candidateArtifact.name ||
    artifact?.expired !== false ||
    artifact?.digest !== authority.candidateArtifact.digest ||
    String(artifact?.workflow_run?.id) !== authority.workflow.runId
  ) {
    throw new Error(
      "Protected consumer artifact API identity differs from authority.",
    );
  }
  return artifact;
}

function sameRequiredRows(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runVitestAndAudit({
  repositoryRoot = REPOSITORY_ROOT,
  testFiles = [],
  platform = process.platform,
  authority = "ordinary",
  manifestPath,
  required = [],
  evidencePath,
  candidatePath,
  authorityPath,
  evidenceOs,
  evidenceNode,
  evidenceSource,
} = {}) {
  if ((manifestPath === undefined) !== (required.length === 0)) {
    throw new Error(
      "A canonical manifest path and at least one REQUIRED row must be supplied together.",
    );
  }
  await auditTask1RepositorySources(repositoryRoot);
  await assertPinnedVitest(repositoryRoot);

  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "thermite-schematics-vitest-audit-"),
  );
  const owned = await lstat(temporaryRoot, { bigint: true });
  if (!owned.isDirectory() || owned.isSymbolicLink()) {
    throw new Error(
      "The Vitest audit temporary root is not an ordinary directory.",
    );
  }
  const rawReportPath = join(temporaryRoot, "vitest.json");
  const selectedCandidateFiles = CANDIDATE_SIDECAR_FILES.filter(
    ([, row]) => testFiles.length === 0 || testFiles.includes(row.file),
  );
  const sidecarRoot = join(temporaryRoot, "sidecars");
  const previousSidecarRoot =
    process.env.THERMITE_SCHEMATICS_RELEASE_BRANCH_SIDECAR_DIR;
  let consumerInjection;

  try {
    if (evidencePath !== undefined) {
      if (
        manifestPath === undefined ||
        candidatePath === undefined ||
        authorityPath === undefined ||
        evidenceOs === undefined ||
        evidenceNode === undefined ||
        evidenceSource !== "downloaded-m8-cli-candidate" ||
        !sameRequiredRows(required, RELEASE_REQUIRED_TESTS)
      ) {
        throw new Error(
          "Protected consumer evidence arguments are incomplete.",
        );
      }
      consumerInjection = await prepareProtectedConsumerInjection({
        repositoryRoot,
        candidatePath,
        authorityPath,
      });
    }
    if (selectedCandidateFiles.length > 0) {
      await mkdir(sidecarRoot);
      process.env.THERMITE_SCHEMATICS_RELEASE_BRANCH_SIDECAR_DIR = sidecarRoot;
    }
    await runVitestProgrammatically(repositoryRoot, testFiles, rawReportPath);

    const entries = (await readdir(temporaryRoot)).sort();
    const expectedEntries =
      selectedCandidateFiles.length === 0
        ? ["vitest.json"]
        : ["sidecars", "vitest.json"];
    if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
      throw new Error(
        "The owned Vitest audit root contains an unexpected path.",
      );
    }
    const rawStat = await lstat(rawReportPath);
    if (!rawStat.isFile() || rawStat.isSymbolicLink()) {
      throw new Error("The raw Vitest report is not an ordinary owned file.");
    }
    const report = JSON.parse(await readFile(rawReportPath, "utf8"));
    const occurrences = await normalizeVitestReport(report, { repositoryRoot });
    const candidateSidecars =
      selectedCandidateFiles.length === 0
        ? new Map()
        : await readCandidateSidecars(sidecarRoot, selectedCandidateFiles);
    auditAssertionOccurrences(occurrences, {
      platform,
      authority,
      requireCompletePolicy: testFiles.length === 0,
      candidateSidecars,
    });
    if (report.success !== true) {
      throw new Error("Vitest did not report a successful run.");
    }
    if (manifestPath !== undefined) {
      const canonicalManifestPath = resolve(repositoryRoot, manifestPath);
      const releaseRoot = resolve(repositoryRoot, "release-out");
      const relativeManifest = relative(releaseRoot, canonicalManifestPath);
      if (
        relativeManifest === "" ||
        relativeManifest === ".." ||
        relativeManifest.startsWith(`..${sep}`) ||
        isAbsolute(relativeManifest)
      ) {
        throw new Error(
          "Canonical test evidence must be written below release-out.",
        );
      }
      const manifest = createCanonicalTestEvidenceManifest(
        occurrences,
        required,
        candidateSidecars,
      );
      const manifestBytes = Buffer.from(
        serializeCanonicalTestEvidenceManifest(manifest),
        "utf8",
      );
      await mkdir(dirname(canonicalManifestPath), { recursive: true });
      await writeFile(canonicalManifestPath, manifestBytes, { flag: "w" });
      if (evidencePath !== undefined) {
        const canonicalEvidencePath = resolve(repositoryRoot, evidencePath);
        const relativeEvidence = relative(releaseRoot, canonicalEvidencePath);
        if (
          relativeEvidence === "" ||
          relativeEvidence === ".." ||
          relativeEvidence.startsWith(`..${sep}`) ||
          isAbsolute(relativeEvidence) ||
          consumerInjection === undefined
        ) {
          throw new Error(
            "Release acceptance evidence must be written below release-out.",
          );
        }
        const evidence = createReleaseAcceptanceEvidence({
          authority: consumerInjection.authority,
          os: evidenceOs,
          node: evidenceNode,
          candidateSha256: consumerInjection.candidateSha256,
          source: evidenceSource,
          testManifestFile: canonicalManifestPath,
          testManifestBytes: manifestBytes,
        });
        await mkdir(dirname(canonicalEvidencePath), { recursive: true });
        await writeFile(canonicalEvidencePath, serializeEvidence(evidence), {
          encoding: "utf8",
          flag: "wx",
        });
      }
    }
    return occurrences;
  } finally {
    if (previousSidecarRoot === undefined) {
      delete process.env.THERMITE_SCHEMATICS_RELEASE_BRANCH_SIDECAR_DIR;
    } else {
      process.env.THERMITE_SCHEMATICS_RELEASE_BRANCH_SIDECAR_DIR =
        previousSidecarRoot;
    }
    consumerInjection?.restore();
    const observed = await lstat(temporaryRoot, { bigint: true });
    if (
      !observed.isDirectory() ||
      observed.isSymbolicLink() ||
      observed.dev !== owned.dev ||
      observed.ino !== owned.ino
    ) {
      throw new Error("The Vitest audit temporary-root identity changed.");
    }
    await rm(temporaryRoot, { recursive: true, force: false });
  }
}

function parseArguments(argv) {
  if (argv.length === 0) {
    return { testFiles: [], authority: "ordinary", required: [] };
  }
  if (argv[0] === "--") {
    return {
      testFiles: argv.slice(1),
      authority: "ordinary",
      required: [],
    };
  }
  if (
    argv.length >= 15 &&
    argv[0] === "--manifest" &&
    argv[2] === "--evidence" &&
    argv[4] === "--candidate" &&
    argv[6] === "--authority" &&
    argv[8] === "--os" &&
    argv[10] === "--node" &&
    argv[12] === "--source" &&
    argv[14] === "--"
  ) {
    if (
      [1, 3, 5, 7, 9, 11, 13].some(
        (index) => argv[index] === undefined || argv[index] === "",
      )
    ) {
      throw new Error("Protected consumer evidence arguments are required.");
    }
    return {
      testFiles: argv.slice(15),
      authority: "task",
      manifestPath: argv[1],
      evidencePath: argv[3],
      candidatePath: argv[5],
      authorityPath: argv[7],
      evidenceOs: argv[9],
      evidenceNode: argv[11],
      evidenceSource: argv[13],
      required: RELEASE_REQUIRED_TESTS,
    };
  }
  if (
    argv.length < 6 ||
    argv[0] !== "--manifest" ||
    argv[2] !== "--require" ||
    argv[4] !== "--"
  ) {
    throw new Error(
      "Usage: node scripts/run-vitest-and-audit.mjs [--manifest <path> --require <ledger,...> -- <test-files...>]",
    );
  }
  const manifestPath = argv[1];
  const ledgerText = argv[3];
  if (
    manifestPath === undefined ||
    manifestPath === "" ||
    ledgerText === undefined ||
    ledgerText === ""
  ) {
    throw new Error(
      "Manifest and release-evidence ledger values are required.",
    );
  }
  const required = requiredTestsForLedgers(ledgerText.split(","));
  return {
    testFiles: argv.slice(5),
    authority: "task",
    manifestPath,
    required,
  };
}

export function defaultAuditAuthority(environment = process.env) {
  return environment.THERMITE_SCHEMATICS_RELEASE_AUTHORITY === "local-task6" ||
    environment.THERMITE_SCHEMATICS_RELEASE_AUTHORITY === "protected-consumer"
    ? "task"
    : "ordinary";
}

async function main(argv) {
  const options = parseArguments(argv);
  if (argv.length === 0) options.authority = defaultAuditAuthority();
  await runVitestAndAudit(options);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
