# Azure 备份服务器设置指南

## 概述

本应用的自动备份功能完全支持 Azure。你可以使用：
- **Azure Blob Storage**（推荐，云存储服务）
- **Azure Functions**（无服务器计算）
- **Azure API Management**（可选，用于 API 网关）
- **Azure App Service**（用于自建服务器）

## 方案一：Azure Functions + Blob Storage（推荐）

### 优点
- 无需管理服务器
- 按使用量计费，成本低
- 自动扩展
- 高可用性
- 与 Azure 生态系统集成良好

### 架构
```
应用 → Azure Functions → Azure Blob Storage
```

### 设置步骤

#### 1. 创建 Azure Blob Storage 账户

```bash
# 使用 Azure CLI
az storage account create \
  --name yourbackupstorage \
  --resource-group your-resource-group \
  --location eastus \
  --sku Standard_LRS

# 创建容器
az storage container create \
  --name backups \
  --account-name yourbackupstorage \
  --public-access off
```

或在 Azure 门户：
1. 创建存储账户
2. 创建容器（Container）命名为 `backups`
3. 设置访问级别为 Private

#### 2. 创建 Azure Function App

```bash
# 创建 Function App
az functionapp create \
  --name your-backup-function \
  --resource-group your-resource-group \
  --storage-account yourbackupstorage \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4
```

或在 Azure 门户：
1. 创建 Function App
2. 选择 Node.js 运行时（20 LTS 或 22 LTS，24 LTS 是预览版）
3. 选择 Consumption 计划（按使用付费）

#### 3. 配置环境变量

在 Function App 的配置中添加：
- `STORAGE_ACCOUNT_NAME`: 你的存储账户名称
- `STORAGE_ACCOUNT_KEY`: 存储账户密钥（或使用 Managed Identity）
- `CONTAINER_NAME`: `backups`

#### 4. 部署函数代码

使用我提供的 `azure-function-backup-handler.js` 代码

#### 5. 配置 CORS

在 Function App 设置中启用 CORS，允许你的应用域名

#### 6. 在应用中配置

- 备份服务器 URL：`https://your-backup-function.azurewebsites.net/api/backup/upload`

## 方案二：Azure App Service（自建服务器）

### 优点
- 完全控制
- 可以添加自定义逻辑
- 易于调试

### 设置步骤

1. 创建 App Service
2. 部署 `simple-backup-server.js`（需要修改为支持 Azure）
3. 配置应用设置
4. 在应用中配置 URL

## 方案三：直接使用 Blob Storage（需要修改应用代码）

可以使用 Azure Storage SDK 直接上传，但需要处理认证，实现较复杂。

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

## 安全建议

1. **使用 Managed Identity**：避免在代码中存储密钥
2. **启用 HTTPS**：所有通信加密
3. **使用 SAS Token**：限制访问权限
4. **启用存储加密**：Blob Storage 默认加密
5. **设置访问策略**：限制 IP 范围（如果可能）

## 下一步

1. 选择方案（推荐 Azure Functions + Blob Storage）
2. 按照步骤设置 Azure 资源
3. 部署函数代码
4. 在应用设置中配置备份服务器 URL
5. 测试备份功能

