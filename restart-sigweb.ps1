# SigWeb Service 重启脚本
# 需要以管理员身份运行

Write-Host "=== SigWeb Service 重启脚本 ===" -ForegroundColor Cyan
Write-Host ""

# 检查管理员权限
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "错误: 需要管理员权限才能重启服务" -ForegroundColor Red
    Write-Host "请右键点击此脚本，选择 '以管理员身份运行'" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "或者手动操作:" -ForegroundColor Yellow
    Write-Host "1. 按 Win+R，输入 services.msc，回车" -ForegroundColor White
    Write-Host "2. 找到 'Topaz SigWeb Tablet Service' (SigREST)" -ForegroundColor White
    Write-Host "3. 右键点击 -> 重新启动" -ForegroundColor White
    pause
    exit 1
}

# 检查服务是否存在
$service = Get-Service -Name "SigREST" -ErrorAction SilentlyContinue

if (-not $service) {
    Write-Host "错误: 未找到 SigWeb Service (SigREST)" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "服务信息:" -ForegroundColor Yellow
Write-Host "  名称: $($service.Name)" -ForegroundColor White
Write-Host "  显示名称: $($service.DisplayName)" -ForegroundColor White
Write-Host "  当前状态: $($service.Status)" -ForegroundColor White
Write-Host ""

# 停止服务
Write-Host "正在停止服务..." -ForegroundColor Yellow
try {
    Stop-Service -Name "SigREST" -Force -ErrorAction Stop
    Write-Host "✓ 服务已停止" -ForegroundColor Green
    
    # 等待服务完全停止
    $service.WaitForStatus('Stopped', (New-TimeSpan -Seconds 10))
    Start-Sleep -Seconds 2
} catch {
    Write-Host "✗ 停止服务时出错: $($_.Exception.Message)" -ForegroundColor Red
    pause
    exit 1
}

# 启动服务
Write-Host "正在启动服务..." -ForegroundColor Yellow
try {
    Start-Service -Name "SigREST" -ErrorAction Stop
    Write-Host "✓ 服务已启动" -ForegroundColor Green
    
    # 等待服务完全启动
    $service.WaitForStatus('Running', (New-TimeSpan -Seconds 10))
    Start-Sleep -Seconds 2
} catch {
    Write-Host "✗ 启动服务时出错: $($_.Exception.Message)" -ForegroundColor Red
    pause
    exit 1
}

# 验证服务状态
$service.Refresh()
Write-Host ""
Write-Host "最终状态:" -ForegroundColor Yellow
Write-Host "  服务状态: $($service.Status)" -ForegroundColor $(if ($service.Status -eq 'Running') { 'Green' } else { 'Red' })

# 测试端口
Write-Host ""
Write-Host "测试端口连接..." -ForegroundColor Yellow
$port47289 = Test-NetConnection -ComputerName localhost -Port 47289 -InformationLevel Quiet -WarningAction SilentlyContinue
$port47290 = Test-NetConnection -ComputerName localhost -Port 47290 -InformationLevel Quiet -WarningAction SilentlyContinue

if ($port47289) {
    Write-Host "✓ 端口 47289 (HTTP) 可访问" -ForegroundColor Green
} else {
    Write-Host "✗ 端口 47289 (HTTP) 不可访问" -ForegroundColor Red
}

if ($port47290) {
    Write-Host "✓ 端口 47290 (HTTPS) 可访问" -ForegroundColor Green
} else {
    Write-Host "✗ 端口 47290 (HTTPS) 不可访问" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 重启完成 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "请重新启动您的应用程序以使用 SigWeb Service" -ForegroundColor Yellow
Write-Host ""
pause
