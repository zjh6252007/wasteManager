# 应用更新推送指南

本应用支持自动更新检测，用户可以在设置中检查新版本。以下是推送新版本的完整流程。

## 方法一：使用 GitHub Releases（推荐）

### 1. 配置 GitHub 仓库信息

编辑 `src/main/update/updateService.ts`，修改以下行：

```typescript
const repoOwner = 'your-username'; // 替换为你的GitHub用户名或组织名
const repoName = 'garbage-recycle-scale'; // 替换为你的仓库名
```

例如：
```typescript
const repoOwner = 'mycompany';
const repoName = 'garbage-recycle-scale';
```

### 2. 更新版本号

在发布新版本前，更新 `package.json` 中的版本号：

```json
{
  "version": "1.0.1"  // 使用语义化版本号：主版本号.次版本号.修订号
}
```

**版本号规则：**
- `1.0.0` → `1.0.1`：小修复（bug修复）
- `1.0.0` → `1.1.0`：新功能
- `1.0.0` → `2.0.0`：重大更新（可能不兼容）

### 3. 打包应用

运行以下命令生成安装包：

```bash
npm run make
```

这会在 `out/make/` 目录下生成安装包（Windows 下通常是 `.exe` 或 `.msi` 文件）。

### 4. 创建 GitHub Release

1. 登录 GitHub，进入你的仓库
2. 点击 **Releases** → **Create a new release**
3. 填写信息：
   - **Tag version**: `v1.0.1`（必须与 `package.json` 中的版本号对应，前面加 `v`）
   - **Release title**: `Version 1.0.1` 或更描述性的标题
   - **Description**: 填写更新说明，例如：
     ```
     ## 新功能
     - 添加了表格视图显示金属类型
     - 优化了更新检测功能
     
     ## 修复
     - 修复了公司名称显示问题
     ```
4. **上传安装包**：
   - 点击 "Attach binaries"，上传 `out/make/` 目录下的安装包文件
   - 建议上传 `.exe` 和 `.msi` 两种格式（如果有）
5. 点击 **Publish release**

### 5. 用户如何获取更新

- **自动检查**：如果用户在设置中启用了"Automatically check for updates"，应用会定期检查
- **手动检查**：用户在设置中点击"Check for Updates Now"按钮
- 当检测到新版本时，会弹出提示，用户可以选择下载

---

## 方法二：使用自定义更新服务器

如果你不想使用 GitHub，可以搭建自己的更新服务器。

### 1. 创建更新服务器 API

你的服务器需要提供一个 API 端点，返回 JSON 格式的更新信息：

**请求示例：**
```
GET https://your-server.com/api/check-update
```

**响应格式：**
```json
{
  "version": "1.0.1",
  "releaseNotes": "新功能：添加了表格视图\n修复：修复了公司名称显示问题",
  "downloadUrl": "https://your-server.com/downloads/app-v1.0.1.exe"
}
```

### 2. 配置更新服务器 URL

在 `src/main/index.ts` 中修改：

```typescript
const updateService = new UpdateService('https://your-server.com/api/check-update');
```

### 3. 发布流程

1. 更新 `package.json` 中的版本号
2. 打包应用：`npm run make`
3. 将安装包上传到你的服务器
4. 更新服务器 API，返回新的版本信息
5. 用户应用会自动检测到更新

---

## 版本号管理最佳实践

应用使用语义化版本号（Semantic Versioning）：

- **主版本号（Major）**：不兼容的 API 修改
- **次版本号（Minor）**：向下兼容的功能性新增
- **修订号（Patch）**：向下兼容的问题修正

**示例：**
- `0.1.0` → `0.1.1`：修复 bug
- `0.1.0` → `0.2.0`：添加新功能
- `0.1.0` → `1.0.0`：正式发布或重大更新

---

## 测试更新功能

在发布前，建议测试更新流程：

1. **本地测试**：
   - 将当前版本号改为较低版本（如 `0.0.1`）
   - 运行应用，检查是否能检测到新版本

2. **测试服务器**：
   - 使用测试 GitHub 仓库或测试服务器
   - 创建测试 Release，验证更新检测是否正常

---

## 常见问题

### Q: 用户没有收到更新提示？
A: 检查以下几点：
- 版本号是否正确（GitHub Release 的 tag 必须是 `v` + 版本号）
- 安装包是否已上传到 Release
- 网络连接是否正常
- 用户是否启用了自动更新检查

### Q: 如何强制用户更新？
A: 当前实现是可选更新。如果需要强制更新，可以：
- 在服务器端标记某些版本为"必需更新"
- 在应用启动时检查，如果版本过旧则阻止使用

### Q: 可以支持自动安装吗？
A: 当前实现是打开浏览器下载。要实现自动安装，需要：
- 使用 `electron-updater` 库（如 `electron-builder`）
- 或实现自定义下载和安装逻辑

---

## 推荐工作流程

1. **开发新版本** → 更新代码
2. **更新版本号** → 修改 `package.json`
3. **打包应用** → `npm run make`
4. **创建 Release** → 在 GitHub 创建 Release 并上传安装包
5. **通知用户** → 用户应用会自动检测或手动检查更新

---

## 注意事项

- ⚠️ 确保版本号格式正确（如 `1.0.1`，GitHub tag 为 `v1.0.1`）
- ⚠️ 确保安装包文件已正确上传
- ⚠️ 建议在 Release 中详细说明更新内容
- ⚠️ 重大更新前建议先通知用户

