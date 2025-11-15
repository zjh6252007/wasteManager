import { defineConfig } from "vite";
import { builtinModules } from "node:module";

export default defineConfig({
  build: {
    target: "node20",
    sourcemap: true,
    outDir: ".vite/build",
    lib: {
      entry: "src/main/index.ts",
      formats: ["cjs"],
      fileName: "index"
    },
    rollupOptions: {
      external: [
        "electron", 
        ...builtinModules,
        "better-sqlite3",
        "better-sqlite3/build/Release/better_sqlite3.node",
        "better-sqlite3/build/Debug/better_sqlite3.node",
        "bcryptjs",
        "usb",
        "serialport"
      ],
      output: {
        // 确保资源文件被复制
        assetFileNames: 'assets/[name][extname]'
      }, 
    },
  },
});
