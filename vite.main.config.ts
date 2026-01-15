import { defineConfig } from "vite";
import { builtinModules } from "node:module";

// 原生模块列表
const nativeModules = ['better-sqlite3', 'usb', 'serialport'];

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
      external: (id, parentId, isResolved) => {
        // 外部化所有 Node.js 内置模块（包括 node: 前缀的）
        const nodeModule = id.replace('node:', '');
        if (builtinModules.includes(id) || builtinModules.includes(nodeModule)) {
          return true;
        }
        // 外部化 electron
        if (id === "electron") {
          return true;
        }
        // 外部化原生模块 - 检查完整路径和模块名
        for (const module of nativeModules) {
          if (id === module || 
              id.startsWith(module + '/') || 
              id.startsWith(module + '\\') ||
              id.includes(`node_modules/${module}/`) ||
              id.includes(`node_modules\\${module}\\`)) {
            return true;
          }
        }
        // 外部化其他模块
        if (id === "bcryptjs") {
          return true;
        }
        // 外部化 ws 的可选依赖（bufferutil, utf-8-validate）
        // 这些是可选依赖，如果不存在也不会影响 ws 的功能
        if (id === "bufferutil" || id === "utf-8-validate") {
          return true;
        }
        // 外部化 ws 模块本身
        if (id === "ws") {
          return true;
        }
        return false;
      },
      output: {
        // 确保资源文件被复制
        assetFileNames: 'assets/[name][extname]'
      }, 
    },
    commonjsOptions: {
      // 完全排除原生模块，不进行任何转换
      exclude: [
        /node_modules[\/\\]better-sqlite3/,
        /node_modules[\/\\]usb/,
        /node_modules[\/\\]serialport/
      ],
      // 忽略所有动态 require
      ignoreDynamicRequires: true,
      // 转换混合 ES 模块
      transformMixedEsModules: true
    }
  },
  resolve: {
    // 确保这些模块不会被解析和打包
    dedupe: nativeModules
    // 注意：bufferutil 和 utf-8-validate 已经在 external 中处理，不需要 alias
  },
  optimizeDeps: {
    // 排除原生模块，不进行依赖预构建
    exclude: [...nativeModules, 'ws', 'bufferutil', 'utf-8-validate']
  }
});
