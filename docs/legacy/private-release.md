# Private v0.2.0 Release Checklist

This is the frozen distribution and publication contract for the Task 6 packager and
acceptance harness, the Task 9 protected candidate workflow and release gate, and the
protected publisher. The three packaged READMEs are final before the Task 6 packager
records their bytes. This checklist documents the implemented machinery; it does not
make a local build, current checkout, or documentation-only change release authority.

This checklist applies only to the historical private v0.2.0 artifact and its
protected publisher. It does not describe the current Apache-2.0 source alpha;
see the [runtime packaging guide](../runtime-package.md). Public npm publication
and direct GitHub Release asset uploads remain outside this legacy pipeline.

## End-user prerequisite and install

Users require Node.js `^22.12.0 || >=24`: Node 22.12 or a supported later
release, excluding Node 23.

The private Release exposes exactly these two user assets:

```text
thermite-cli-0.2.0.tgz
thermite-cli-0.2.0.tgz.sha256
```

The operator provides both through an authorized private channel. Before install,
verify that the SHA file is exactly
`<64 lowercase hex><two spaces>thermite-cli-0.2.0.tgz\n`, clear inherited npm
configuration and proxy/preload inputs, and create an isolated prefix, empty cache,
empty user npmrc, and empty global npmrc. With absolute paths substituted:

```sh
npm install --global --prefix <isolated-prefix> --offline --ignore-scripts --no-audit --no-fund --package-lock=false --install-links=false --omit=dev --workspaces=false --userconfig <empty-user-npmrc> --globalconfig <empty-global-npmrc> --cache <empty-cache> <absolute-downloaded-thermite-cli-0.2.0.tgz>
```

Invoke only the `thermite` shim in that isolated prefix after its platform-specific
type, target, and direct-entry parity checks pass. Any public-registry fetch,
lifecycle execution, missing bundled dependency, or unexpected authored payload link
fails acceptance.

## Candidate build authority

Release authority begins only in exact private repository
`BlackettApplied/ThermiteSchematics` when all of these facts hold:

- repository visibility is `private`, `private: true`, and `fork: false`;
- the event is a push to protected `refs/heads/dev`;
- the source is the exact post-merge commit of a PR whose base is `dev`;
- the pinned producer is `ubuntu-24.04`, Node `24.11.1`, npm `11.6.2`, and
  TypeScript `5.9.3`;
- the release build starts from the frozen `env -i` environment and fresh
  release-only source/build/stage roots; and
- independent A/B emissions, stages, tar bytes, inventories, closure, licenses, and
  deterministic metadata are identical and link-free.

The producer emits exactly seven candidate files:

```text
thermite-cli-0.2.0.tgz
thermite-cli-0.2.0.tgz.sha256
thermite-cli-0.2.0.tar-headers.json
thermite-cli-0.2.0.stage-files.json
thermite-cli-0.2.0.runtime-closure.json
thermite-cli-0.2.0.third-party-licenses.json
thermite-cli-0.2.0.build-provenance.json
```

The read-only candidate workflow uploads those exact files as one immutable Actions
artifact, verifies the upload digest against the REST artifact digest and numeric ID,
and only then writes producer evidence. A local `release-out` directory, local
tar/SHA pair, pull-request head, dispatch ref, public/internal/fork repository, or
operator-supplied commit has no release authority.

## Matrix and gate receipt

The same immutable candidate is hard-hashed before extraction and installed/tested on
Ubuntu 24.04 and Windows 2022 with Node 22.12.0 and 24.11.1. All four legs must pass
the installed empty-folder tier without a product skip and produce canonical,
path-leak-scanned test/evidence pairs bound to one repository, source commit, workflow
run/attempt, candidate artifact ID/name/digest, and tar SHA.

Only after the producer and all four legs succeed may `release_gate` create:

1. one immutable gate payload containing the seven candidate files plus aggregate
   evidence; and
2. one receipt created after payload upload, containing its numeric artifact ID,
   name, digest, and aggregate-evidence hash.

The successful candidate workflow run, payload artifact, and receipt are the only
publication-byte authority. A producer artifact without the successful receipt and a
self-consistent locally authored evidence set are rejected.

## Sole publisher and input

Task 9's sole GitHub Release uploader is named
`scripts/release-publish.mjs`. It runs only in the protected
`m8-private-release` environment with `actions: read` and `contents: write`.
Its sole operator input is the successful M8 Release Candidate `run_id`, passed as
`--gate-run-id <validated-unsigned-decimal>`.

The publisher accepts no tar path, SHA value, commit, tag, candidate artifact selector,
or environment fallback. It derives the exact receipt name from the selected
successful run, retrieves the payload by the receipt's numeric artifact ID, normalizes
and verifies Actions/REST digests, hard-verifies the archive before extraction, and
revalidates every aggregate, product, workflow, repository, and source-commit field.

No person or workflow may substitute a direct GitHub CLI upload, a browser upload,
public npm publication, another script, or local files.

## Authorized Release target

