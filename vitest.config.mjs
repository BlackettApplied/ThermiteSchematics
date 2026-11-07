import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    include: [...configDefaults.include, "evals/**/*.test.mjs"],
    exclude: [...configDefaults.exclude, "evals/out/**", "projects/**"],
  },
});
