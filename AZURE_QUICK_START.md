# Azure 备份快速开始指南

## 方案一：Azure Functions + Blob Storage（5分钟设置）

### 步骤 1: 创建存储账户

1. 登录 [Azure Portal](https://portal.azure.com)
2. 点击 "创建资源" → 搜索 "存储账户"
3. 填写信息：
   - **名称**: `yourbackupstorage`（全局唯一）
   - **性能**: Standard
   - **冗余**: LRS（本地冗余存储）
   - **位置**: 选择离你最近的区域
4. 点击 "创建"

### 步骤 2: 创建容器

1. 打开刚创建的存储账户
2. 点击左侧 "容器"
3. 点击 "+ 容器"
4. 名称: `backups`
5. 公共访问级别: **专用（无匿名访问）**
6. 点击 "创建"

### 步骤 3: 创建 Function App

1. 在 Azure Portal 点击 "创建资源"
2. 搜索 "Function App"
3. 填写信息：
   - **应用名称**: `your-backup-function`（全局唯一）
   - **运行时堆栈**: Node.js
   - **版本**: 20 LTS（或 22 LTS，24 LTS 是预览版）
   - **区域**: 与存储账户相同
   - **操作系统**: Linux（推荐）或 Windows
   - **托管计划**: 消耗（无服务器）
4. 点击 "存储" 标签：
   - 选择刚创建的存储账户
5. 点击 "创建"

### 步骤 4: 配置环境变量

1. 打开 Function App
2. 点击左侧 "配置"
3. 点击 "+ 新建应用程序设置"
4. 添加以下设置：
   - **名称**: `STORAGE_ACCOUNT_NAME`，**值**: 你的存储账户名称
   - **名称**: `STORAGE_ACCOUNT_KEY`，**值**: 存储账户的访问密钥（在存储账户的"访问密钥"中获取）
   - **名称**: `CONTAINER_NAME`，**值**: `backups`
5. 点击 "保存"

### 步骤 5: 创建 HTTP 函数

1. 在 Function App 中，点击左侧 "函数"
2. 点击 "+ 创建"
3. 选择 "HTTP trigger"
4. 填写信息：
   - **新函数**: `backup`
   - **授权级别**: Function（或 Anonymous，如果不需要认证）
5. 点击 "创建"

### 步骤 6: 部署代码

1. 打开刚创建的函数
2. 点击 "代码 + 测试"
3. 将 `azure-function-backup-handler.js` 的内容粘贴到 `index.js`
4. 点击 "保存"

### 步骤 7: 安装依赖

1. 在函数编辑器中，点击 "控制台" 标签
2. 运行：
   ```bash
   npm init -y
   npm install @azure/storage-blob
   ```

### 步骤 8: 配置 CORS

1. 在 Function App 中，点击左侧 "CORS"
2. 添加允许的来源：
   - `*`（开发环境）或你的应用域名（生产环境）
3. 点击 "保存"

### 步骤 9: 获取函数 URL

1. 打开函数
2. 点击 "获取函数 URL"
3. 复制 URL，格式类似：`https://your-backup-function.azurewebsites.net/api/backup`

### 步骤 10: 在应用中配置

1. 打开应用设置
2. 启用 "Enable Auto Backup"
3. 输入备份服务器 URL：`https://your-backup-function.azurewebsites.net/api/backup`
4. 设置备份间隔
5. 点击 "Backup Now" 测试

## 方案二：Azure App Service（10分钟设置）

### 步骤 1-2: 同方案一（创建存储账户和容器）

### 步骤 3: 创建 App Service

1. 在 Azure Portal 点击 "创建资源"
2. 搜索 "Web 应用"
3. 填写信息：
   - **名称**: `your-backup-server`
   - **运行时堆栈**: Node.js 20 LTS（或 22 LTS）
   - **操作系统**: Linux
   - **区域**: 与存储账户相同
4. 点击 "创建"

### 步骤 4: 配置环境变量

1. 打开 App Service
2. 点击左侧 "配置"
3. 添加应用程序设置（同 Function App）
4. 点击 "保存"

### 步骤 5: 部署代码

**选项 A: 使用 VS Code**
1. 安装 "Azure App Service" 扩展
2. 右键项目文件夹 → "部署到 Web 应用"
3. 选择刚创建的 App Service

**选项 B: 使用 Git**
1. 在 App Service 中启用部署中心
2. 连接 GitHub/Azure DevOps
3. 推送代码

**选项 C: 使用 FTP**
1. 在 App Service 中获取 FTP 凭据
2. 上传 `azure-app-service-backup.js` 和 `package.json`

### 步骤 6: 在应用中配置

URL: `https://your-backup-server.azurewebsites.net`

## 成本对比

| 服务 | 免费额度 | 超出后价格 |
|------|---------|-----------|
| Azure Functions | 100万次请求/月 | $0.20/百万次 |
| Blob Storage | 5GB/月 | $0.0184/GB/月 |
| App Service | 无（需付费计划） | 从 $13/月起 |

**推荐**: Azure Functions（按使用付费，成本最低）

## 故障排除

### 问题：函数返回 500 错误
- 检查环境变量是否正确配置
- 查看函数日志（在 Function App 的 "日志流" 中）

### 问题：CORS 错误
- 确保在 Function App 的 CORS 设置中添加了允许的来源

### 问题：存储账户连接失败
- 检查存储账户密钥是否正确
- 确认存储账户和 Function App 在同一区域

## 下一步

1. 测试备份功能
2. 设置备份保留策略（在 Blob Storage 中配置生命周期管理）
3. 监控备份状态（使用 Azure Monitor）

