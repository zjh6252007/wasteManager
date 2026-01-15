import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./", // 使用相对路径，支持 file:// 协议
  plugins: [
    react(),
    {
      name: 'copy-sigwebtablet',
      writeBundle() {
        const srcFile = join(__dirname, 'src/renderer/SigWebTablet.js');
        const destFile = join(__dirname, '.vite/renderer/SigWebTablet.js');
        if (existsSync(srcFile)) {
          copyFileSync(srcFile, destFile);
          console.log('✓ Copied SigWebTablet.js to build directory');
        }
      }
    }
  ],
  root: "src/renderer",
  server: {
    port: 5173,
    strictPort: true,
    host: true, // 允许外部访问
  },
  build: {
    outDir: "../../.vite/renderer",
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      output: {
        // 确保资源文件使用相对路径
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  optimizeDeps: {
    // 排除 PowerSync Worker 文件，避免 Vite 优化依赖时出错
    // 注意：exclude 只接受字符串数组，不能使用正则表达式
    exclude: [
      '@powersync/web',
      '@powersync/common'
    ]
  },
  worker: {
    format: 'es',
    plugins: () => [],
    rollupOptions: {
      output: {
        format: 'es'
      }
    }
  },
});
