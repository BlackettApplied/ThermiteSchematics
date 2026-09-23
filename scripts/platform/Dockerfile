FROM oven/bun:1.4.2
# Use bun run check:linux: its filtered snapshot is the required build context.
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
RUN chown bun:bun /work
COPY --chown=bun:bun . /work
USER bun
RUN git config --global --add safe.directory /work && bun install --frozen-lockfile --ignore-scripts --backend=copyfile
ENV VITEST_MAX_WORKERS=2
CMD ["bun", "run", "check"]
