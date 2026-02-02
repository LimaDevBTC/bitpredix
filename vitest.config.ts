import path from "node:path";
import { defineConfig } from "vitest/config";

const vitestSetupFilePath = path.join(process.cwd(), "node_modules/@stacks/clarinet-sdk/vitest-helpers/src/vitest.setup.ts");

export default defineConfig({
  test: {
    environment: "clarinet",
    pool: "forks",
    isolate: false,
    maxWorkers: 1,
    setupFiles: [vitestSetupFilePath],
    environmentOptions: {
      clarinet: {
        manifestPath: "./Clarinet.toml",
        initBeforeEach: true,
      },
    },
  },
});
