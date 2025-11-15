import { defineConfig } from "vite";
import { builtinModules } from "node:module";

export default defineConfig({
  build: {
    target: "node20",
    sourcemap: true,
    lib: {
      entry: "src/main/preload.ts",
      formats: ["cjs"],
      fileName: "preload"
    },
    rollupOptions: {
      external: [
        "electron", 
        ...builtinModules,
        "better-sqlite3",
        "better-sqlite3/build/Release/better_sqlite3.node",
        "better-sqlite3/build/Debug/better_sqlite3.node",
        "bcryptjs"
      ],
    },
  },
});
