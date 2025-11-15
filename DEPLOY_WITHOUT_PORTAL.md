# 不使用 Portal 部署 Azure 备份服务器

## 方案一：Azure CLI 部署 Function App（如果必须用 Functions）

### 前置要求
1. 安装 [Azure CLI](https://aka.ms/installazurecliwindows)
2. 登录：`az login`
3. 设置订阅：`az account set --subscription "你的订阅ID"`

### 步骤 1: 创建资源组
```bash
az group create --name backup-rg --location eastus2
```

### 步骤 2: 创建存储账户
```bash
az storage account create \
  --name yourbackupstorage \
  --resource-group backup-rg \
  --location eastus2 \
  --sku Standard_LRS

# 创建容器
az storage container create \
  --name backups \
  --account-name yourbackupstorage \
  --public-access off
```

### 步骤 3: 创建 Function App
```bash
az functionapp create \
  --name your-backup-function \
  --resource-group backup-rg \
  --storage-account yourbackupstorage \
  --consumption-plan-location eastus2 \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4 \
  --os-type Linux
```

### 步骤 4: 配置环境变量
```bash
# 获取存储账户密钥
STORAGE_KEY=$(az storage account keys list \
  --account-name yourbackupstorage \
  --resource-group backup-rg \
  --query "[0].value" -o tsv)

# 设置环境变量
az functionapp config appsettings set \
  --name your-backup-function \
  --resource-group backup-rg \
  --settings \
    STORAGE_ACCOUNT_NAME=yourbackupstorage \
    STORAGE_ACCOUNT_KEY=$STORAGE_KEY \
    CONTAINER_NAME=backups
```

### 步骤 5: 部署函数代码
```bash
# 创建函数目录结构
mkdir -p backup-function/backup
cd backup-function

# 创建 function.json
cat > backup/function.json << 'EOF'
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post", "get"],
      "route": "backup"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ],
  "scriptFile": "index.js"
}
EOF

# 复制代码
cp ../azure-function-backup-handler.js backup/index.js

# 创建 package.json
cat > backup/package.json << 'EOF'
{
  "name": "backup-function",
  "version": "1.0.0",
  "dependencies": {
    "@azure/storage-blob": "^12.0.0"
  }
}
EOF

# 部署
az functionapp deployment source config-zip \
  --name your-backup-function \
  --resource-group backup-rg \
  --src backup.zip
```

### 步骤 6: 配置 CORS
```bash
az functionapp cors add \
  --name your-backup-function \
  --resource-group backup-rg \
  --allowed-origins "*"
```

### 获取函数 URL
```bash
az functionapp function show \
  --name your-backup-function \
  --resource-group backup-rg \
  --function-name backup \
  --query "invokeUrlTemplate" -o tsv
```

---

## 方案二：Azure CLI 部署 App Service（推荐，更简单）

### 前置要求
1. 安装 [Azure CLI](https://aka.ms/installazurecliwindows)
2. 登录：`az login`
3. 设置订阅：`az account set --subscription "你的订阅ID"`

### 步骤 1: 创建资源组
```bash
az group create --name backup-rg --location eastus2
```

### 步骤 2: 创建存储账户
```bash
az storage account create \
  --name yourbackupstorage \
  --resource-group backup-rg \
  --location eastus2 \
  --sku Standard_LRS

# 创建容器
az storage container create \
  --name backups \
  --account-name yourbackupstorage \
  --public-access off
```

### 步骤 3: 创建 App Service Plan
```bash
az appservice plan create \
  --name backup-plan \
  --resource-group backup-rg \
  --location centralus \
  --sku FREE \
  --is-linux
```

### 步骤 4: 创建 App Service
```bash
az webapp create \
  --name your-backup-server \
  --resource-group backup-rg \
  --plan backup-plan \
  --runtime "NODE:20-lts"
```

### 步骤 5: 配置环境变量
```bash
# 获取存储账户密钥
STORAGE_KEY=$(az storage account keys list \
  --account-name yourbackupstorage \
  --resource-group backup-rg \
  --query "[0].value" -o tsv)

# 设置环境变量
az webapp config appsettings set \
  --name your-backup-server \
  --resource-group backup-rg \
  --settings \
    STORAGE_ACCOUNT_NAME=yourbackupstorage \
    STORAGE_ACCOUNT_KEY=$STORAGE_KEY \
    CONTAINER_NAME=backups \
    PORT=8080
```

### 步骤 6: 准备部署文件
在项目根目录创建 `deploy-app-service` 文件夹：

```bash
mkdir deploy-app-service
cd deploy-app-service

# 复制服务器代码
cp ../azure-app-service-backup.js server.js

# 创建 package.json
cat > package.json << 'EOF'
{
  "name": "backup-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "multer": "^1.4.5",
    "cors": "^2.8.5",
    "@azure/storage-blob": "^12.0.0"
  }
}
EOF

# 安装依赖（本地测试）
npm install

# 打包
cd ..
zip -r deploy-app-service.zip deploy-app-service/
```

### 步骤 7: 部署代码
```bash
az webapp deployment source config-zip \
  --name your-backup-server \
  --resource-group backup-rg \
  --src deploy-app-service.zip
```

### 步骤 8: 配置启动命令
```bash
az webapp config set \
  --name your-backup-server \
  --resource-group backup-rg \
  --startup-file "npm start"
```

### 获取服务器 URL
```bash
echo "https://your-backup-server.azurewebsites.net/backup/upload"
```

### 测试
```bash
curl https://your-backup-server.azurewebsites.net/health
```

---

## 方案三：使用 VS Code 扩展（最简单）

### 前置要求
1. 安装 [VS Code](https://code.visualstudio.com/)
2. 安装扩展：`Azure App Service` 和 `Azure Functions`

### 部署 App Service（推荐）
1. 在 VS Code 中打开项目
2. 按 `F1`，输入 `Azure: Sign In`
3. 登录 Azure
4. 按 `F1`，输入 `Azure App Service: Deploy to Web App`
5. 选择或创建 App Service
6. 选择 `deploy-app-service` 文件夹
7. 等待部署完成

### 部署 Function App
1. 安装 Azure Functions Core Tools：`npm install -g azure-functions-core-tools@4`
2. 创建函数项目：
   ```bash
   func init backup-function --worker-runtime node
   cd backup-function
   func new --name backup --template "HTTP trigger" --authlevel anonymous
   ```
3. 复制代码到 `backup/index.js`
4. 在 VS Code 中，按 `F1`，输入 `Azure Functions: Deploy to Function App`
5. 选择或创建 Function App
6. 等待部署完成

---

## 推荐方案对比

| 方案 | 难度 | 推荐度 | 原因 |
|------|------|--------|------|
| App Service (CLI) | ⭐⭐ | ⭐⭐⭐⭐⭐ | 最简单，标准 Node.js 服务器 |
| App Service (VS Code) | ⭐ | ⭐⭐⭐⭐⭐ | 最简单，图形界面 |
| Function App (CLI) | ⭐⭐⭐ | ⭐⭐⭐ | 需要处理 function.json |
| Function App (VS Code) | ⭐⭐ | ⭐⭐⭐ | 需要安装 Core Tools |

**建议：使用 App Service + VS Code 扩展，最简单！**


