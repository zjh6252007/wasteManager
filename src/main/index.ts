import { app, BrowserWindow, ipcMain, dialog, shell, screen } from "electron";
import path from "node:path";
import fs from "node:fs";
import { createDb, repo, getDb } from "./db/connection";
import { activationManager } from "./auth/activationManager";
import { ImportService } from "./import/importService";
import { BiometricService } from "./biometric/biometricService";
import { CameraService } from "./camera/cameraService";
import { FingerprintService } from "./fingerprint/fingerprintService";
import { TabletService } from "./tablet/tabletService";
import { SettingsService } from "./settings/settingsService";
import { PoliceReportService } from "./report/policeReportService";
import { InventoryReportService } from "./report/inventoryReportService";
import { UpdateService } from "./update/updateService";
import { BackupService } from "./backup/backupService";
import { SyncService } from './sync/syncService';

let mainWindow: BrowserWindow | null = null;

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 在开发模式下，Electron Forge 会设置 VITE_DEV_SERVER_URL
  // 如果没有设置，我们手动检查开发服务器
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5174/";
  
  if (process.env.NODE_ENV === "development" || process.env.VITE_DEV_SERVER_URL) {
    console.log("Development mode, loading dev server:", devServerUrl);
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    console.log("Production mode, loading local files");
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
};

