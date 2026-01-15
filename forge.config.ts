import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
  packagerConfig: {
    name: "Waste Recycling Scale System",
    executableName: "waste-recycling-scale",
    icon: undefined, // 可以添加图标路径，例如: "./assets/icon"
    asar: true,
    // 将原生模块从 ASAR 中解包，它们需要放在外部
    asarUnpack: [
      "**/node_modules/better-sqlite3/**/*",
      "**/node_modules/usb/**/*",
      "**/node_modules/serialport/**/*",
    ],
    // 确保包含必要的文件，排除不需要的
    ignore: [
      /^\/node_modules\/\.cache/,
      /^\/src/,
      /^\/out/,
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/\.idea/,
      /^\/README\.md/,
      /^\/\.gitignore/,
      /^\/\.eslintrc/,
      /^\/tsconfig/,
      /^\/vite\.main\.config/,
      /^\/vite\.preload\.config/,
      /^\/vite\.renderer\.config/,
      /^\/forge\.config/,
      /^\/BUILD/,
      /^\/FIX/,
      /^\/GITHUB/,
      /^\/AZURE/,
      /^\/DEPLOY/,
      /^\/UPDATE/,
      /^\/deploy/,
      /^\/test-/,
    ],
  },
  rebuildConfig: {
    // 自动重建原生模块
    // 如果设置了 SKIP_REBUILD 环境变量，则跳过重建（用于多实例测试）
    force: process.env.SKIP_REBUILD !== 'true',
    onlyModules: ["better-sqlite3", "usb", "serialport"],
  },
  makers: [
    // Squirrel 安装程序 - Electron 官方推荐，简单可靠
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "waste-recycling-scale",
        authors: "Waste Recycling System",
        description: "Waste Recycling Scale System - Garbage Recycling Weighing System",
      },
    },
    // ZIP 打包（用于 macOS 和 Linux）
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin", "linux"],
      config: {},
    },
  ],
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
    // Auto-unpack native modules (better-sqlite3, usb, serialport)
    new AutoUnpackNativesPlugin({
      unpack: ["better-sqlite3", "usb", "serialport"],
    }),
  ],
};

export default config;
