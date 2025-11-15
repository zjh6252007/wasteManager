# Azure App Service 一键部署脚本
# 使用方法：.\deploy.ps1

param(
    [string]$ResourceGroup = "backup-rg",
    [string]$Location = "eastus2",
    [string]$StorageAccount = "backupstorage$(Get-Random -Maximum 9999)",
    [string]$AppServiceName = "backup-server-$(Get-Random -Maximum 9999)"
)

Write-Host "=== Azure 备份服务器部署脚本 ===" -ForegroundColor Green
Write-Host ""

# 检查 Azure CLI
Write-Host "检查 Azure CLI..." -ForegroundColor Yellow
try {
    $azVersion = az --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI 未安装"
    }
    Write-Host "✓ Azure CLI 已安装" -ForegroundColor Green
} catch {
    Write-Host "✗ Azure CLI 未安装或未添加到 PATH" -ForegroundColor Red
    Write-Host "请先安装 Azure CLI: https://aka.ms/installazurecliwindows" -ForegroundColor Yellow
    Write-Host "或查看 AZURE_CLI_SETUP.md 获取详细说明" -ForegroundColor Yellow
    exit 1
}

# 检查登录状态
Write-Host "检查登录状态..." -ForegroundColor Yellow
$account = az account show 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "需要登录 Azure..." -ForegroundColor Yellow
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ 登录失败" -ForegroundColor Red
        exit 1
    }
}
Write-Host "✓ 已登录" -ForegroundColor Green
Write-Host ""

# 创建资源组
Write-Host "创建资源组: $ResourceGroup..." -ForegroundColor Yellow
az group create --name $ResourceGroup --location $Location --output none
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ 资源组创建成功" -ForegroundColor Green
} else {
    Write-Host "✗ 资源组创建失败（可能已存在）" -ForegroundColor Yellow
}
Write-Host ""

# 创建存储账户
Write-Host "创建存储账户: $StorageAccount..." -ForegroundColor Yellow
az storage account create `
    --name $StorageAccount `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Standard_LRS `
    --output none

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ 存储账户创建成功" -ForegroundColor Green
} else {
    Write-Host "✗ 存储账户创建失败" -ForegroundColor Red
    exit 1
}

# 创建容器
Write-Host "创建容器: backups..." -ForegroundColor Yellow
az storage container create `
    --name backups `
    --account-name $StorageAccount `
    --public-access off `
    --output none

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ 容器创建成功" -ForegroundColor Green
} else {
    Write-Host "✗ 容器创建失败" -ForegroundColor Red
}
Write-Host ""

# 创建 App Service Plan
Write-Host "创建 App Service Plan..." -ForegroundColor Yellow
az appservice plan create `
    --name backup-plan `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku FREE `
    --is-linux `
    --output none

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ App Service Plan 创建成功" -ForegroundColor Green
} else {
    Write-Host "✗ App Service Plan 创建失败（可能已存在）" -ForegroundColor Yellow
}
Write-Host ""

# 创建 App Service
Write-Host "创建 App Service: $AppServiceName..." -ForegroundColor Yellow
az webapp create `
    --name $AppServiceName `
    --resource-group $ResourceGroup `
    --plan backup-plan `
    --runtime "NODE:20-lts" `
    --output none

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ App Service 创建成功" -ForegroundColor Green
} else {
    Write-Host "✗ App Service 创建失败" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 配置环境变量
Write-Host "配置环境变量..." -ForegroundColor Yellow
$storageKey = az storage account keys list `
    --account-name $StorageAccount `
    --resource-group $ResourceGroup `
    --query "[0].value" `
    --output tsv

az webapp config appsettings set `
    --name $AppServiceName `
    --resource-group $ResourceGroup `
    --settings `
        STORAGE_ACCOUNT_NAME=$StorageAccount `
        STORAGE_ACCOUNT_KEY=$storageKey `
        CONTAINER_NAME=backups `
        PORT=8080 `
    --output none

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ 环境变量配置成功" -ForegroundColor Green
} else {
    Write-Host "✗ 环境变量配置失败" -ForegroundColor Red
}
Write-Host ""

# 准备部署文件
Write-Host "准备部署文件..." -ForegroundColor Yellow
if (-not (Test-Path "deploy-app-service")) {
    New-Item -ItemType Directory -Path "deploy-app-service" | Out-Null
}

# 复制文件
Copy-Item "azure-app-service-backup.js" "deploy-app-service\server.js" -Force
Copy-Item "deploy-app-service\package.json" "deploy-app-service\package.json" -Force

# 创建 ZIP
if (Test-Path "deploy-app-service.zip") {
    Remove-Item "deploy-app-service.zip" -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory("deploy-app-service", "deploy-app-service.zip")

Write-Host "✓ 部署文件准备完成" -ForegroundColor Green
Write-Host ""

# 部署代码
Write-Host "部署代码到 App Service..." -ForegroundColor Yellow
az webapp deployment source config-zip `
    --name $AppServiceName `
    --resource-group $ResourceGroup `
    --src deploy-app-service.zip `
    --output none

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ 代码部署成功" -ForegroundColor Green
} else {
    Write-Host "✗ 代码部署失败" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 配置启动命令
Write-Host "配置启动命令..." -ForegroundColor Yellow
az webapp config set `
    --name $AppServiceName `
    --resource-group $ResourceGroup `
    --startup-file "npm start" `
    --output none

Write-Host "✓ 启动命令配置完成" -ForegroundColor Green
Write-Host ""

# 显示结果
$appUrl = "https://$AppServiceName.azurewebsites.net"
Write-Host "=== 部署完成！ ===" -ForegroundColor Green
Write-Host ""
Write-Host "服务器 URL: $appUrl" -ForegroundColor Cyan
Write-Host "备份端点: $appUrl/backup/upload" -ForegroundColor Cyan
Write-Host "健康检查: $appUrl/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "在应用设置中配置备份服务器 URL: $appUrl/backup/upload" -ForegroundColor Yellow
Write-Host ""

# 测试健康检查
Write-Host "测试服务器..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
try {
    $response = Invoke-WebRequest -Uri "$appUrl/health" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-Host "✓ 服务器运行正常！" -ForegroundColor Green
        Write-Host $response.Content
    }
} catch {
    Write-Host "⚠ 服务器可能还在启动中，请稍后访问 $appUrl/health 测试" -ForegroundColor Yellow
}