// 初始化测试账户
async function initializeTestAccount() {
  try {
    const db = getDb();
    
    // Update existing company name if it's the old Chinese name
    const updateStmt = db.prepare("UPDATE activations SET company_name = 'test', updated_at = CURRENT_TIMESTAMP WHERE company_name = '测试垃圾回收公司'");
    const updateResult = updateStmt.run();
    if (updateResult.changes > 0) {
      console.log(`Updated ${updateResult.changes} activation(s) company name from '测试垃圾回收公司' to 'test'`);
    }
    
    // Check if test activation code already exists
    const existingActivation = db.prepare("SELECT * FROM activations WHERE company_name = 'test' OR company_name = 'Test Waste Recycling Company'").get();
    
    if (!existingActivation) {
      // Create test activation code
      const activationCode = 'GRC-TEST-2024';
      const activatedAt = new Date();
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1); // Expires in 1 year
      
      const activationStmt = db.prepare(`
        INSERT INTO activations (activation_code, company_name, contact_person, contact_phone, contact_email, activated_at, expires_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const activationResult = activationStmt.run(
        activationCode,
        'test',
        'Test Administrator',
        '13800138000',
        'test@example.com',
        activatedAt.toISOString(),
        expiresAt.toISOString(),
        1 // Activated
      );
      
      const activationId = activationResult.lastInsertRowid as number;
      
      // Create test user
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash('admin123', 10);
      
      const userStmt = db.prepare(`
        INSERT INTO users (activation_id, username, password_hash, role)
        VALUES (?, ?, ?, ?)
      `);
      userStmt.run(activationId, 'admin', passwordHash, 'admin');
      
      // Create default metal types
      const defaultMetalTypes = [
        { symbol: 'Cu', name: 'Copper', price_per_unit: 3.5, unit: 'lb' },
        { symbol: 'Al', name: 'Aluminum', price_per_unit: 0.8, unit: 'lb' },
        { symbol: 'Fe', name: 'Iron', price_per_unit: 0.3, unit: 'lb' },
        { symbol: 'Pb', name: 'Lead', price_per_unit: 1.2, unit: 'lb' },
        { symbol: 'Zn', name: 'Zinc', price_per_unit: 1.0, unit: 'lb' },
        { symbol: 'Ni', name: 'Nickel', price_per_unit: 6.5, unit: 'lb' },
        { symbol: 'Br', name: 'Brass', price_per_unit: 2.8, unit: 'lb' },
        { symbol: 'St', name: 'Steel', price_per_unit: 0.4, unit: 'lb' }
      ];
      
      const metalTypeStmt = db.prepare(`
        INSERT INTO metal_types (activation_id, symbol, name, price_per_unit, unit) VALUES (?, ?, ?, ?, ?)
      `);
      for (const metalType of defaultMetalTypes) {
        metalTypeStmt.run(activationId, metalType.symbol, metalType.name, metalType.price_per_unit, metalType.unit);
      }
      
      console.log('Test account created successfully!');
      console.log('Username: admin');
      console.log('Password: admin123');
      console.log('Activation Code: ' + activationCode);
      console.log('Valid until: ' + expiresAt.toLocaleDateString());
    } else {
      console.log('Test account already exists');
    }
  } catch (error) {
    console.error('Failed to initialize test account:', error);
  }
}

app.whenReady().then(async () => {
  await createDb();
  await initializeTestAccount();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 全局变量存储当前用户信息
let currentUser: any = null;
let currentActivation: any = null;

// IPC 处理器
// 授权相关
ipcMain.handle("auth:activateAccount", async (_e, activationCode, username, password) => {
  return await activationManager.activateAccount(activationCode, username, password);
});

ipcMain.handle("auth:authenticateUser", async (_e, username, password) => {
  console.log('Received authentication request:', { username, password: '***' });
  
  try {
    // 查找所有激活的账户，找到匹配的用户
    const db = getDb();
    const userStmt = db.prepare(`
      SELECT u.*, a.* FROM users u 
      JOIN activations a ON u.activation_id = a.id 
      WHERE u.username = ? AND u.is_active = 1 AND a.is_active = 1
    `);
    const user = userStmt.get(username) as any;
    
    console.log('Found user:', user);
    
    if (!user) {
      console.log('User not found or not activated');
      return { success: false, message: "Invalid username or password" };
    }

    // Check if activation is expired
    const now = new Date();
    const expiresAt = new Date(user.expires_at);
    console.log('Current time:', now.toISOString());
    console.log('Expiration time:', expiresAt.toISOString());
    
    if (now > expiresAt) {
      console.log('Account expired');
      return { success: false, message: "Account expired, please reactivate" };
    }

    // Verify password
    const bcrypt = require('bcryptjs');
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    console.log('Password verification result:', isPasswordValid);
    
    if (!isPasswordValid) {
      console.log('Invalid password');
      return { success: false, message: "Invalid username or password" };
    }

    // Update last login time
    db.prepare("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);

    // Set current user and activation info
    currentUser = user;
    currentActivation = user;

    // 初始化备份服务
    await initializeBackupService();

    // 初始化同步服务
    await initializeSyncService();

    console.log('Login successful, setting current user:', currentUser);
    return { success: true, message: "Login successful", user };
  } catch (error: any) {
    console.error('Error during authentication:', error);
    return { success: false, message: `Login failed: ${error.message}` };
  }
});

ipcMain.handle("auth:checkActivationStatus", async (_e, activationCode) => {
  return await activationManager.checkActivationStatus(activationCode);
});

ipcMain.handle("auth:getCurrentUser", () => currentUser);
ipcMain.handle("auth:getCurrentActivation", () => currentActivation);

ipcMain.handle("auth:logout", () => {
  currentUser = null;
  currentActivation = null;
  return { success: true };
});

// 管理员功能（用于你为客户开通激活码）
ipcMain.handle("admin:createActivationCode", async (_e, data) => {
  // 这里可以添加管理员权限验证
  return await activationManager.createActivationCode(data);
});

// 测试功能：创建测试激活码
ipcMain.handle("test:createTestActivationCode", async () => {
  try {
    const result = await activationManager.createActivationCode({
      companyName: 'test',
      contactPerson: '张三',
      contactPhone: '13800138000',
      contactEmail: 'test@example.com'
    });
    
    if (result.success) {
      return {
        success: true,
        activationCode: result.activationCode,
        message: '测试激活码创建成功！\n激活码: ' + result.activationCode + '\n请使用激活码激活账户'
      };
    } else {
      return result;
    }
  } catch (error) {
    return {
      success: false,
      message: '创建测试激活码失败: ' + error
    };
  }
});

ipcMain.handle("admin:renewActivation", async (_e, activationCode) => {
  return await activationManager.renewActivation(activationCode);
});

ipcMain.handle("admin:disableActivation", async (_e, activationCode) => {
  return await activationManager.disableActivation(activationCode);
});

// 客户相关（需要激活）
ipcMain.handle("customers:create", (_e, data) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.customers.create(currentActivation.id, data);
});

ipcMain.handle("customers:getAll", () => {
  if (!currentActivation) throw new Error('未激活');
  return repo.customers.getAll(currentActivation.id);
});

ipcMain.handle("customers:getById", (_e, id) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.customers.getById(currentActivation.id, id);
});

ipcMain.handle("customers:search", (_e, query: string) => {
  if (!currentActivation) throw new Error('未激活');
  if (!query || query.trim().length === 0) {
    return repo.customers.getAll(currentActivation.id);
  }
  return repo.customers.search(currentActivation.id, query.trim());
});

ipcMain.handle("customers:getPaginated", (_e, options: { page: number; pageSize: number; searchQuery?: string }) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.customers.getPaginated(currentActivation.id, options);
});

ipcMain.handle("customers:update", (_e, customerId: number, data: any) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.customers.update(currentActivation.id, customerId, data);
});

// 垃圾类型相关（需要激活）
ipcMain.handle("wasteTypes:getAll", () => {
  if (!currentActivation) throw new Error('未激活');
  return repo.wasteTypes.getAll(currentActivation.id);
});

ipcMain.handle("wasteTypes:getById", (_e, id) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.wasteTypes.getById(currentActivation.id, id);
});

// 称重会话相关（需要激活）
ipcMain.handle("weighingSessions:create", (_e, data) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighingSessions.create(currentActivation.id, data);
});

ipcMain.handle("weighingSessions:updateTotal", (_e, sessionId, totalAmount) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighingSessions.updateTotal(currentActivation.id, sessionId, totalAmount);
});

ipcMain.handle("weighingSessions:update", (_e, sessionId, data) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighingSessions.update(currentActivation.id, sessionId, data);
});

ipcMain.handle("weighingSessions:getById", (_e, id) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighingSessions.getById(currentActivation.id, id);
});

ipcMain.handle("weighingSessions:getUnfinishedCount", () => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighingSessions.getUnfinishedCount(currentActivation.id);
});

ipcMain.handle("weighingSessions:deleteAll", () => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighingSessions.deleteAll(currentActivation.id);
});

// 称重记录相关（需要激活）
ipcMain.handle("weighings:create", (_e, data) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighings.create(currentActivation.id, data);
});

ipcMain.handle("weighings:getBySession", (_e, sessionId) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighings.getBySession(currentActivation.id, sessionId);
});

ipcMain.handle("weighings:deleteBySession", (_e, sessionId) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighings.deleteBySession(currentActivation.id, sessionId);
});

ipcMain.handle("weighings:getAll", () => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighings.getAll(currentActivation.id);
});

ipcMain.handle("weighings:getById", (_e, id) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighings.getById(currentActivation.id, id);
});

ipcMain.handle("weighings:getPaginated", (_e, options) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.weighings.getPaginated(currentActivation.id, options);
});

// 车辆相关（需要激活）
ipcMain.handle("vehicles:getAll", () => {
  if (!currentActivation) throw new Error('未激活');
  return repo.vehicles.getAll(currentActivation.id);
});

ipcMain.handle("vehicles:getById", (_e, id) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.vehicles.getById(currentActivation.id, id);
});

ipcMain.handle("vehicles:getByCustomerId", (_e, customerId: number) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.vehicles.getByCustomerId(currentActivation.id, customerId);
});

ipcMain.handle("vehicles:create", (_e, data: any) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.vehicles.create(currentActivation.id, data);
});

// 导入功能
ipcMain.handle("import:selectFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: '选择导入文件',
    filters: [
      { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 选择图片文件
ipcMain.handle("file:selectImage", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Driver License Image',
    filters: [
      { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle("import:importCustomers", async (event, filePath) => {
  if (!currentActivation) throw new Error('未激活');
  
  const importService = new ImportService(currentActivation.id);
  return await importService.importCustomers(filePath, (progress) => {
    // 发送进度更新事件
    if (mainWindow) {
      mainWindow.webContents.send('import:progress', progress);
    }
  });
});

ipcMain.handle("import:importVehicles", async (event, filePath) => {
  if (!currentActivation) throw new Error('未激活');
  
  const importService = new ImportService(currentActivation.id);
  return await importService.importVehicles(filePath, (progress) => {
    // 发送进度更新事件
    if (mainWindow) {
      mainWindow.webContents.send('import:progress', progress);
    }
  });
});

// 生物识别相关
ipcMain.handle("biometric:getByCustomerId", (_e, customerId) => {
  if (!currentActivation) throw new Error('未激活');
  return repo.biometricData.getByCustomerId(currentActivation.id, customerId);
});

// 读取图片文件并返回base64数据URL
ipcMain.handle("image:readFile", async (_e, filePath: string) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    
    const fileData = fs.readFileSync(filePath);
    const base64 = fileData.toString('base64');
    // 根据文件扩展名确定MIME类型
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp'
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';
    
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Failed to read image file:', error);
    return null;
  }
});

ipcMain.handle("biometric:getAll", () => {
  if (!currentActivation) throw new Error('未激活');
  return repo.biometricData.getAll(currentActivation.id);
});

ipcMain.handle("biometric:saveFaceImage", async (_e, customerId, imageData) => {
  if (!currentActivation) throw new Error('未激活');
  
  const biometricService = new BiometricService(currentActivation.id);
  return await biometricService.saveFaceImage(customerId, Buffer.from(imageData));
});

ipcMain.handle("biometric:saveFingerprint", async (_e, customerId, template, imageData) => {
  if (!currentActivation) throw new Error('未激活');
  
  const biometricService = new BiometricService(currentActivation.id);
  return await biometricService.saveFingerprintData(
    customerId, 
    Buffer.from(template), 
    imageData ? Buffer.from(imageData) : undefined
  );
});

ipcMain.handle("biometric:saveSignatureImage", async (_e, customerId, imageData) => {
  if (!currentActivation) throw new Error('未激活');
  
  const biometricService = new BiometricService(currentActivation.id);
  return await biometricService.saveSignatureImage(customerId, Buffer.from(imageData));
});

// 驾照照片相关
ipcMain.handle("license:savePhoto", async (_e, customerId, imageData) => {
  if (!currentActivation) throw new Error('未激活');
  
  const biometricService = new BiometricService(currentActivation.id);
  
  // 如果customerId是临时ID（大于1000000000000，即Date.now()的范围），只保存文件
  // 否则正常保存到数据库
  if (customerId > 1000000000000) {
    // 临时照片，只保存文件
    return await biometricService.saveTemporaryPhoto(Buffer.from(imageData));
  } else {
    // 正常保存，包含数据库操作
    return await biometricService.saveFaceImage(customerId, Buffer.from(imageData));
  }
});

// 摄像头相关
ipcMain.handle("camera:start", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const cameraService = new CameraService(mainWindow);
  return await cameraService.startCamera();
});

ipcMain.handle("camera:stop", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const cameraService = new CameraService(mainWindow);
  await cameraService.stopCamera();
});

ipcMain.handle("camera:capture", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const cameraService = new CameraService(mainWindow);
  return await cameraService.capturePhoto();
});


ipcMain.handle("camera:getDevices", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const cameraService = new CameraService(mainWindow);
  return await cameraService.getCameraDevices();
});

// 指纹板相关
// 全局指纹服务实例
let fingerprintServiceInstance: FingerprintService | null = null;

ipcMain.handle("fingerprint:init", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.initializeFingerprint();
});

ipcMain.handle("fingerprint:startCapture", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.startFingerprintCapture();
});

ipcMain.handle("fingerprint:stopCapture", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  if (!fingerprintServiceInstance) {
    return;
  }
  
  await fingerprintServiceInstance.stopFingerprintCapture();
});

ipcMain.handle("fingerprint:capture", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.captureFingerprint();
});


ipcMain.handle("fingerprint:verify", async (_e, template) => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.verifyFingerprint(Buffer.from(template));
});

ipcMain.handle("fingerprint:getStatus", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  if (!fingerprintServiceInstance) {
    return 'Not initialized';
  }
  
  return await fingerprintServiceInstance.getFingerprintStatus();
});

// 列出所有USB设备（用于调试和检测）
ipcMain.handle("fingerprint:listAllUsbDevices", async () => {
  const { FingerprintHardware } = await import('./fingerprint/fingerprintHardware');
  return await FingerprintHardware.listAllUsbDevices();
});

// 手写板相关
ipcMain.handle("tablet:init", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.initializeTablet();
});

ipcMain.handle("tablet:startCapture", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.startSignatureCapture();
});

ipcMain.handle("tablet:stopCapture", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const tabletService = new TabletService(mainWindow);
  await tabletService.stopSignatureCapture();
});

ipcMain.handle("tablet:capture", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.captureSignature();
});

ipcMain.handle("tablet:getStatus", async () => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.getTabletStatus();
});

// 鼠标锁定功能（用于签名时限制鼠标范围）
// 使用 Windows API ClipCursor 来锁定鼠标
let cursorLocked = false;

ipcMain.handle("tablet:lockCursor", async (_e, bounds: { x: number, y: number, width: number, height: number }) => {
  if (!mainWindow) throw new Error('主窗口未初始化');
  
  try {
    // 获取主窗口的位置
    const windowBounds = mainWindow.getBounds();
    
    // 计算屏幕坐标（考虑窗口位置）
    const screenX = Math.round(windowBounds.x + bounds.x);
    const screenY = Math.round(windowBounds.y + bounds.y);
    const screenRight = Math.round(screenX + bounds.width);
    const screenBottom = Math.round(screenY + bounds.height);
    
    // 在 Windows 上使用 Windows API 锁定鼠标
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      try {
        // 使用 PowerShell 调用 Windows API ClipCursor
        // 创建一个临时的 C# 脚本来调用 Windows API
        const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CursorLock {
  [DllImport("user32.dll")]
  public static extern bool ClipCursor(ref RECT lpRect);
  
  [DllImport("user32.dll")]
  public static extern bool ClipCursor(IntPtr lpRect);
  
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  
  public static bool Lock(int left, int top, int right, int bottom) {
    RECT rect = new RECT();
    rect.Left = left;
    rect.Top = top;
    rect.Right = right;
    rect.Bottom = bottom;
    return ClipCursor(ref rect);
  }
  
  public static bool Unlock() {
    return ClipCursor(IntPtr.Zero);
  }
}
"@
$result = [CursorLock]::Lock(${screenX}, ${screenY}, ${screenRight}, ${screenBottom})
if ($result) { Write-Output "SUCCESS" } else { Write-Output "FAILED" }
`;
        
        // 将 PowerShell 脚本写入临时文件，避免转义问题
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const tempFile = path.join(os.tmpdir(), `cursor-lock-${Date.now()}.ps1`);
        fs.writeFileSync(tempFile, psScript, 'utf8');
        
        try {
          const command = `powershell -ExecutionPolicy Bypass -File "${tempFile}"`;
          const { stdout } = await execAsync(command, { timeout: 5000 });
          
          // 清理临时文件
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            // 忽略清理错误
          }
          
          if (stdout && stdout.trim() === 'SUCCESS') {
            cursorLocked = true;
            console.log(`Cursor locked to area: x=${screenX}, y=${screenY}, width=${bounds.width}, height=${bounds.height}`);
            return { success: true };
          } else {
            console.error('Failed to lock cursor via Windows API, stdout:', stdout);
            return { success: false, error: 'Failed to lock cursor' };
          }
        } catch (error) {
          console.error('Failed to lock cursor:', error);
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      } catch (error) {
        console.error('Failed to lock cursor:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
    
    return { success: false, error: 'Platform not supported' };
  } catch (error) {
    console.error('Error locking cursor:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle("tablet:unlockCursor", async () => {
  try {
    if (process.platform === 'win32' && cursorLocked) {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CursorLock {
  [DllImport("user32.dll")]
  public static extern bool ClipCursor(IntPtr lpRect);
  
  public static bool Unlock() {
    return ClipCursor(IntPtr.Zero);
  }
}
"@
$result = [CursorLock]::Unlock()
if ($result) { Write-Output "SUCCESS" } else { Write-Output "FAILED" }
`;
      
      // 将 PowerShell 脚本写入临时文件，避免转义问题
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const tempFile = path.join(os.tmpdir(), `cursor-unlock-${Date.now()}.ps1`);
      fs.writeFileSync(tempFile, psScript, 'utf8');
      
      try {
        const command = `powershell -ExecutionPolicy Bypass -File "${tempFile}"`;
        const { stdout } = await execAsync(command, { timeout: 5000 });
        
        // 清理临时文件
        try {
          fs.unlinkSync(tempFile);
        } catch (e) {
          // 忽略清理错误
        }
        
        if (stdout && stdout.trim() === 'SUCCESS') {
          cursorLocked = false;
          console.log('Cursor unlocked');
          return { success: true };
        } else {
          console.error('Failed to unlock cursor via Windows API');
          return { success: false, error: 'Failed to unlock cursor' };
        }
      } catch (error) {
        console.error('Failed to unlock cursor:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
    return { success: true };
  } catch (error) {
    console.error('Error unlocking cursor:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// 设置相关
ipcMain.handle("settings:getSettings", async () => {
  if (!currentActivation) throw new Error('未激活');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.getSettings();
});

ipcMain.handle("settings:saveSettings", async (_e, settings) => {
  if (!currentActivation) throw new Error('未激活');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.saveSettings(settings);
});

ipcMain.handle("settings:getDevices", async (_event, deviceType?: string) => {
  if (!currentActivation) throw new Error('未激活');
  
  const settingsService = new SettingsService(currentActivation.id, mainWindow);
  return await settingsService.getDevices(deviceType as any);
});

ipcMain.handle("settings:testDevice", async (_e, deviceId, type) => {
  if (!currentActivation) throw new Error('未激活');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.testDevice(deviceId, type);
});

// 更新相关
const updateService = new UpdateService(); // 可以传入自定义更新服务器URL，例如: new UpdateService('https://your-update-server.com/api/check-update')

// 设置下载进度回调
updateService.setProgressCallback((progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('update:download-progress', progress);
  }
});

ipcMain.handle("update:checkForUpdates", async () => {
  return await updateService.checkForUpdates();
});

ipcMain.handle("update:downloadUpdate", async (_event, downloadUrl: string) => {
  await updateService.downloadUpdate(downloadUrl);
});

ipcMain.handle("update:getCurrentVersion", async () => {
  return updateService.getCurrentVersion();
});

// 备份相关
let backupService: BackupService | null = null;
let backupIntervalId: NodeJS.Timeout | null = null;

// 同步相关
let syncService: SyncService | null = null;

// 初始化备份服务
async function initializeBackupService() {
  if (currentActivation) {
    const settingsService = new SettingsService(currentActivation.id);
    const settings = await settingsService.getSettings();
    const backupServerUrl = settings.backupServerUrl;
    
    backupService = new BackupService(currentActivation.id, backupServerUrl);
    
    // 设置进度回调
    backupService.setProgressCallback((progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('backup:progress', progress);
      }
    });

    // 设置自动备份定时任务
    setupAutoBackup(settings);
  }
}

// 初始化同步服务
async function initializeSyncService() {
  if (currentActivation) {
    try {
      const settingsService = new SettingsService(currentActivation.id);
      const settings = await settingsService.getSettings();
      const backupServerUrl = settings.backupServerUrl;
      
      syncService = new SyncService(currentActivation.id, backupServerUrl);
      
      // 设置进度回调
      syncService.setProgressCallback((progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('sync:progress', progress);
        }
      });

      // 启动局域网同步服务（如果失败也不影响登录）
      try {
        await syncService.startLocalSync();
      } catch (error) {
        console.warn('Failed to start local sync service:', error);
        // 继续执行，不阻止登录
      }
    } catch (error) {
      console.error('Error initializing sync service:', error);
      // 不阻止登录，只是同步功能不可用
    }
  }
}

// 设置自动备份
function setupAutoBackup(settings: any) {
  // 清除现有定时任务
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
  }

  // 如果启用了自动备份
  if (settings.backupEnabled && settings.backupInterval > 0 && backupService) {
    const intervalMs = settings.backupInterval * 60 * 60 * 1000; // 转换为毫秒
    
    // 立即检查一次网络并备份（如果在线）
    checkAndBackup();

    // 设置定时任务
    backupIntervalId = setInterval(() => {
      checkAndBackup();
    }, intervalMs);

    console.log(`Auto backup enabled: every ${settings.backupInterval} hours`);
  }
}

// 检查网络并执行备份
async function checkAndBackup() {
  if (!backupService || !currentActivation) {
    return;
  }

  try {
    const isOnline = await backupService.checkNetworkConnection();
    if (isOnline) {
      console.log('Network available, starting backup...');
      await backupService.performBackup();
      console.log('Backup completed successfully');
    } else {
      console.log('Network unavailable, skipping backup');
    }
  } catch (error) {
    console.error('Auto backup failed:', error);
  }
}

// 在用户登录后初始化备份服务（通过 authenticateUser 处理器）
// 注意：这个会在用户成功登录后自动调用

ipcMain.handle("backup:performBackup", async () => {
  if (!currentActivation) throw new Error('Not activated');
  if (!backupService) {
    await initializeBackupService();
  }
  if (!backupService) throw new Error('Backup service not initialized');
  
  return await backupService.performBackup();
});

ipcMain.handle("backup:checkNetwork", async () => {
  if (!backupService) {
    if (!currentActivation) return false;
    await initializeBackupService();
  }
  if (!backupService) return false;
  
  return await backupService.checkNetworkConnection();
});

ipcMain.handle("backup:updateSettings", async (_event, backupServerUrl: string) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 更新备份服务配置
  if (backupService) {
    backupService.setBackupServerUrl(backupServerUrl);
  } else {
    await initializeBackupService();
  }

  // 更新同步服务配置
  if (syncService) {
    // 重新初始化同步服务以更新配置
    syncService.stopLocalSync();
    await initializeSyncService();
  }

  // 更新设置并重新设置自动备份
  const settingsService = new SettingsService(currentActivation.id);
  const settings = await settingsService.getSettings();
  settings.backupServerUrl = backupServerUrl;
  await settingsService.saveSettings(settings);
  setupAutoBackup(settings);
});

// 同步相关 IPC 处理器
ipcMain.handle("sync:discoverDevices", async () => {
  if (!syncService) throw new Error('Sync service not initialized');
  return await syncService.discoverDevices();
});

ipcMain.handle("sync:syncWithDevice", async (_event, device) => {
  if (!syncService) throw new Error('Sync service not initialized');
  return await syncService.syncWithDevice(device);
});

ipcMain.handle("sync:syncFromCloud", async () => {
  if (!syncService) throw new Error('Sync service not initialized');
  return await syncService.syncFromCloud();
});

ipcMain.handle("sync:performAutoSync", async () => {
  if (!syncService) throw new Error('Sync service not initialized');
  return await syncService.performAutoSync();
});

ipcMain.handle("sync:startLocalSync", async () => {
  if (!syncService) throw new Error('Sync service not initialized');
  await syncService.startLocalSync();
  return { success: true };
});

ipcMain.handle("sync:stopLocalSync", async () => {
  if (!syncService) throw new Error('Sync service not initialized');
  syncService.stopLocalSync();
  return { success: true };
});

ipcMain.handle("settings:resetSettings", async () => {
  if (!currentActivation) throw new Error('未激活');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.resetSettings();
});

ipcMain.handle("settings:exportSettings", async () => {
  if (!currentActivation) throw new Error('未激活');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.exportSettings();
});

ipcMain.handle("settings:importSettings", async (_e, settingsJson) => {
  if (!currentActivation) throw new Error('未激活');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.importSettings(settingsJson);
});

// Inventory Summary Report相关
ipcMain.handle("report:generateInventoryReport", async (_e, startDate: string, endDate: string) => {
  if (!currentActivation) throw new Error('未激活');
  
  try {
    const reportService = new InventoryReportService(currentActivation.id);
    const filePath = await reportService.generateReport(startDate, endDate);
    
    // 在应用内新窗口中打开PDF
    const pdfWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      title: `Inventory Summary Report - ${startDate} to ${endDate}`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true,
      }
    });
    
    const pdfUrl = `file://${filePath.replace(/\\/g, '/')}`;
    pdfWindow.loadURL(pdfUrl);
    
    pdfWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL) => {
      console.warn('PDF load failed, trying alternative:', errorCode, errorDescription);
      const opened = await shell.openPath(filePath);
      if (opened) {
        console.error('Failed to open PDF with system viewer:', opened);
      }
    });
    
    return { success: true, filePath };
  } catch (error: any) {
    console.error('Failed to generate inventory report:', error);
    throw new Error(`生成报告失败: ${error.message}`);
  }
});

// Police Report相关
ipcMain.handle("report:generatePoliceReport", async (_e, sessionId: number) => {
  if (!currentActivation) throw new Error('未激活');
  
  try {
    const reportService = new PoliceReportService(currentActivation.id);
    const filePath = await reportService.generateReport(sessionId);
    
    // 在应用内新窗口中打开PDF
    const pdfWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      title: `Police Report - Session #${sessionId}`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true, // 启用插件以支持PDF显示
      }
    });
    
    // 使用file://协议直接加载PDF文件
    // Electron的webContents可以显示PDF，如果系统安装了PDF插件
    const pdfUrl = `file://${filePath.replace(/\\/g, '/')}`;
    pdfWindow.loadURL(pdfUrl);
    
    // 如果PDF无法加载，尝试使用备选方案
    pdfWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL) => {
      console.warn('PDF load failed, trying alternative:', errorCode, errorDescription);
      // 如果直接加载失败，创建一个包含PDF.js的查看器
      // 这里我们先尝试使用系统默认查看器作为备选
      const opened = await shell.openPath(filePath);
      if (opened) {
        console.error('Failed to open PDF with system viewer:', opened);
        // 可以在这里添加更详细的错误提示
      }
    });
    
    // 窗口关闭时清理
    pdfWindow.on('closed', () => {
      // 窗口已关闭，不需要额外清理
    });
    
    return { success: true, filePath };
  } catch (error: any) {
    console.error('Failed to generate police report:', error);
    throw new Error(`生成报告失败: ${error.message}`);
  }
});

