# Azure CLI 安装和配置指南

## 步骤 1: 安装 Azure CLI

### Windows 方法 1: 使用安装程序（推荐）
1. 下载安装程序：https://aka.ms/installazurecliwindows
2. 运行安装程序（.msi 文件）
3. 安装完成后，**重启 PowerShell 或命令提示符**

### Windows 方法 2: 使用 PowerShell
```powershell
# 以管理员身份运行 PowerShell
Invoke-WebRequest -Uri https://aka.ms/installazurecliwindows -OutFile .\AzureCLI.msi
Start-Process msiexec.exe -Wait -ArgumentList '/I AzureCLI.msi /quiet'
```

## 步骤 2: 验证安装
打开**新的** PowerShell 窗口，运行：
```powershell
az --version
```

如果显示版本号，说明安装成功！

## 步骤 3: 登录 Azure
```powershell
az login
```
这会打开浏览器，让你登录 Azure 账户。

## 步骤 4: 设置默认订阅（如果有多个订阅）
```powershell
# 查看所有订阅
az account list --output table

# 设置默认订阅（替换为你的订阅ID）
az account set --subscription "你的订阅ID"
```

## 步骤 5: 开始部署
现在可以按照 `DEPLOY_WITHOUT_PORTAL.md` 中的步骤部署了！