Before any Release mutation, the publisher must prove:

- exact repository `BlackettApplied/ThermiteSchematics`, private and non-fork;
- publisher principal `permissions.push: true`;
- exact tag `v0.2.0`, with annotated tags peeled, resolves to the gate source
  commit;
- one pre-created Release with that tag, fixed numeric release ID,
  `prerelease: false`, and either `draft: true` or the exact verified
  already-published retry state below; and
- the complete observed asset-name set satisfies the state-specific closed-set rule.

No other repository, release, tag, commit, or asset list is considered.

## Closed asset set and labels

The only allowed Release asset names are:

```text
thermite-cli-0.2.0.tgz
thermite-cli-0.2.0.tgz.sha256
```

For each expected tuple `(name, size, contentSha256)`, the exact label is
`m8-gate-run=<runId>;payload-artifact=<artifactId>;sha256=<contentSha256>`.

On every complete asset-list response:

- reject duplicate names first;
- while the target is a draft, require the observed name set to be a subset of the
  two allowed names; and
- before publication or reuse of a published Release, require the observed name set
  to equal the two allowed names exactly.

An extra or duplicate asset fails before upload, deletion, replacement, PATCH, or a
successful no-op. Unrelated assets are never deleted to manufacture compliance.

## Draft attachment state machine

Within a valid draft subset, process the tar then SHA tuple:

1. An expected name in `state: "uploaded"` is reusable only after its repository,
   release ID, numeric asset ID, exact name, label, size, prefixed REST digest, and
   freshly streamed download hash all match the gate tuple. The SHA asset's downloaded
   text must also name and hash the tar exactly.
2. A mismatched uploaded asset or any unexpected state fails with zero mutation. The
   publisher never deletes or replaces an uploaded asset.
3. One expected-name `state: "starter"` is recoverable only while the Release is
   still the same draft. Before deletion, re-fetch the fixed Release and complete
   asset list, re-prove repository/release/tag/commit/draft/non-prerelease identity and
   the valid allowed-name subset, then GET the positive asset ID and prove its
   canonical URL, ID, name, and starter state.
4. That identity-verified expected-name starter is the sole deletion transition.
   Require DELETE `204`, re-fetch the Release and full asset list, prove the same
   draft and that ID/name absent, then re-run the subset validator.
5. Each expected tuple permits at most one verified starter deletion/re-upload in one
   invocation. A repeated starter fails for a later invocation.
6. Upload only a missing expected tuple, in tar-then-SHA order. After every upload
   response, including an indeterminate result, re-fetch the fixed Release and
   complete asset list, re-run the draft-subset validator, then freshly verify the
   expected tuple. A newly observed extra asset is a hard failure.

Draft starts with zero, one, or two valid uploaded expected assets are resumable.
Valid existing assets are retained; only missing peers are uploaded.

## Explicit publication

Publication is never implicit in attachment. Only after a fresh complete-list
re-fetch proves the name set is exactly the two expected names and fresh API
GET/download verification proves both exact tuples may the publisher PATCH the fixed
release with the sole body `{"draft":false}`.

After PATCH, re-fetch the Release by numeric ID and the complete asset list. Success
requires the same repository/release/tag/peeled commit, `draft: false`,
`prerelease: false`, non-null `published_at`, exactly the two names, both exact
gate labels/sizes/digests/download hashes, and exact SHA-file content.

If PATCH has an indeterminate result, re-fetch first:

- an exact published two-asset state succeeds;
- an exact still-draft two-asset state permits one identical PATCH retry followed by
  one more complete re-fetch; and
- any extra asset, other state, or continued indeterminate state fails safely for a
  later invocation.

## Already-published retry

An already-published Release is accepted only as a verified zero-mutation retry.
Before success, re-prove every target field above, `draft: false`,
`prerelease: false`, non-null `published_at`, exact two-name set, and both
gate-run/payload labels, sizes, REST digests, download hashes, and SHA content.

A missing, extra, duplicate, starter, or mismatched asset on a published Release fails
with zero upload, delete, replacement, or PATCH calls. No published asset is ever
deleted.

## Final operator check

Before authorizing the protected publisher, confirm:

- the ordinary repository check passed without altering its CI workflow;
- the protected source, candidate, four acceptance legs, aggregate payload, and
  receipt all identify the same commit, run, artifact, and tar SHA;
- archive hashing preceded every extraction and install;
- every published evidence file passed the exact leakage scan;
- the user tar/SHA are the only Release assets;
- the initialized project and installed product payload are ordinary and link-free,
  with only the separately verified npm prefix shims exempt;
- the draft closed-set and both fresh asset verifications passed immediately before
  explicit PATCH; and
- the post-PATCH full re-fetch or exact already-published retry check passed.

The original detailed design was Milestone 8 plan v23 (CONVERGED, Amendments
C1–C4), an internal historical document not included in this source release.
This checklist does not weaken the private publisher's implemented authority,
evidence, isolation, packaging, or retry requirements.
