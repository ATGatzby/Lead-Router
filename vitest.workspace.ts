import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  // Engine + CLI + packages — no special alias needed
  {
    test: {
      include: [
        "apps/engine/src/**/*.test.ts",
        "apps/cli/src/**/*.test.ts",
        "packages/*/src/**/*.test.ts",
      ],
    },
  },
  // Web app — needs @ alias and jsdom
  "apps/web/vitest.config.ts",
]);
