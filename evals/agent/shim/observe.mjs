// Run inside the real CLI, on its original inherited output descriptors. A
// downstream EPIPE reaches the CLI itself, without an intermediate output pipe.
import { writeFileSync } from "node:fs";
import { secretValues, redactSecrets } from "./eval-auth.mjs";
const out = [],
  err = [];
for (const [stream, buffers] of [
  [process.stdout, out],
  [process.stderr, err],
]) {
  const original = stream.write;
  stream.write = function (chunk, encoding, ...rest) {
    try {
      buffers.push(
        Buffer.isBuffer(chunk)
          ? Buffer.from(chunk)
          : Buffer.from(
              chunk,
              typeof encoding === "string" ? encoding : undefined,
            ),
      );
    } catch {}
    return Reflect.apply(original, this, [chunk, encoding, ...rest]);
  };
}
process.on("exit", () => {
  try {
    const values = secretValues(process.env),
      stdout = Buffer.concat(out),
      stderr = Buffer.concat(err);
    const sanitize = (bytes) =>
      values.some((v) => bytes.includes(Buffer.from(v)))
        ? Buffer.from(redactSecrets(bytes.toString("utf8"), values))
        : bytes;
    writeFileSync(process.env.THERMITE_EVAL_CAPTURE + ".out", sanitize(stdout));
    writeFileSync(process.env.THERMITE_EVAL_CAPTURE + ".err", sanitize(stderr));
    writeFileSync(
      process.env.THERMITE_EVAL_CAPTURE + ".counts",
      JSON.stringify({ stdout: stdout.length, stderr: stderr.length }),
    );
  } catch {
    /* Parent marks missing observation; CLI streams remain untouched. */
  }
});