// 金属种类相关
ipcMain.handle("metalTypes:create", async (_e, data) => {
  if (!currentActivation) throw new Error('未激活');
  
  return repo.metalTypes.create(currentActivation.id, data);
});

ipcMain.handle("metalTypes:getAll", async () => {
  if (!currentActivation) throw new Error('未激活');
  
  return repo.metalTypes.getAll(currentActivation.id);
});

ipcMain.handle("metalTypes:getById", async (_e, id) => {
  if (!currentActivation) throw new Error('未激活');
  
  return repo.metalTypes.getById(currentActivation.id, id);
});

ipcMain.handle("metalTypes:update", async (_e, id, data) => {
  if (!currentActivation) throw new Error('未激活');
  
  // 记录价格变更历史
  if (data.price_per_unit !== undefined) {
    const existingMetal = await repo.metalTypes.getById(currentActivation.id, id) as any;
    if (existingMetal && existingMetal.price_per_unit !== data.price_per_unit) {
      await repo.metalPriceHistory.create(currentActivation.id, {
        metal_type_id: id,
        old_price: existingMetal.price_per_unit,
        new_price: data.price_per_unit
      });
    }
  }
  
  return repo.metalTypes.update(currentActivation.id, id, data);
});

ipcMain.handle("metalTypes:delete", async (_e, id) => {
  if (!currentActivation) throw new Error('未激活');
  
  return repo.metalTypes.delete(currentActivation.id, id);
});

ipcMain.handle("metalTypes:findBySymbol", async (_e, symbol) => {
  if (!currentActivation) throw new Error('未激活');
  
  return repo.metalTypes.findBySymbol(currentActivation.id, symbol);
});

ipcMain.handle("metalPriceHistory:getByMetalType", async (_e, metalTypeId) => {
  if (!currentActivation) throw new Error('未激活');
  
  return repo.metalPriceHistory.getByMetalType(currentActivation.id, metalTypeId);
});

