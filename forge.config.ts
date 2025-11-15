import { VitePlugin } from "@electron-forge/plugin-vite";

export default {
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts" },
        { entry: "src/main/preload.ts", config: "vite.preload.config.ts" }
      ],
      renderer: [
        { name: "main_window", config: "vite.renderer.config.ts" }
      ],
    }),
  ],
};
