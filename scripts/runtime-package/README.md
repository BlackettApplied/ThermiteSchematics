# Thermite Schematics runtime package

Define electrical projects in JSON and generate deterministic drawings on demand.
This download contains the built engine, runtime dependencies, fonts, templates,
and core library. Install **Bun 1.4.2** separately. The verified target is
**Apple Silicon macOS**. No Git, dependency installation, or build is needed.

Keep this folder intact and separate from your electrical project. From this
folder, run:

```sh
bun thermite.mjs --version
bun thermite.mjs init ../electrical-project --name "My project"
bun thermite.mjs validate ../electrical-project
bun thermite.mjs view PS1 --loads --project ../electrical-project -o ../electrical-project/drawings/control-power.html
```

Use a new project directory; initialization refuses to overwrite an existing one.
Open the generated HTML in your browser, or use a `.pdf` output filename for PDF.
Read the generated project's `AGENTS.md` with your agent before editing its model.
From elsewhere, use `bun /absolute/path/to/this-folder/thermite.mjs <command>`.
Keep compiler diagnostics visible. Generated drawings require qualified
engineering review; validation does not certify electrical safety.

The `runtime-manifest.json` records the version, source commit, dependency
licenses, and every payload file's SHA-256. Verify the download against its
`.sha256` sidecar before extraction with `shasum -a 256 -c <archive>.sha256`.
Keep the ZIP and its sidecar together when running that command. A filename
containing `preview` identifies an uncommitted development build, not a release.

To upgrade, extract a newer release into a new runtime folder, then deliberately
switch the command path used for your project. Retain the previous runtime and
review validation and drawing changes. Your project's JSON and local libraries
remain in the project folder; no automatic update rewrites them.

Found a bug or missing feature? Have your agent prepare a focused fix using the
[source repository](https://github.com/BlackettApplied/ThermiteSchematics) and its
contribution guide. Develop in a separate source checkout; do not patch files in
this runtime folder. Keep private machine data out of issues and pull requests.
Human contributors review changes and accept any CLA themselves.

Thermite is Apache-2.0; see `LICENSE` and `NOTICE`. Third-party material retains
its own licenses; see `THIRD_PARTY_NOTICES.md`, the dependency inventory in
`runtime-manifest.json`, and the original license files under `node_modules`.
Bun itself is not included in this archive.
