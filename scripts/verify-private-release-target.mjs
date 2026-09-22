import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REPOSITORY = "BlackettApplied/ThermiteSchematics";

function assertRepository(repository, { requirePush = false } = {}) {
  if (
    repository.full_name !== REPOSITORY ||
    repository.private !== true ||
    repository.visibility !== "private" ||
    repository.fork !== false
  ) {
    throw new Error(
      "AUTH001 Release target must be the exact private non-fork repository.",
    );
  }
  if (requirePush && repository.permissions?.push !== true) {
    throw new Error(
      "AUTH002 Publisher principal lacks repository push permission.",
    );
  }
}

export async function verifyPrivateReleaseTarget({
  mode,
  environment = process.env,
  request = fetch,
} = {}) {
  if (mode !== "candidate" && mode !== "publisher")
    throw new Error("AUTH000 Invalid release-target mode.");
  if (environment.GITHUB_REPOSITORY !== REPOSITORY)
    throw new Error("AUTH001 Repository context mismatch.");
  const token = environment.GITHUB_TOKEN;
  if (typeof token !== "string" || token === "")
    throw new Error("AUTH003 GITHUB_TOKEN is required.");
  const get = async (path) => {
    const response = await request(
      `https://api.github.com/repos/${REPOSITORY}${path}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!response.ok)
      throw new Error(
        `AUTH004 GitHub API request failed with ${response.status}.`,
      );
    return response.json();
  };
  const repository = await get("");
  assertRepository(repository, { requirePush: mode === "publisher" });
  if (mode === "publisher") return { repository: REPOSITORY, push: true };

  const sha = environment.GITHUB_SHA;
  if (
    environment.GITHUB_EVENT_NAME !== "push" ||
    environment.GITHUB_REF !== "refs/heads/dev" ||
    !/^[0-9a-f]{40}$/u.test(sha ?? "")
  ) {
    throw new Error("AUTH005 Candidate context is not the protected dev push.");
  }
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (typeof eventPath !== "string" || eventPath === "")
    throw new Error("AUTH006 Push event payload is required.");
  const event = JSON.parse(await readFile(eventPath, "utf8"));
  if (event.after !== sha)
    throw new Error("AUTH006 github.sha differs from github.event.after.");
  const branch = await get("/branches/dev");
  if (branch.name !== "dev" || branch.protected !== true)
    throw new Error("AUTH007 dev is not protected.");
  const pulls = await get(`/commits/${sha}/pulls`);
  if (
    !Array.isArray(pulls) ||
    !pulls.some(
      (pull) =>
        typeof pull.merged_at === "string" &&
        pull.base?.ref === "dev" &&
        pull.merge_commit_sha === sha,
    )
  ) {
    throw new Error(
      "AUTH008 Candidate commit is not the resulting merge of a PR based on dev.",
    );
  }
  return {
    repository: REPOSITORY,
    sourceCommit: sha,
    branch: "dev",
    protected: true,
  };
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== "--mode") {
    throw new Error(
      "Usage: node scripts/verify-private-release-target.mjs --mode <candidate|publisher>",
    );
  }
  await verifyPrivateReleaseTarget({ mode: argv[1] });
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
