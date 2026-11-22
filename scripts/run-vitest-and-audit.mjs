// Ordinary CI guards for the surviving test accommodation predicates and reasons.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);

export const REPOSITORY_ROOT = resolve(dirname(scriptPath), "..");

function identifier(file, name) {
  return Object.freeze({ file, name });
}

function identifierKey(value) {
  return `${value.file}\u0000${value.name}`;
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
  if (skipCallCount !== 27) {
    throw new Error(
      `Expected exactly 27 source-frozen skip call sites; found ${skipCallCount}.`,
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

export function parseTrackedTestFiles(text) {
  const tracked = new Map();
  for (const record of text.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, objectId, stage] = record.slice(0, tab).split(" ");
    const file = record.slice(tab + 1);
    if (
      tab < 0 ||
      !/^[0-9a-f]{40}$/u.test(objectId) ||
      stage !== "0" ||
      (mode !== "100644" && mode !== "100755") ||
      file.includes("\\") ||
      tracked.has(file)
    ) {
      throw new Error(
        `Tracked test path is not an ordinary stage-zero POSIX file: ${file}.`,
      );
    }
    tracked.set(file, mode);
  }
  return tracked;
}

export async function trackedTestFiles(repositoryRoot = REPOSITORY_ROOT) {
  const tracked = parseTrackedTestFiles(
    execFileSync("git", ["ls-files", "--stage", "-z", "--", "*.test.ts"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
  for (const file of [
    "packages/compiler/test/package-metadata.test.ts",
    "packages/core-library/test/package-files.test.ts",
  ])
    if (!tracked.has(file))
      throw new Error(`Required tracked test file is absent: ${file}.`);
  return tracked;
}
