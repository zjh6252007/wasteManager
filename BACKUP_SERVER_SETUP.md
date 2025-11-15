# 备份服务器设置指南

## 概述

本应用的自动备份功能可以将数据上传到任何支持 HTTP/HTTPS 的服务器。推荐使用：

- **Azure Functions + Blob Storage**（推荐，见 [AZURE_BACKUP_SETUP.md](./AZURE_BACKUP_SETUP.md)）
- **自建 Node.js 服务器**（见下文）

> 💡 **快速开始**: 如果你使用 Azure，请查看 [AZURE_QUICK_START.md](./AZURE_QUICK_START.md) 获取 5 分钟快速设置指南。

## 方案一：Azure Functions + Blob Storage（推荐）

### 优点
- 无需管理服务器
- 按使用量计费，成本低（通常每月 < $5）
- 自动扩展
- 高可用性
- 与 Azure 生态系统集成良好

### 架构
```
应用 → Azure Functions → Azure Blob Storage
```

### 快速设置

1. **创建 Azure 存储账户和容器**
   - 在 Azure Portal 创建存储账户
   - 创建容器命名为 `backups`

2. **创建 Azure Function App**
   - 创建 Function App（Node.js 20 LTS 或 22 LTS）
   - 创建 HTTP Trigger 函数

3. **部署代码**
   - 使用 `azure-function-backup-handler.js` 中的代码
   - 配置环境变量（存储账户名称和密钥）

4. **在应用中配置**
   - 备份服务器 URL：`https://your-function-app.azurewebsites.net/api/backup`

详细步骤请参考 [AZURE_QUICK_START.md](./AZURE_QUICK_START.md)

## 方案二：Azure App Service（自建服务器）

如果你需要更多控制，可以使用 Azure App Service 部署自己的服务器。

### 优点
- 完全控制
- 可以添加自定义逻辑
- 易于调试

### 设置步骤

1. 创建 App Service
2. 部署 `azure-app-service-backup.js` 代码
3. 配置应用设置（存储账户信息）
4. 在应用中配置 URL

详细步骤请参考 [AZURE_BACKUP_SETUP.md](./AZURE_BACKUP_SETUP.md)

## 方案三：自建 Node.js 服务器

### 服务器代码示例

使用提供的 `simple-backup-server.js`：

```bash
# 安装依赖
npm install express multer cors

# 运行服务器
node simple-backup-server.js
```

### 功能
- 接收备份数据
- 保存到本地文件系统
- 提供备份列表查询
- 健康检查端点

### 部署选项
- 使用 PM2 在服务器上运行
- 使用 Docker 容器化
- 部署到 Azure App Service、Heroku、DigitalOcean 等

## 推荐配置

### 对于大多数用户：Azure Functions + Blob Storage
- ✅ 成本低（按使用付费）
- ✅ 无需管理服务器
- ✅ 自动扩展
- ✅ 安全可靠

### 对于需要更多控制：自建服务器
- ✅ 完全控制
- ✅ 可以添加自定义逻辑
- ✅ 可以集成其他服务

## 安全建议

1. **使用 HTTPS**：确保所有通信都加密
2. **添加认证**：在 Function App 或服务器端添加 API 密钥验证
3. **限制访问**：使用 Azure Managed Identity 或访问策略限制访问
4. **加密存储**：在 Blob Storage 中启用服务器端加密（默认启用）
5. **定期清理**：设置生命周期管理策略自动删除旧备份

## 成本估算（Azure）

### Azure Functions（Consumption 计划）
- **执行时间**：前 400,000 GB-秒/月免费，之后 $0.000016/GB-秒
- **请求**：前 100 万次/月免费，之后 $0.20/百万次

### Azure Blob Storage
- **存储**：Hot 层 $0.0184/GB/月
- **事务**：前 10,000 次/月免费，之后 $0.004/10,000 次
- **数据传输**：前 5GB/月免费

### 总成本
对于小型应用，每月通常 < $5

## 下一步

1. **选择方案**（推荐 Azure Functions）
2. **设置服务器/服务**（参考 Azure 快速开始指南）
3. **在应用设置中配置备份服务器 URL**
4. **测试备份功能**

## 相关文档

- [AZURE_QUICK_START.md](./AZURE_QUICK_START.md) - Azure 5 分钟快速设置
- [AZURE_BACKUP_SETUP.md](./AZURE_BACKUP_SETUP.md) - Azure 详细设置文档
- `azure-function-backup-handler.js` - Azure Functions 代码
- `azure-app-service-backup.js` - Azure App Service 代码
- `simple-backup-server.js` - 自建服务器代码
