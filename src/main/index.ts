import { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu, globalShortcut } from "electron";
import path from "node:path";
import fs from "node:fs";
import { exec } from "node:child_process";
import os from "node:os";
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
let isQuitting = false;

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true, // Hide menu bar
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Note: DevTools Autofill errors are internal to Chromium DevTools and cannot be easily suppressed
  // These errors are harmless and don't affect functionality
  // They occur because DevTools tries to use Chrome APIs not available in Electron
  // The errors will only appear in development mode when DevTools is open

  // Handle window close event
  mainWindow.on('close', async (event) => {
    // If already marked for quit, allow close directly
    if (isQuitting) {
      return;
    }

    // Clean up all timers
    if (syncIntervalId) {
      clearInterval(syncIntervalId);
      syncIntervalId = null;
    }
    if (realtimeSyncIntervalId) {
      clearInterval(realtimeSyncIntervalId);
      realtimeSyncIntervalId = null;
    }
    if (networkCheckIntervalId) {
      clearInterval(networkCheckIntervalId);
      networkCheckIntervalId = null;
    }
    // Close WebSocket connection
    if (wsClient) {
      wsClient.close();
      wsClient = null;
    }
    if (backupIntervalId) {
      clearInterval(backupIntervalId);
      backupIntervalId = null;
    }

    // If sync service exists and user is logged in, attempt to sync
    if (syncService && currentActivation) {
      try {
        console.log('Window closing, attempting to sync data to cloud...');
        
        // Check network connection
        const isOnline = await syncService.checkNetworkConnection();
        
        if (isOnline) {
          // Prevent default close behavior
          event.preventDefault();
          isQuitting = true;

          // Show sync notification
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync:closing-sync', {
              message: 'Syncing data to cloud, please wait...'
            });
          }

          // Execute sync with timeout (10 seconds)
          const syncPromise = syncService.uploadToCloud();
          const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
              resolve({ success: false, message: 'Sync timeout' });
            }, 10000); // 10 second timeout
          });

          const result = await Promise.race([syncPromise, timeoutPromise]) as any;
          
          if (result.success) {
            console.log('Data synced successfully before closing');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('sync:closing-sync-complete', {
                success: true,
                message: 'Data sync completed'
              });
            }
          } else {
            console.warn('Sync failed or timeout before closing:', result.message);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('sync:closing-sync-complete', {
                success: false,
                message: 'Sync timeout or failed, but application will continue to close'
              });
            }
          }

          // Delay a bit to let user see the message, then close window
          setTimeout(() => {
            cleanupAndQuit();
          }, 500);
        } else {
          console.log('Network unavailable, closing without sync');
          // Network unavailable, close directly
          cleanupAndQuit();
        }
      } catch (error) {
        console.error('Error syncing before close:', error);
        // Allow close even on error
        cleanupAndQuit();
      }
    } else {
      // No sync service or not logged in, close directly
      cleanupAndQuit();
    }
  });

  // In development mode, Electron Forge will set VITE_DEV_SERVER_URL
  // If not set, we manually check the dev server
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

// Create desktop shortcut if it doesn't exist
function ensureDesktopShortcut() {
  // Only create shortcut in production mode (not in development)
  if (process.env.NODE_ENV === "development" || process.env.VITE_DEV_SERVER_URL) {
    return;
  }

  try {
    const desktopPath = path.join(os.homedir(), "Desktop");
    const shortcutPath = path.join(desktopPath, "Waste Recycling Scale System.lnk");
    const exePath = app.getPath("exe");

    // Check if shortcut already exists
    if (fs.existsSync(shortcutPath)) {
      console.log("Desktop shortcut already exists");
      return;
    }

    // Create shortcut using PowerShell
    const command = `powershell -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut('${shortcutPath}');$s.TargetPath='${exePath}';$s.WorkingDirectory='${path.dirname(exePath)}';$s.Description='Waste Recycling Scale System - Garbage Recycling Weighing System';$s.Save()"`;
    
    exec(command, (error) => {
      if (error) {
        console.error("Failed to create desktop shortcut:", error);
      } else {
        console.log("Desktop shortcut created successfully");
      }
    });
  } catch (error) {
    console.error("Error creating desktop shortcut:", error);
  }
}

// Initialize test account
async function initializeTestAccount() {
  try {
    const db = getDb();
    
    // Update existing company name if it's the old Chinese name
    const updateStmt = db.prepare("UPDATE activations SET company_name = 'test', updated_at = CURRENT_TIMESTAMP WHERE company_name = '测试垃圾回收公司'");
    const updateResult = updateStmt.run();
    if (updateResult.changes > 0) {
      console.log(`Updated ${updateResult.changes} activation(s) company name from old name to 'test'`);
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

// Suppress harmless DevTools protocol errors globally
process.on('uncaughtException', (error) => {
  // Filter out known harmless DevTools protocol errors
  if (error.message && (
    error.message.includes('Autofill.enable') ||
    error.message.includes('Autofill.setAddresses') ||
    error.message.includes("wasn't found")
  )) {
    // Suppress these harmless errors
    return;
  }
  // Log other uncaught exceptions
  console.error('Uncaught Exception:', error);
});

// Suppress unhandled promise rejections from DevTools
process.on('unhandledRejection', (reason, promise) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  // Filter out known harmless DevTools protocol errors
  if (errorMessage && (
    errorMessage.includes('Autofill.enable') ||
    errorMessage.includes('Autofill.setAddresses') ||
    errorMessage.includes("wasn't found")
  )) {
    // Suppress these harmless errors
    return;
  }
  // Log other unhandled rejections
  console.warn('Unhandled Rejection:', reason);
});

// Allow multiple instances for testing
// Set ALLOW_MULTIPLE_INSTANCES=true environment variable to enable
const allowMultipleInstances = process.env.ALLOW_MULTIPLE_INSTANCES === 'true';

if (!allowMultipleInstances) {
  // Request single instance lock (default behavior)
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    console.log('Another instance is already running. Exiting...');
    app.quit();
    process.exit(0);
  } else {
    // Handle second instance
    app.on('second-instance', () => {
      // Someone tried to run a second instance, focus our window instead
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
} else {
  console.log('Multiple instances allowed (testing mode)');
}

app.whenReady().then(async () => {
  await createDb();
  await initializeTestAccount();
  // Remove menu bar completely
  Menu.setApplicationMenu(null);
  
  // Create desktop shortcut if it doesn't exist (only in production)
  if (!allowMultipleInstances) {
    ensureDesktopShortcut();
  }
  
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Unregister all shortcuts when app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Handle sync before application close
app.on("before-quit", async (event) => {
  if (isQuitting) {
    return; // Already handled, exit directly
  }

  // Clean up all timers
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  if (networkCheckIntervalId) {
    clearInterval(networkCheckIntervalId);
    networkCheckIntervalId = null;
  }
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
  }

  // If sync service exists and user is logged in, attempt to sync
  if (syncService && currentActivation) {
    try {
      console.log('Application closing, attempting to sync data to cloud...');
      
      // Check network connection
      const isOnline = await syncService.checkNetworkConnection();
      
      if (isOnline) {
        // Prevent default exit behavior
        event.preventDefault();
        isQuitting = true;

        // Show sync notification (if window still exists)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sync:closing-sync', {
            message: 'Syncing data to cloud, please wait...'
          });
        }

        // Execute sync with timeout (10 seconds)
        const syncPromise = syncService.uploadToCloud();
        const timeoutPromise = new Promise((resolve) => {
          setTimeout(() => {
            resolve({ success: false, message: 'Sync timeout' });
          }, 10000); // 10 second timeout
        });

        const result = await Promise.race([syncPromise, timeoutPromise]) as any;
        
        if (result.success) {
          console.log('Data synced successfully before closing');
        } else {
          console.warn('Sync failed or timeout before closing:', result.message);
        }
      } else {
        console.log('Network unavailable, skipping sync on close');
      }
    } catch (error) {
      console.error('Error syncing before close:', error);
    }
  }

  // Clean up and exit
  cleanupAndQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // If all windows are closed, clean up and exit
    if (!isQuitting) {
      cleanupAndQuit();
    }
  }
});

// Global variables to store current user information
let currentUser: any = null;
let currentActivation: any = null;

// IPC handlers
// Authorization related
ipcMain.handle("auth:activateAccount", async (_e, activationCode, username, password) => {
  return await activationManager.activateAccount(activationCode, username, password);
});

ipcMain.handle("auth:verifyPassword", async (_e, username, password) => {
  if (!currentActivation) throw new Error('Not activated');
  
  try {
    const db = getDb();
    const userStmt = db.prepare(`
      SELECT u.* FROM users u 
      WHERE u.username = ? AND u.activation_id = ? AND u.is_active = 1
    `);
    const user = userStmt.get(username, currentActivation.id) as any;
    
    if (!user) {
      return { success: false, message: "User not found" };
    }
    
    const bcrypt = require('bcryptjs');
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    return { 
      success: isPasswordValid, 
      message: isPasswordValid ? "Password verified" : "Incorrect password" 
    };
  } catch (error: any) {
    return { success: false, message: `Password verification failed: ${error.message}` };
  }
});

ipcMain.handle("auth:authenticateUser", async (_e, username, password) => {
  console.log('Received authentication request:', { username, password: '***' });
  
  try {
    const db = getDb();
    
    // First find local user
    const userStmt = db.prepare(`
      SELECT u.*, a.* FROM users u 
      JOIN activations a ON u.activation_id = a.id 
      WHERE u.username = ? AND u.is_active = 1 AND a.is_active = 1
    `);
    let user = userStmt.get(username) as any;
    
    console.log('Found local user:', user ? 'Yes' : 'No');
    
    // If user not found locally, try to authenticate from server and create user
    if (!user) {
      console.log('User not found locally, attempting server authentication...');
      
      try {
        const { LicenseValidationService } = await import('./auth/licenseValidationService');
        const settingsService = new SettingsService(0); // Temporary use, will be updated later
        const settings = await settingsService.getSettings();
        const backupServerUrl = settings.backupServerUrl || 'https://backup-server-1378.azurewebsites.net';
        
        const licenseService = new LicenseValidationService(backupServerUrl);
        const isOnline = await licenseService.checkNetworkConnection();
        
        if (!isOnline) {
          console.log('Network unavailable, cannot authenticate new user from server');
          return { 
            success: false, 
            message: "User does not exist locally. Network connection is required to verify from server. Please check your network connection and try again." 
          };
        }
        
        // Try to authenticate user from server (without activation code, server will find by username)
        console.log('Attempting server authentication without activation code...');
        const serverAuthResult = await licenseService.authenticateUserFromServer(
          username, 
          password, 
          '' // Don't pass activation code, server will find by username
        );
        
        if (serverAuthResult.success && serverAuthResult.user) {
          console.log('Server authentication successful, creating local user...');
          
          // Create user and activation code locally (if not exists)
          const activationCode = serverAuthResult.user.activation_code;
          let localActivation = db.prepare(`
            SELECT * FROM activations WHERE activation_code = ?
          `).get(activationCode) as any;
          
          if (!localActivation) {
            // Create activation code record
            const insertActivation = db.prepare(`
              INSERT INTO activations (
                activation_code, company_name, expires_at, is_active, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?)
            `);
            const activationResult = insertActivation.run(
              activationCode,
              serverAuthResult.user.company_name,
              serverAuthResult.user.expires_at,
              1,
              new Date().toISOString(),
              new Date().toISOString()
            );
            localActivation = {
              id: activationResult.lastInsertRowid,
              activation_code: activationCode,
              company_name: serverAuthResult.user.company_name,
              expires_at: serverAuthResult.user.expires_at,
              is_active: 1
            };
          }
          
          // Create user record
          const bcrypt = require('bcryptjs');
          const passwordHash = await bcrypt.hash(password, 10);
          const insertUser = db.prepare(`
            INSERT INTO users (
              activation_id, username, password_hash, role, is_active, cloud_verified, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          insertUser.run(
            localActivation.id,
            username,
            passwordHash,
            serverAuthResult.user.role || 'admin',
            1,
            1, // Cloud verified
            new Date().toISOString()
          );
          
          // Re-query user
          user = userStmt.get(username) as any;
          console.log('Local user created from server:', user ? 'Yes' : 'No');
        } else {
          console.log('Server authentication failed:', serverAuthResult.message);
          return { 
            success: false, 
            message: serverAuthResult.message || "Unable to verify user from server. Please check username, password and network connection." 
          };
        }
        
        if (!user) {
          console.log('Failed to create local user after server authentication');
          return { success: false, message: "Server verification successful, but failed to create local user" };
        }
      } catch (error) {
        console.error('Server authentication error:', error);
        return { 
          success: false, 
          message: `Server verification error: ${error instanceof Error ? error.message : 'Unknown error'}` 
        };
      }
    }

    // Check if this is first login (cloud verification required)
    // Newly created users have cloud_verified = 0, must pass server verification to login
    const isFirstLogin = !user.last_login;
    const isCloudVerified = user.cloud_verified === 1 || user.cloud_verified === true;
    
    console.log('Login check:', { 
      isFirstLogin, 
      isCloudVerified, 
      lastLogin: user.last_login,
      cloudVerifiedValue: user.cloud_verified
    });
    
    // If user not cloud verified, cloud verification is required (regardless of first login)
    // This ensures newly activated accounts must verify online on first login
    if (!isCloudVerified) {
      console.log('User not cloud verified, cloud verification required');
    }

    // Perform server verification first (if available)
    let serverValidation: { success: boolean; expired?: boolean; expiresAt?: string; message?: string } | null = null;
    let cloudVerificationRequired = false;
    
    try {
      const { LicenseValidationService } = await import('./auth/licenseValidationService');
      const settingsService = new SettingsService(user.activation_id);
      const settings = await settingsService.getSettings();
      const backupServerUrl = settings.backupServerUrl || 'https://backup-server-1378.azurewebsites.net';
      
      const licenseService = new LicenseValidationService(backupServerUrl);
      const isOnline = await licenseService.checkNetworkConnection();
      
      // Users not cloud verified must perform cloud verification (including newly activated accounts)
      // This ensures users must verify online on first login after purchasing account
      if (!isCloudVerified) {
        cloudVerificationRequired = true;
        if (!isOnline) {
          console.log('Cloud verification required, but network is unavailable');
          return { 
            success: false, 
            message: "Account requires network connection for cloud verification. Please check your network connection and try again. This is to ensure account validity and security.",
            requiresCloudVerification: true
          };
        }
      }
      
      if (isOnline) {
        console.log('[Expiration] Network available, validating license from server...');
        serverValidation = await licenseService.validateLicenseFromServer(user.activation_code);
        
        if (serverValidation.success && serverValidation.expiresAt) {
          // If server returns expiration time, always use server time (more authoritative)
          const serverExpiresAt = new Date(serverValidation.expiresAt);
          const localExpiresAt = new Date(user.expires_at);
          
          console.log('[Expiration] Server expires_at:', serverExpiresAt.toISOString());
          console.log('[Expiration] Local expires_at:', localExpiresAt.toISOString());
          
          // Always update local database to keep in sync (even if times match)
          console.log('[Expiration] Updating local database with server expiration time...');
          db.prepare(`
            UPDATE activations 
            SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(serverExpiresAt.toISOString(), user.activation_id);
          
          // 重新查询用户信息，确保获取最新的过期时间
          const updatedUserStmt = db.prepare(`
            SELECT u.*, a.* FROM users u 
            JOIN activations a ON u.activation_id = a.id 
            WHERE u.username = ? AND u.is_active = 1 AND a.is_active = 1
          `);
          const updatedUser = updatedUserStmt.get(username) as any;
          
          if (updatedUser) {
            user.expires_at = updatedUser.expires_at;
            user.expires_at = updatedUser.expires_at;
            // 更新 currentActivation 以确保前端显示正确的过期时间
            currentActivation = updatedUser;
            console.log('[Expiration] Updated expiration time in memory to:', user.expires_at);
            console.log('[Expiration] Updated currentActivation.expires_at to:', currentActivation.expires_at);
            
            // 通知前端更新过期时间显示
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('auth:expiration-updated', {
                expiresAt: user.expires_at
              });
            }
          } else {
            // 如果查询失败，使用服务器返回的时间
            user.expires_at = serverExpiresAt.toISOString();
            console.log('[Expiration] Query failed, using server time:', user.expires_at);
          }
          
          // Check expiration status returned by server (using server time)
          if (serverValidation.expired) {
            console.log('Account expired according to server');
            return { 
              success: false, 
              message: "Account expired, please renew your subscription", 
              expired: true,
              expiresAt: serverExpiresAt.toISOString(),
              activationCode: user.activation_code
            };
          }
          
          // Cloud verification successful, mark user as cloud verified
          if (cloudVerificationRequired || !isCloudVerified) {
            console.log('Cloud verification successful, marking user as verified');
            db.prepare(`
              UPDATE users 
              SET cloud_verified = 1, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(user.id);
            user.cloud_verified = 1;
          }
          
          console.log('Server validation successful, using server expiration time for login check');
        } else if (!serverValidation.success) {
          // If first login and cloud verification failed, don't allow login
          if (cloudVerificationRequired) {
            console.log('First login cloud verification failed:', serverValidation.message);
            return { 
              success: false, 
              message: `Cloud verification failed: ${serverValidation.message || 'Unable to connect to verification server'}. First login must pass cloud verification. Please check your network connection and try again.`,
              requiresCloudVerification: true
            };
          }
          console.log('Server validation failed, falling back to local validation:', serverValidation.message);
        }
      } else {
        // If first login but network unavailable, don't allow login
        if (cloudVerificationRequired) {
          console.log('First login requires cloud verification, but network is unavailable');
          return { 
            success: false, 
            message: "First login requires network connection for cloud verification. Please check your network connection and try again",
            requiresCloudVerification: true
          };
        }
        console.log('Network unavailable, using local validation only (user already cloud verified)');
      }
    } catch (error) {
      // If first login and error occurred, don't allow login
      if (cloudVerificationRequired) {
        console.error('First login cloud verification error:', error);
        return { 
          success: false, 
          message: `Cloud verification error: ${error instanceof Error ? error.message : 'Unknown error'}. First login must pass cloud verification. Please check your network connection and try again.`,
          requiresCloudVerification: true
        };
      }
      console.warn('License validation service error, using local validation:', error);
    }

    // Local validation (as fallback, only used when server validation unavailable)
    // If server validation successful, already checked expiration status, skip local validation
    if (!serverValidation || !serverValidation.success) {
      const now = new Date();
      const expiresAt = new Date(user.expires_at);
      console.log('Using local validation (server validation not available)');
      console.log('Current time:', now.toISOString());
      console.log('Expiration time:', expiresAt.toISOString());
      
      if (now > expiresAt) {
        console.log('Account expired (local check)');
        return { 
          success: false, 
          message: "Account expired, please renew your subscription", 
          expired: true,
          expiresAt: user.expires_at,
          activationCode: user.activation_code // Include activation code for renewal
        };
      }
    } else {
      console.log('Skipping local expiration check (server validation successful)');
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

    // Initialize backup service
    await initializeBackupService();

    // Initialize cloud database service
    await initializeCloudDbService();
    
      // Initialize cloud database service
      await initializeCloudDbService();
      
      // Initialize sync service
      await initializeSyncService();

    // 检查是否是新电脑（数据库为空），如果是则自动同步云端数据
    try {
      const { isDatabaseEmpty, ensureDatabaseSchema } = await import('./db/connection');
      const isEmpty = isDatabaseEmpty(user.activation_id);
      console.log(`[Auto Sync] Database empty check: ${isEmpty} for activation_id: ${user.activation_id}`);
      
      if (isEmpty) {
        console.log('[Auto Sync] Detected new computer (empty database), triggering automatic cloud sync...');
        // 异步执行同步，不阻塞登录流程
        setTimeout(async () => {
          try {
            // 确保数据库结构正确（特别是 updated_at 列）在同步之前
            console.log('[Auto Sync] Ensuring database schema is up to date...');
            await ensureDatabaseSchema();
            
            if (syncService) {
              console.log('[Auto Sync] Starting full sync from cloud...');
              // 新电脑强制全量同步，确保获取所有数据
              const syncResult = await syncService.downloadFromCloud(true);
              console.log('[Auto Sync] Sync result:', JSON.stringify(syncResult, null, 2));
              
              if (syncResult.success) {
                console.log('[Auto Sync] Automatic cloud sync completed successfully');
                console.log(`[Auto Sync] Synced ${syncResult.syncedRecords || 0} records from cloud`);
                
                // 通知前端同步完成，并刷新数据
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('sync:auto-sync-complete', {
                    success: true,
                    message: `Data synchronized from cloud successfully. ${syncResult.syncedRecords || 0} records downloaded. Refreshing data...`,
                    syncedRecords: syncResult.syncedRecords || 0
                  });
                  
                  // 延迟一下再发送刷新命令，确保数据已写入
                  setTimeout(() => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send('sync:refresh-data');
                    }
                  }, 500);
                }
              } else {
                console.error('[Auto Sync] Automatic cloud sync failed:', syncResult.message);
                // 通知前端同步失败
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('sync:auto-sync-complete', {
                    success: false,
                    message: syncResult.message || 'Failed to sync data from cloud. Please try manual sync from Settings.'
                  });
                }
              }
            } else {
              console.error('[Auto Sync] Sync service not initialized');
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('sync:auto-sync-complete', {
                  success: false,
                  message: 'Sync service not initialized. Please try manual sync from Settings.'
                });
              }
            }
          } catch (error) {
            console.error('[Auto Sync] Error during automatic cloud sync:', error);
            // 通知前端同步失败
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('sync:auto-sync-complete', {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error during sync. Please try manual sync from Settings.'
              });
            }
          }
        }, 2000); // 延迟2秒执行，确保登录流程和同步服务初始化完成
      } else {
        console.log('[Auto Sync] Database is not empty, skipping automatic sync');
      }
    } catch (error) {
      console.error('[Auto Sync] Error checking if database is empty:', error);
      // 不阻止登录，即使检查失败也继续
    }

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

ipcMain.handle("auth:renewActivation", async (_e, activationCode) => {
  try {
    const result = await activationManager.renewActivation(activationCode);
    if (result.success) {
      // Update current activation information
      const activation = await activationManager.getActivationByCode(activationCode);
      if (activation && currentActivation && currentActivation.activation_code === activationCode) {
        currentActivation.expires_at = activation.expires_at;
      }

      // Report renewal to server (if available)
      if (activation) {
        try {
          const { LicenseValidationService } = await import('./auth/licenseValidationService');
          const settingsService = new SettingsService(activation.id);
          const settings = await settingsService.getSettings();
          const backupServerUrl = settings.backupServerUrl || 'https://backup-server-1378.azurewebsites.net';
          
          const licenseService = new LicenseValidationService(backupServerUrl);
          const isOnline = await licenseService.checkNetworkConnection();
          
          if (isOnline && activation.expires_at) {
            console.log('Reporting renewal to server...');
            const serverResult = await licenseService.reportRenewalToServer(
              activationCode,
              activation.expires_at,
              undefined // username not available in this context
            );
            if (serverResult.success) {
              console.log('Renewal reported to server successfully');
            } else {
              console.warn('Failed to report renewal to server:', serverResult.message);
            }
          }
        } catch (error) {
          console.warn('Error reporting renewal to server:', error);
          // Server update failure does not affect renewal success
        }
      }
    }
    return result;
  } catch (error: any) {
    return { success: false, message: `Renewal failed: ${error.message}` };
  }
});

ipcMain.handle("auth:activateAccountWithCode", async (_e, username: string, activationCode: string) => {
  try {
    const db = getDb();
    
    // Always use server database for activation
    const { LicenseValidationService } = await import('./auth/licenseValidationService');
    const settingsService = new SettingsService(0);
    const settings = await settingsService.getSettings();
    const backupServerUrl = settings.backupServerUrl || 'https://backup-server-1378.azurewebsites.net';
    
    const licenseService = new LicenseValidationService(backupServerUrl);
    const isOnline = await licenseService.checkNetworkConnection();
    
    if (!isOnline) {
      return { success: false, message: "Cannot connect to server. Please check your network connection." };
    }
    
    // Validate the provided activation code exists and is valid
    console.log('Validating activation code from server...');
    const activationCodeValidation = await licenseService.validateLicenseFromServer(activationCode);
    
    if (!activationCodeValidation.success) {
      return { success: false, message: activationCodeValidation.message || "Activation code does not exist on server" };
    }
    
    // Calculate new expiration date (1 year from current expiration or from now)
    const now = new Date();
    const currentExpiresAt = activationCodeValidation.expiresAt ? new Date(activationCodeValidation.expiresAt) : now;
    // Use the later date: current expiration or now (if expired)
    const baseDate = currentExpiresAt > now ? currentExpiresAt : now;
    const newExpiresAt = new Date(baseDate);
    newExpiresAt.setFullYear(newExpiresAt.getFullYear() + 1);
    
    console.log('Activation calculation:', {
      activationCode,
      currentExpiresAt: currentExpiresAt.toISOString(),
      now: now.toISOString(),
      baseDate: baseDate.toISOString(),
      newExpiresAt: newExpiresAt.toISOString()
    });
    
    // Update the activation code expiration on server
    console.log('Updating activation code expiration on server...');
    const serverResult = await licenseService.reportRenewalToServer(
      activationCode,
      newExpiresAt.toISOString(),
      username
    );
    
    if (!serverResult.success) {
      return { success: false, message: `Failed to update server: ${serverResult.message}` };
    }
    
    // Check if user exists in local database (user has logged in locally before)
    const userStmt = db.prepare(`
      SELECT u.*, a.* FROM users u 
      JOIN activations a ON u.activation_id = a.id 
      WHERE u.username = ? AND u.is_active = 1
    `);
    const localUser = userStmt.get(username) as any;
    
    // If user exists locally and uses the same activation code, update local database too
    if (localUser && localUser.activation_code === activationCode) {
      console.log('User found locally with matching activation code, updating local database...');
      const updateStmt = db.prepare(`
        UPDATE activations 
        SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(newExpiresAt.toISOString(), localUser.activation_id);
      console.log('Local database updated');
    } else {
      console.log('User not found locally or activation code mismatch, only server database updated');
    }

    return { 
      success: true, 
      message: `Account activated successfully! The activation code has been extended until ${newExpiresAt.toLocaleDateString()}` 
    };
  } catch (error: any) {
    console.error('Activate account with code error:', error);
    return { success: false, message: `Activation failed: ${error.message}` };
  }
});

ipcMain.handle("auth:getCurrentUser", () => currentUser);
ipcMain.handle("auth:getCurrentActivation", async () => {
  // 总是从服务器获取最新的过期时间，确保所有客户端显示一致
  if (!currentActivation || !currentUser) {
    return currentActivation;
  }

  try {
    const { LicenseValidationService } = await import('./auth/licenseValidationService');
    const settingsService = new SettingsService(currentActivation.id);
    const settings = await settingsService.getSettings();
    const backupServerUrl = settings.backupServerUrl || 'https://backup-server-1378.azurewebsites.net';
    
    const licenseService = new LicenseValidationService(backupServerUrl);
    const isOnline = await licenseService.checkNetworkConnection();
    
    if (isOnline) {
      console.log('[Activation] Fetching latest expiration time from server...');
      const serverValidation = await licenseService.validateLicenseFromServer(currentActivation.activation_code);
      
      if (serverValidation.success && serverValidation.expiresAt) {
        const serverExpiresAt = new Date(serverValidation.expiresAt);
        const localExpiresAt = currentActivation.expires_at ? new Date(currentActivation.expires_at) : null;
        
        console.log('[Activation] Server expires_at:', serverExpiresAt.toISOString());
        if (localExpiresAt) {
          console.log('[Activation] Local expires_at:', localExpiresAt.toISOString());
        }
        
        // 更新内存中的过期时间
        currentActivation.expires_at = serverExpiresAt.toISOString();
        
        // 更新本地数据库
        const db = getDb();
        db.prepare(`
          UPDATE activations 
          SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(serverExpiresAt.toISOString(), currentActivation.id);
        
        console.log('[Activation] Updated expiration time from server:', serverExpiresAt.toISOString());
        
        // 通知前端更新显示
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:expiration-updated', {
            expiresAt: serverExpiresAt.toISOString()
          });
        }
      } else {
        console.log('[Activation] Server validation failed or no expiration time, using local data');
      }
    } else {
      console.log('[Activation] Network unavailable, using local expiration time');
    }
  } catch (error: any) {
    console.error('[Activation] Error fetching expiration from server:', error);
    // 如果获取失败，使用本地数据
  }
  
  return currentActivation;
});

ipcMain.handle("auth:logout", () => {
  // 停止实时同步
  stopRealtimeSync();
  
  currentUser = null;
  currentActivation = null;
  
  // Clean up scheduled tasks
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  if (networkCheckIntervalId) {
    clearInterval(networkCheckIntervalId);
    networkCheckIntervalId = null;
  }
  if (syncService) {
    syncService.stopLocalSync();
    syncService = null;
  }
  
  return { success: true };
});

// Administrator functions (for creating activation codes for customers)
ipcMain.handle("admin:createActivationCode", async (_e, data) => {
  // Admin permission verification can be added here
  return await activationManager.createActivationCode(data);
});

// Test function: Create test activation code
ipcMain.handle("test:createTestActivationCode", async () => {
  try {
    const result = await activationManager.createActivationCode({
      companyName: 'test',
      contactPerson: 'Test User',
      contactPhone: '13800138000',
      contactEmail: 'test@example.com'
    });
    
    if (result.success) {
      return {
        success: true,
        activationCode: result.activationCode,
        message: 'Test activation code created successfully!\nActivation Code: ' + result.activationCode + '\nPlease use this activation code to activate your account'
      };
    } else {
      return result;
    }
  } catch (error) {
    return {
      success: false,
      message: 'Failed to create test activation code: ' + error
    };
  }
});

ipcMain.handle("admin:renewActivation", async (_e, activationCode) => {
  return await activationManager.renewActivation(activationCode);
});

ipcMain.handle("admin:disableActivation", async (_e, activationCode) => {
  return await activationManager.disableActivation(activationCode);
});

// Customer related (requires activation) - 离线优先架构：先写本地，然后异步同步
ipcMain.handle("customers:create", async (_e, data) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先写本地数据库
  const result = repo.customers.create(currentActivation.id, data);
  const localId = result.lastInsertRowid as number;
  
  // 异步同步到云端（不阻塞）
  if (cloudDbService) {
    syncToCloudAsync('customers', localId, async () => {
      return await cloudDbService.createCustomer(data);
    });
  }
  
  return result;
});

ipcMain.handle("customers:getAll", async () => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.customers.getAll(currentActivation.id);
});

ipcMain.handle("customers:getById", async (_e, id) => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.customers.getById(currentActivation.id, id);
});

ipcMain.handle("customers:search", async (_e, query: string) => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  if (!query || query.trim().length === 0) {
    return repo.customers.getAll(currentActivation.id);
  }
  return repo.customers.search(currentActivation.id, query.trim());
});

ipcMain.handle("customers:getPaginated", async (_e, options: { page: number; pageSize: number; searchQuery?: string }) => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.customers.getPaginated(currentActivation.id, options);
});

ipcMain.handle("customers:update", async (_e, customerId: number, data: any) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先更新本地数据库
  const result = repo.customers.update(currentActivation.id, customerId, data);
  
  // 标记为未同步
  try {
    const db = getDb();
    db.prepare(`UPDATE customers SET is_synced = 0 WHERE id = ?`).run(customerId);
  } catch (error: any) {
    // 如果 is_synced 列不存在，忽略错误
    if (!error.message?.includes('no such column')) {
      console.error('[Sync] Failed to mark customer as unsynced:', error);
    }
  }
  
  // 异步同步到云端
  if (cloudDbService) {
    syncToCloudAsync('customers', customerId, async () => {
      return await cloudDbService.updateCustomer(customerId, data);
    });
  }
  
  return result;
});

// Waste type related (requires activation)
ipcMain.handle("wasteTypes:getAll", () => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.wasteTypes.getAll(currentActivation.id);
});

ipcMain.handle("wasteTypes:getById", (_e, id) => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.wasteTypes.getById(currentActivation.id, id);
});

// Weighing session related (requires activation) - 离线优先架构：先写本地，然后异步同步
ipcMain.handle("weighingSessions:create", async (_e, data) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先写本地数据库
  const result = repo.weighingSessions.create(currentActivation.id, data);
  const localId = result.lastInsertRowid as number;
  
  // 异步同步到云端（不阻塞）
  if (cloudDbService) {
    syncToCloudAsync('weighing_sessions', localId, async () => {
      return await cloudDbService.createSession(data);
    });
  }
  
  return result;
});

ipcMain.handle("weighingSessions:updateTotal", async (_e, sessionId, totalAmount) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先更新本地数据库
  const result = repo.weighingSessions.updateTotal(currentActivation.id, sessionId, totalAmount);
  
  // 标记为未同步
  try {
    const db = getDb();
    db.prepare(`UPDATE weighing_sessions SET is_synced = 0 WHERE id = ?`).run(sessionId);
  } catch (error: any) {
    if (!error.message?.includes('no such column')) {
      console.error('[Sync] Failed to mark session as unsynced:', error);
    }
  }
  
  // 异步同步到云端
  if (cloudDbService) {
    syncToCloudAsync('weighing_sessions', sessionId, async () => {
      return await cloudDbService.updateSession(sessionId, { total_amount: totalAmount });
    });
  }
  
  return result;
});

ipcMain.handle("weighingSessions:update", async (_e, sessionId, data) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先更新本地数据库
  const result = repo.weighingSessions.update(currentActivation.id, sessionId, data);
  
  // 标记为未同步
  try {
    const db = getDb();
    db.prepare(`UPDATE weighing_sessions SET is_synced = 0 WHERE id = ?`).run(sessionId);
  } catch (error: any) {
    if (!error.message?.includes('no such column')) {
      console.error('[Sync] Failed to mark session as unsynced:', error);
    }
  }
  
  // 异步同步到云端
  if (cloudDbService) {
    syncToCloudAsync('weighing_sessions', sessionId, async () => {
      return await cloudDbService.updateSession(sessionId, data);
    });
  }
  
  return result;
});

ipcMain.handle("weighingSessions:getById", async (_e, id) => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.weighingSessions.getById(currentActivation.id, id);
});

ipcMain.handle("weighingSessions:getUnfinishedCount", async () => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.weighingSessions.getUnfinishedCount(currentActivation.id);
});

ipcMain.handle("weighingSessions:delete", async (_e, sessionId) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先删除本地数据库
  // 先删除该session的所有weighings（因为有外键约束）
  repo.weighings.deleteBySession(currentActivation.id, sessionId);
  // 然后删除session
  const result = repo.weighingSessions.delete(currentActivation.id, sessionId);
  
  // 异步从云端删除（不阻塞）
  if (cloudDbService) {
    (async () => {
      try {
        await cloudDbService.deleteSession(sessionId);
      } catch (error) {
        console.error('[Sync] Failed to delete session from cloud:', error);
      }
    })();
  }
  
  return result;
});

ipcMain.handle("weighingSessions:deleteAll", () => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.weighingSessions.deleteAll(currentActivation.id);
});

// Weighing record related (requires activation) - 离线优先架构：先写本地，然后异步同步
ipcMain.handle("weighings:create", async (_e, data) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 验证必需字段
  if (!data.session_id || data.weight === undefined || data.unit_price === undefined || data.total_amount === undefined) {
    throw new Error('session_id, weight, unit_price, and total_amount are required');
  }
  
  // 先写本地数据库
  const result = repo.weighings.create(currentActivation.id, data);
  const localId = result.lastInsertRowid as number;
  
  // 异步同步到云端（不阻塞）
  if (cloudDbService) {
    syncToCloudAsync('weighings', localId, async () => {
      return await cloudDbService.createWeighing(data);
    });
  }
  
  return result;
});

ipcMain.handle("weighings:getBySession", async (_e, sessionId) => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.weighings.getBySession(currentActivation.id, sessionId);
});

ipcMain.handle("weighings:deleteBySession", async (_e, sessionId) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先删除本地数据库
  const result = repo.weighings.deleteBySession(currentActivation.id, sessionId);
  
  // 异步从云端删除（不阻塞）
  if (cloudDbService) {
    (async () => {
      try {
        await cloudDbService.deleteWeighingsBySession(sessionId);
      } catch (error) {
        console.error('[Sync] Failed to delete weighings from cloud:', error);
      }
    })();
  }
  
  return result;
});

ipcMain.handle("weighings:getAll", async () => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.weighings.getAll(currentActivation.id);
});

ipcMain.handle("weighings:getById", (_e, id) => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.weighings.getById(currentActivation.id, id);
});

ipcMain.handle("weighings:getPaginated", async (_e, options) => {
  if (!currentActivation) throw new Error('Not activated');
  // 注意：weighings.getPaginated 实际上返回的是 weighing_sessions 数据
  // 这是 Records 页面使用的分页查询
  // 离线优先：优先读本地数据库
  return repo.weighings.getPaginated(currentActivation.id, options);
});

// Vehicle related (requires activation)
ipcMain.handle("vehicles:getAll", () => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.vehicles.getAll(currentActivation.id);
});

ipcMain.handle("vehicles:getById", (_e, id) => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.vehicles.getById(currentActivation.id, id);
});

ipcMain.handle("vehicles:getByCustomerId", (_e, customerId: number) => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.vehicles.getByCustomerId(currentActivation.id, customerId);
});

ipcMain.handle("vehicles:create", async (_e, data: any) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先写本地数据库
  const result = repo.vehicles.create(currentActivation.id, data);
  const localId = result.lastInsertRowid as number;
  
  // 标记为未同步（vehicles 的同步通过 syncService 的批量同步处理）
  try {
    const db = getDb();
    db.prepare(`UPDATE vehicles SET is_synced = 0 WHERE id = ?`).run(localId);
  } catch (error: any) {
    if (!error.message?.includes('no such column')) {
      console.error('[Sync] Failed to mark vehicle as unsynced:', error);
    }
  }
  
  return result;
});

// Import function
ipcMain.handle("import:selectFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Import File',
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

// Select image file
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
  if (!currentActivation) throw new Error('Not activated');
  
  // 如果云端数据库服务可用，使用它；否则使用本地数据库
  const importService = new ImportService(currentActivation.id, cloudDbService || undefined);
  return await importService.importCustomers(filePath, (progress) => {
    // Send progress update event
    if (mainWindow) {
      mainWindow.webContents.send('import:progress', progress);
    }
  });
});

ipcMain.handle("import:importVehicles", async (event, filePath) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 如果云端数据库服务可用，使用它；否则使用本地数据库
  const importService = new ImportService(currentActivation.id, cloudDbService || undefined);
  return await importService.importVehicles(filePath, (progress) => {
    // Send progress update event
    if (mainWindow) {
      mainWindow.webContents.send('import:progress', progress);
    }
  });
});

// Biometric related
ipcMain.handle("biometric:getByCustomerId", (_e, customerId) => {
  if (!currentActivation) throw new Error('Not activated');
  return repo.biometricData.getByCustomerId(currentActivation.id, customerId);
});

// Read image file and return base64 data URL
ipcMain.handle("image:readFile", async (_e, filePath: string) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    
    const fileData = fs.readFileSync(filePath);
    const base64 = fileData.toString('base64');
    // Determine MIME type based on file extension
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
  if (!currentActivation) throw new Error('Not activated');
  return repo.biometricData.getAll(currentActivation.id);
});

ipcMain.handle("biometric:saveFaceImage", async (_e, customerId, imageData) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const biometricService = new BiometricService(currentActivation.id);
  return await biometricService.saveFaceImage(customerId, Buffer.from(imageData));
});

ipcMain.handle("biometric:saveFingerprint", async (_e, customerId, template, imageData) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const biometricService = new BiometricService(currentActivation.id);
  return await biometricService.saveFingerprintData(
    customerId, 
    Buffer.from(template), 
    imageData ? Buffer.from(imageData) : undefined
  );
});

ipcMain.handle("biometric:saveSignatureImage", async (_e, customerId, imageData) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const biometricService = new BiometricService(currentActivation.id);
  return await biometricService.saveSignatureImage(customerId, Buffer.from(imageData));
});

// Driver license photo related
ipcMain.handle("license:savePhoto", async (_e, customerId, imageData) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const biometricService = new BiometricService(currentActivation.id);
  
  // If customerId is temporary ID (greater than 1000000000000, i.e., Date.now() range), only save file
  // Otherwise save to database normally
  if (customerId > 1000000000000) {
    // Temporary photo, only save file
    return await biometricService.saveTemporaryPhoto(Buffer.from(imageData));
  } else {
    // Normal save, includes database operation
    return await biometricService.saveFaceImage(customerId, Buffer.from(imageData));
  }
});

// Camera related
ipcMain.handle("camera:start", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const cameraService = new CameraService(mainWindow);
  return await cameraService.startCamera();
});

ipcMain.handle("camera:stop", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const cameraService = new CameraService(mainWindow);
  await cameraService.stopCamera();
});

ipcMain.handle("camera:capture", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const cameraService = new CameraService(mainWindow);
  return await cameraService.capturePhoto();
});


ipcMain.handle("camera:getDevices", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const cameraService = new CameraService(mainWindow);
  return await cameraService.getCameraDevices();
});

// Fingerprint device related
// Global fingerprint service instance
let fingerprintServiceInstance: FingerprintService | null = null;

ipcMain.handle("fingerprint:init", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.initializeFingerprint();
});

ipcMain.handle("fingerprint:startCapture", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.startFingerprintCapture();
});

ipcMain.handle("fingerprint:stopCapture", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  if (!fingerprintServiceInstance) {
    return;
  }
  
  await fingerprintServiceInstance.stopFingerprintCapture();
});

ipcMain.handle("fingerprint:capture", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.captureFingerprint();
});


ipcMain.handle("fingerprint:verify", async (_e, template) => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  if (!fingerprintServiceInstance) {
    fingerprintServiceInstance = new FingerprintService(mainWindow);
  }
  
  return await fingerprintServiceInstance.verifyFingerprint(Buffer.from(template));
});

ipcMain.handle("fingerprint:getStatus", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  if (!fingerprintServiceInstance) {
    return 'Not initialized';
  }
  
  return await fingerprintServiceInstance.getFingerprintStatus();
});

// List all USB devices (for debugging and detection)
ipcMain.handle("fingerprint:listAllUsbDevices", async () => {
  const { FingerprintHardware } = await import('./fingerprint/fingerprintHardware');
  return await FingerprintHardware.listAllUsbDevices();
});

// Signature pad related
ipcMain.handle("tablet:init", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.initializeTablet();
});

ipcMain.handle("tablet:startCapture", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.startSignatureCapture();
});

ipcMain.handle("tablet:stopCapture", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const tabletService = new TabletService(mainWindow);
  await tabletService.stopSignatureCapture();
});

ipcMain.handle("tablet:capture", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.captureSignature();
});

ipcMain.handle("tablet:getStatus", async () => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  const tabletService = new TabletService(mainWindow);
  return await tabletService.getTabletStatus();
});

// Mouse lock function (to limit mouse range when signing)
// Use Windows API ClipCursor to lock mouse
let cursorLocked = false;

ipcMain.handle("tablet:lockCursor", async (_e, bounds: { x: number, y: number, width: number, height: number }) => {
  if (!mainWindow) throw new Error('Main window not initialized');
  
  try {
    // Get main window position
    const windowBounds = mainWindow.getBounds();
    
    // Calculate screen coordinates (considering window position)
    const screenX = Math.round(windowBounds.x + bounds.x);
    const screenY = Math.round(windowBounds.y + bounds.y);
    const screenRight = Math.round(screenX + bounds.width);
    const screenBottom = Math.round(screenY + bounds.height);
    
    // Use Windows API to lock mouse on Windows
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      try {
        // Use PowerShell to call Windows API ClipCursor
        // Create a temporary C# script to call Windows API
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
        
        // Write PowerShell script to temporary file to avoid escaping issues
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const tempFile = path.join(os.tmpdir(), `cursor-lock-${Date.now()}.ps1`);
        fs.writeFileSync(tempFile, psScript, 'utf8');
        
        try {
          const command = `powershell -ExecutionPolicy Bypass -File "${tempFile}"`;
          const { stdout } = await execAsync(command, { timeout: 5000 });
          
          // Clean up temporary file
          try {
            fs.unlinkSync(tempFile);
          } catch (e) {
            // Ignore cleanup errors
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

// Settings related
ipcMain.handle("settings:getSettings", async () => {
  if (!currentActivation) throw new Error('Not activated');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.getSettings();
});

ipcMain.handle("settings:saveSettings", async (_e, settings) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.saveSettings(settings);
});

ipcMain.handle("settings:getDevices", async (_event, deviceType?: string) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const settingsService = new SettingsService(currentActivation.id, mainWindow);
  return await settingsService.getDevices(deviceType as any);
});

ipcMain.handle("settings:testDevice", async (_e, deviceId, type) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.testDevice(deviceId, type);
});

// Update related
const updateService = new UpdateService(); // Can pass custom update server URL, e.g.: new UpdateService('https://your-update-server.com/api/check-update')

// Set download progress callback
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

// Backup related
let backupService: BackupService | null = null;
let backupIntervalId: NodeJS.Timeout | null = null;

// 同步相关
let syncService: SyncService | null = null;
let syncIntervalId: NodeJS.Timeout | null = null;
let realtimeSyncIntervalId: NodeJS.Timeout | null = null;
let lastRealtimeSyncTime: number = 0;
let networkCheckIntervalId: NodeJS.Timeout | null = null;
let lastNetworkStatus: boolean = false;
let pendingMismatchCheck: boolean = false;
let wsClient: any = null; // WebSocket client

// Clean up resources and exit application
function cleanupAndQuit() {
  console.log('Cleaning up resources and quitting application...');
  
  // Clean up all timers
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  if (networkCheckIntervalId) {
    clearInterval(networkCheckIntervalId);
    networkCheckIntervalId = null;
  }
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
  }

  // Stop sync service
  if (syncService) {
    try {
      syncService.stopLocalSync();
    } catch (error) {
      console.error('Error stopping sync service:', error);
    }
  }

  // Mark as quitting
  isQuitting = true;

  // Destroy window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  // Exit application
  if (process.platform !== "darwin") {
    app.quit();
  }
}

// Initialize backup service
async function initializeBackupService() {
  if (currentActivation) {
    const settingsService = new SettingsService(currentActivation.id);
    const settings = await settingsService.getSettings();
    const backupServerUrl = settings.backupServerUrl;
    
    backupService = new BackupService(currentActivation.id, backupServerUrl);
    
    // Set progress callback
    backupService.setProgressCallback((progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('backup:progress', progress);
      }
    });

    // Set automatic backup scheduled task
    setupAutoBackup(settings);
  }
}

// 云端数据库服务实例
let cloudDbService: any = null;

/**
 * 异步同步单个记录到云端（不阻塞主流程）
 * 成功后更新本地记录的 is_synced 和 cloud_id
 */
async function syncToCloudAsync(table: string, localId: number, syncFn: () => Promise<any>): Promise<void> {
  if (!cloudDbService) {
    return; // 没有云端服务，跳过同步
  }
  
  // 异步执行，不阻塞
  (async () => {
    try {
      const cloudResult = await syncFn();
      if (cloudResult && cloudResult.id) {
        // 更新本地记录的同步状态
        const db = getDb();
        try {
          db.prepare(`
            UPDATE ${table} 
            SET is_synced = 1, cloud_id = ? 
            WHERE id = ?
          `).run(cloudResult.id, localId);
        } catch (error: any) {
          // 如果 is_synced 列不存在，忽略错误（兼容旧数据库）
          if (!error.message?.includes('no such column')) {
            console.error(`[Sync] Failed to update sync status for ${table}:${localId}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`[Sync] Failed to sync ${table}:${localId} to cloud:`, error);
      // 同步失败不影响主流程，数据保留在本地，稍后重试
    }
  })();
}

// Initialize cloud database service
async function initializeCloudDbService() {
  if (currentActivation) {
    try {
      const settingsService = new SettingsService(currentActivation.id);
      const settings = await settingsService.getSettings();
      const backupServerUrl = settings.backupServerUrl;
      
      if (backupServerUrl) {
        const { CloudDbService } = await import('./db/cloudDbService');
        cloudDbService = new CloudDbService(backupServerUrl, currentActivation.id);
        console.log('[Cloud DB] Cloud database service initialized');
        
        // Initialize WebSocket connection
        await initializeWebSocket(backupServerUrl, currentActivation.id);
      } else {
        console.warn('[Cloud DB] WARNING: Backup server URL not configured. Cloud database will not work.');
      }
    } catch (error) {
      console.error('[Cloud DB] Error initializing cloud database service:', error);
    }
  }
}

// Initialize WebSocket connection for real-time updates
async function initializeWebSocket(serverUrl: string, activationId: number) {
  try {
    // Close existing connection if any
    if (wsClient) {
      wsClient.close();
      wsClient = null;
    }

    // Convert HTTP URL to WebSocket URL
    let wsUrl: string;
    try {
      const url = new URL(serverUrl);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/ws?activationId=${activationId}`;
    } catch (error) {
      console.error('[WebSocket] Invalid server URL:', error);
      return;
    }

    console.log(`[WebSocket] Connecting to ${wsUrl}...`);
    
    // Import WebSocket library
    // Note: bufferutil and utf-8-validate are optional dependencies of ws
    // They will be automatically loaded by ws if available, no need to import them explicitly
    // This avoids build-time resolution issues with Vite/Rollup
    
    // @ts-ignore - ws module types may not be available during build
    const WebSocket = (await import('ws')).default || (await import('ws'));
    
    wsClient = new WebSocket(wsUrl);
    
    wsClient.on('open', () => {
      console.log('[WebSocket] Connected successfully');
    });
    
    wsClient.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('[WebSocket] Received message:', message.type);
        
        // Handle different message types
        switch (message.type) {
          case 'connected':
            console.log('[WebSocket] Connection confirmed:', message.message);
            break;
            
          case 'new_session':
          case 'updated_session':
          case 'deleted_session':
            console.log(`[WebSocket] Session ${message.type}: sessionId=${message.sessionId}`);
            // Trigger sync to get updated session data
            if (syncService) {
              try {
                await syncService.downloadFromCloud();
                console.log('[WebSocket] Synced session data after WebSocket notification');
              } catch (error) {
                console.error('[WebSocket] Failed to sync after session notification:', error);
              }
            }
            break;
            
          case 'new_weighing':
          case 'deleted_weighings':
            console.log(`[WebSocket] Weighing ${message.type}: sessionId=${message.sessionId}`);
            // Trigger sync to get updated weighing data
            if (syncService) {
              try {
                await syncService.downloadFromCloud();
                console.log('[WebSocket] Synced weighing data after WebSocket notification');
              } catch (error) {
                console.error('[WebSocket] Failed to sync after weighing notification:', error);
              }
            }
            break;
            
          case 'new_customer':
          case 'updated_customer':
            console.log(`[WebSocket] Customer ${message.type}: customerId=${message.customerId}`);
            // Trigger sync to get updated customer data
            if (syncService) {
              try {
                await syncService.downloadFromCloud();
                console.log('[WebSocket] Synced customer data after WebSocket notification');
              } catch (error) {
                console.error('[WebSocket] Failed to sync after customer notification:', error);
              }
            }
            break;
            
          case 'new_metal_type':
          case 'updated_metal_type':
            console.log(`[WebSocket] Metal type ${message.type}: metalTypeId=${message.metalTypeId}`);
            // Trigger sync to get updated metal type data
            if (syncService) {
              try {
                await syncService.downloadFromCloud();
                console.log('[WebSocket] Synced metal type data after WebSocket notification');
              } catch (error) {
                console.error('[WebSocket] Failed to sync after metal type notification:', error);
              }
            }
            break;
            
          default:
            console.log('[WebSocket] Unknown message type:', message.type);
        }
      } catch (error) {
        console.error('[WebSocket] Error parsing message:', error);
      }
    });
    
    wsClient.on('error', (error: Error) => {
      console.error('[WebSocket] Connection error:', error);
    });
    
    wsClient.on('close', (code: number, reason: Buffer) => {
      console.log(`[WebSocket] Connection closed: code=${code}, reason=${reason.toString()}`);
      wsClient = null;
      
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (currentActivation) {
          console.log('[WebSocket] Attempting to reconnect...');
          initializeWebSocket(serverUrl, currentActivation.id).catch(err => {
            console.error('[WebSocket] Reconnection failed:', err);
          });
        }
      }, 5000);
    });
    
  } catch (error) {
    console.error('[WebSocket] Error initializing WebSocket connection:', error);
  }
}

// Initialize sync service
async function initializeSyncService() {
  if (currentActivation) {
    try {
      console.log(`[Sync Init] Initializing sync service for activationId: ${currentActivation.id}`);
      const settingsService = new SettingsService(currentActivation.id);
      const settings = await settingsService.getSettings();
      const backupServerUrl = settings.backupServerUrl;
      
      console.log(`[Sync Init] Backup server URL: ${backupServerUrl || 'NOT CONFIGURED'}`);
      
      if (!backupServerUrl) {
        console.warn('[Sync Init] WARNING: Backup server URL is not configured. Cloud sync will not work.');
      }
      
      // Get instance ID from environment variable for multi-instance testing
      const instanceId = process.env.INSTANCE_ID ? parseInt(process.env.INSTANCE_ID) : undefined;
      if (instanceId !== undefined) {
        console.log(`[Sync Init] Running as instance ${instanceId} (for testing)`);
      }
      
      syncService = new SyncService(currentActivation.id, backupServerUrl, instanceId);
      console.log('[Sync Init] Sync service created successfully');
      
      // Set progress callback
      syncService.setProgressCallback((progress) => {
        if (mainWindow) {
          mainWindow.webContents.send('sync:progress', progress);
        }
      });

      // Start LAN sync service (failure does not affect login)
      try {
        await syncService.startLocalSync();
      } catch (error) {
        console.warn('Failed to start local sync service:', error);
        // Continue execution, don't block login
      }

      // Set automatic sync (once per hour)
      setupAutoSync();

      // Set network status listener
      setupNetworkMonitoring();
    } catch (error) {
      console.error('Error initializing sync service:', error);
      // Don't block login, just sync feature unavailable
    }
  }
}

// 设置自动同步（定期同步未同步的数据）
function setupAutoSync() {
  // 清除现有定时任务
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  if (realtimeSyncIntervalId) {
    clearInterval(realtimeSyncIntervalId);
    realtimeSyncIntervalId = null;
  }

  if (!syncService || !currentActivation) {
    return;
  }

  // 定期同步未同步的数据到云端（每5分钟）
  syncIntervalId = setInterval(async () => {
    if (!syncService || !currentActivation) {
      return;
    }
    
    try {
      // 检查网络连接
      const isOnline = await syncService.checkNetworkConnection();
      if (!isOnline) {
        console.log('[Auto Sync] Network unavailable, skipping sync');
        return;
      }
      
      // 同步未同步的数据到云端
      console.log('[Auto Sync] Starting background sync...');
      await syncService.uploadToCloud();
      console.log('[Auto Sync] Background sync completed');
    } catch (error) {
      console.error('[Auto Sync] Background sync failed:', error);
      // 不抛出错误，继续运行
    }
  }, 5 * 60 * 1000); // 每5分钟同步一次

  // Check data mismatch immediately after login (check once)
  checkDataMismatchOnLogin();

  // 启动实时同步（每30秒检查一次是否有新数据）
  startRealtimeSync();

  console.log('[Auto Sync] Background sync enabled: uploading unsynced data every 5 minutes');
  console.log('[Auto Sync] Realtime sync enabled: checking for updates every 30 seconds');
}

// 启动实时同步
function startRealtimeSync() {
  if (!syncService || !currentActivation) {
    return;
  }

  // 清除现有定时器
  if (realtimeSyncIntervalId) {
    clearInterval(realtimeSyncIntervalId);
  }

  // 每30秒检查一次是否有新数据
  realtimeSyncIntervalId = setInterval(async () => {
    if (!syncService || !currentActivation) {
      return;
    }

    try {
      const isOnline = await syncService.checkNetworkConnection();
      if (!isOnline) {
        return; // 网络不可用，跳过
      }

      // 检查是否有新数据（通过比较哈希）
      const mismatch = await syncService.checkDataMismatch();
      
      if (mismatch.mismatched && mismatch.cloudHash) {
        // 有新数据，自动下载
        console.log('[Realtime Sync] New data detected, auto-downloading...');
        const now = Date.now();
        
        // 避免频繁同步（至少间隔10秒）
        if (now - lastRealtimeSyncTime < 10000) {
          console.log('[Realtime Sync] Too soon since last sync, skipping...');
          return;
        }
        
        lastRealtimeSyncTime = now;
        
        // 静默下载新数据（不显示进度条，后台执行）
        syncService.downloadFromCloud(false).then((result) => {
          if (result.success) {
            console.log(`[Realtime Sync] Auto-synced ${result.syncedRecords || 0} records`);
            // 通知前端刷新数据
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('sync:refresh-data');
            }
          } else {
            console.log('[Realtime Sync] Auto-sync failed:', result.message);
          }
        }).catch((error) => {
          console.error('[Realtime Sync] Auto-sync error:', error);
        });
      }
    } catch (error) {
      console.error('[Realtime Sync] Error checking for updates:', error);
    }
  }, 30000); // 每30秒检查一次
}

// 停止实时同步
function stopRealtimeSync() {
  if (realtimeSyncIntervalId) {
    clearInterval(realtimeSyncIntervalId);
    realtimeSyncIntervalId = null;
    console.log('Realtime sync stopped');
  }
}

// Check data mismatch after login
async function checkDataMismatchOnLogin() {
  if (!syncService || !currentActivation || !mainWindow) {
    return;
  }

  try {
    // Delay 5 seconds before checking to ensure service is fully initialized and backup is complete
    setTimeout(async () => {
      try {
        // 如果刚刚完成备份（5分钟内），跳过不匹配检查
        const now = Date.now();
        const timeSinceLastBackup = now - lastBackupTime;
        const fiveMinutes = 5 * 60 * 1000;
        
        if (lastBackupTime > 0 && timeSinceLastBackup < fiveMinutes) {
          console.log(`[Mismatch Check] Recently backed up (${Math.round(timeSinceLastBackup / 1000)} seconds ago), skipping mismatch check to avoid false positive`);
          return;
        }
        
        const isOnline = await syncService!.checkNetworkConnection();
        if (isOnline) {
          console.log('Network available, checking data mismatch on login...');
          
          const mismatch = await syncService!.checkDataMismatch();
          if (mismatch.mismatched) {
            console.log('Data mismatch detected on login (user can manually sync if needed)');
          } else {
            console.log('Data is in sync with cloud');
          }
        } else {
          console.log('Network unavailable, skipping data mismatch check');
        }
      } catch (error) {
        console.error('Error checking data mismatch on login:', error);
      }
    }, 5000);
  } catch (error) {
    console.error('Error in checkDataMismatchOnLogin:', error);
  }
}

// 设置网络状态监听
function setupNetworkMonitoring() {
  // 清除现有定时任务
  if (networkCheckIntervalId) {
    clearInterval(networkCheckIntervalId);
    networkCheckIntervalId = null;
  }

  if (!syncService || !currentActivation) {
    return;
  }

  // 每30秒检查一次网络状态
  const checkInterval = 30 * 1000; // 30秒

  // 立即检查一次
  checkNetworkStatus();

  // Set scheduled check
  networkCheckIntervalId = setInterval(() => {
    checkNetworkStatus();
  }, checkInterval);

  console.log('Network monitoring enabled: checking every 30 seconds');
}

// Check network status
async function checkNetworkStatus() {
  if (!syncService || !currentActivation || !mainWindow) {
    return;
  }

  try {
    const isOnline = await syncService.checkNetworkConnection();
    
    // If network changed from offline to online, sync unsynced data and check data mismatch
    if (isOnline && !lastNetworkStatus && !pendingMismatchCheck) {
      // 网络恢复，先同步未同步的数据到云端
      console.log('[Network Restored] Syncing unsynced data to cloud...');
      (async () => {
        try {
          await syncService.uploadToCloud();
          console.log('[Network Restored] Unsynced data synced successfully');
        } catch (error) {
          console.error('[Network Restored] Failed to sync unsynced data:', error);
        }
      })();
      
      // 如果刚刚完成备份（5分钟内），跳过不匹配检查
      const now = Date.now();
      const timeSinceLastBackup = now - lastBackupTime;
      const fiveMinutes = 5 * 60 * 1000;
      
      if (lastBackupTime > 0 && timeSinceLastBackup < fiveMinutes) {
        console.log(`[Mismatch Check] Recently backed up (${Math.round(timeSinceLastBackup / 1000)} seconds ago), skipping mismatch check`);
        lastNetworkStatus = isOnline;
        return;
      }
      
      pendingMismatchCheck = true;
      console.log('Network restored, checking for data mismatch...');
      
      // Delay 5 seconds before checking to ensure network is stable and backup is complete
      setTimeout(async () => {
        try {
          // 再次检查是否刚刚完成备份（可能在延迟期间完成了备份）
          const now = Date.now();
          const timeSinceLastBackup = now - lastBackupTime;
          const fiveMinutes = 5 * 60 * 1000;
          
          if (lastBackupTime > 0 && timeSinceLastBackup < fiveMinutes) {
            console.log(`[Mismatch Check] Recently backed up (${Math.round(timeSinceLastBackup / 1000)} seconds ago), skipping mismatch check`);
            pendingMismatchCheck = false;
            return;
          }
          
          const mismatch = await syncService!.checkDataMismatch();
          if (mismatch.mismatched) {
            console.log('Data mismatch detected after network restore (user can manually sync if needed)');
          }
        } catch (error) {
          console.error('Error checking data mismatch:', error);
        } finally {
          pendingMismatchCheck = false;
        }
      }, 5000);
    }

    lastNetworkStatus = isOnline;
  } catch (error) {
    console.error('Error checking network status:', error);
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

// Track last backup time to suppress mismatch checks
let lastBackupTime: number = 0;

// Check network and execute backup
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
      // 记录备份完成时间，用于跳过后续的不匹配检查
      lastBackupTime = Date.now();
      console.log('[Backup] Recorded backup time to suppress mismatch checks');
    } else {
      console.log('Network unavailable, skipping backup');
    }
  } catch (error) {
    console.error('Auto backup failed:', error);
  }
}

// Initialize backup service after user login (via authenticateUser handler)
// Note: This will be automatically called after user successfully logs in

ipcMain.handle("backup:performBackup", async () => {
  if (!currentActivation) throw new Error('Not activated');
  if (!backupService) {
    await initializeBackupService();
  }
  if (!backupService) throw new Error('Backup service not initialized');
  
  const result = await backupService.performBackup();
  // 记录备份完成时间，用于跳过后续的不匹配检查
  if (result.success) {
    lastBackupTime = Date.now();
    console.log('[Backup] Recorded backup time to suppress mismatch checks');
  }
  return result;
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
  
  // Update backup service configuration
  if (backupService) {
    backupService.setBackupServerUrl(backupServerUrl);
  } else {
    await initializeBackupService();
  }

  // 更新云端数据库服务配置
  await initializeCloudDbService();
  
  // 更新同步服务配置
  if (syncService) {
    // 重新初始化同步服务以更新配置
    syncService.stopLocalSync();
    await initializeSyncService();
  }

  // Update settings and re-set automatic backup
  const settingsService = new SettingsService(currentActivation.id);
  const settings = await settingsService.getSettings();
  settings.backupServerUrl = backupServerUrl;
  await settingsService.saveSettings(settings);
  setupAutoBackup(settings);
});

// Sync related IPC handlers
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

ipcMain.handle("sync:checkDataMismatch", async () => {
  if (!syncService) throw new Error('Sync service not initialized');
  return await syncService.checkDataMismatch();
});

ipcMain.handle("sync:uploadToCloud", async () => {
  if (!syncService) throw new Error('Sync service not initialized');
  return await syncService.uploadToCloud();
});

ipcMain.handle("sync:downloadFromCloud", async (_e, forceFullSync: boolean = false) => {
  if (!syncService) throw new Error('Sync service not initialized');
  return await syncService.downloadFromCloud(forceFullSync);
});

ipcMain.handle("sync:checkNetwork", async () => {
  if (!syncService) {
    if (!currentActivation) return false;
    await initializeCloudDbService();
    await initializeSyncService();
  }
  if (!syncService) return false;
  return await syncService.checkNetworkConnection();
});

ipcMain.handle("settings:resetSettings", async () => {
  if (!currentActivation) throw new Error('Not activated');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.resetSettings();
});

ipcMain.handle("settings:exportSettings", async () => {
  if (!currentActivation) throw new Error('Not activated');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.exportSettings();
});

ipcMain.handle("settings:importSettings", async (_e, settingsJson) => {
  if (!currentActivation) throw new Error('Not activated');
  
  const settingsService = new SettingsService(currentActivation.id);
  return await settingsService.importSettings(settingsJson);
});

// Inventory Summary Report related
ipcMain.handle("report:generateInventoryReport", async (_e, startDate: string, endDate: string) => {
  if (!currentActivation) throw new Error('Not activated');
  
  try {
    // 获取公司名字：优先从设置中获取，如果没有则使用激活信息中的公司名字
    const { SettingsService } = await import('./settings/settingsService');
    const settingsService = new SettingsService(currentActivation.id);
    const settings = await settingsService.getSettings();
    const companyName = settings.companyName || currentActivation.company_name;
    
    const reportService = new InventoryReportService(currentActivation.id);
    const filePath = await reportService.generateReport(startDate, endDate, companyName);
    
    // Open PDF in new window within application
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
    throw new Error(`Failed to generate report: ${error.message}`);
  }
});

// Police Report related
ipcMain.handle("report:generatePoliceReport", async (_e, sessionId: number) => {
  if (!currentActivation) throw new Error('Not activated');
  
  try {
    const reportService = new PoliceReportService(currentActivation.id);
    const filePath = await reportService.generateReport(sessionId);
    
    // Open PDF in new window within application
    const pdfWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      title: `Police Report - Session #${sessionId}`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true, // Enable plugins to support PDF display
      }
    });
    
    // Use file:// protocol to directly load PDF file
    // Electron's webContents can display PDF if system has PDF plugin installed
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
        // Can add more detailed error message here
      }
    });
    
    // 窗口关闭时清理
    pdfWindow.on('closed', () => {
      // 窗口已关闭，不需要额外清理
    });
    
    return { success: true, filePath };
  } catch (error: any) {
    console.error('Failed to generate police report:', error);
    throw new Error(`Failed to generate report: ${error.message}`);
  }
});

// Batch generate police reports
ipcMain.handle("report:getBatchReportCount", async (_e, startDate?: string, endDate?: string, customerName?: string) => {
  if (!currentActivation) throw new Error('Not activated');
  
  try {
    const reportService = new PoliceReportService(currentActivation.id);
    const count = await reportService.getBatchReportCount(startDate, endDate, customerName);
    return count;
  } catch (error: any) {
    console.error('Failed to get batch report count:', error);
    throw new Error(`Failed to get count: ${error.message}`);
  }
});

ipcMain.handle("report:generatePoliceReportsBatch", async (_e, startDate?: string, endDate?: string, customerName?: string) => {
  if (!currentActivation) throw new Error('Not activated');
  
  try {
    const reportService = new PoliceReportService(currentActivation.id);
    
    // 使用进度回调来通知前端
    const filePath = await reportService.generateReportsBatch(
      startDate,
      endDate,
      customerName,
      (current, total, sessionId) => {
        // 发送进度更新到前端
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('report:batchProgress', { current, total, sessionId });
        }
      }
    );
    
    // 在应用内打开PDF窗口（与单个报告一样）
    const pdfWindow = new BrowserWindow({
      width: 1200,
      height: 900,
      title: `Police Report - Batch Report`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true, // Enable plugins to support PDF display
      }
    });
    
    // Use file:// protocol to directly load PDF file
    const pdfUrl = `file://${filePath.replace(/\\/g, '/')}`;
    pdfWindow.loadURL(pdfUrl);
    
    // 如果PDF无法加载，尝试使用备选方案
    pdfWindow.webContents.on('did-fail-load', async (event, errorCode, errorDescription, validatedURL) => {
      console.warn('PDF load failed, trying alternative:', errorCode, errorDescription);
      const opened = await shell.openPath(filePath);
      if (opened) {
        console.error('Failed to open PDF with system viewer:', opened);
      }
    });
    
    // 窗口关闭时清理
    pdfWindow.on('closed', () => {
      // 窗口已关闭，不需要额外清理
    });
    
    return { success: true, filePath };
  } catch (error: any) {
    console.error('Failed to generate batch police reports:', error);
    throw new Error(`Failed to generate batch reports: ${error.message}`);
  }
});

// Metal type related - 离线优先架构：先写本地，然后异步同步
ipcMain.handle("metalTypes:create", async (_e, data) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先写本地数据库
  const result = repo.metalTypes.create(currentActivation.id, data);
  const localId = result.lastInsertRowid as number;
  
  // 异步同步到云端（不阻塞）
  if (cloudDbService) {
    syncToCloudAsync('metal_types', localId, async () => {
      // 检查是否已存在相同的 symbol
      const existingTypes = await cloudDbService.getMetalTypes();
      const existing = existingTypes.find((mt: any) => mt.symbol === data.symbol);
      if (existing) {
        throw new Error(`Metal type with symbol "${data.symbol}" already exists`);
      }
      return await cloudDbService.createMetalType(data);
    });
  }
  
  return result;
});

ipcMain.handle("metalTypes:getAll", async () => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.metalTypes.getAll(currentActivation.id);
});

ipcMain.handle("metalTypes:getById", async (_e, id) => {
  if (!currentActivation) throw new Error('Not activated');
  // 离线优先：优先读本地数据库
  return repo.metalTypes.getById(currentActivation.id, id);
});

ipcMain.handle("metalTypes:update", async (_e, id, data) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // Record price change history
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
  
  // 先更新本地数据库
  const result = repo.metalTypes.update(currentActivation.id, id, data);
  
  // 标记为未同步
  try {
    const db = getDb();
    db.prepare(`UPDATE metal_types SET is_synced = 0 WHERE id = ?`).run(id);
  } catch (error: any) {
    if (!error.message?.includes('no such column')) {
      console.error('[Sync] Failed to mark metal type as unsynced:', error);
    }
  }
  
  // 异步同步到云端
  if (cloudDbService) {
    syncToCloudAsync('metal_types', id, async () => {
      return await cloudDbService.updateMetalType(id, data);
    });
  }
  
  return result;
});

ipcMain.handle("metalTypes:delete", async (_e, id) => {
  if (!currentActivation) throw new Error('Not activated');
  
  // 先删除本地数据库
  const result = repo.metalTypes.delete(currentActivation.id, id);
  
  // 异步从云端删除（不阻塞）
  if (cloudDbService) {
    (async () => {
      try {
        await cloudDbService.deleteMetalType(id);
      } catch (error) {
        console.error('[Sync] Failed to delete metal type from cloud:', error);
      }
    })();
  }
  
  return result;
});

ipcMain.handle("metalTypes:findBySymbol", async (_e, symbol) => {
  if (!currentActivation) throw new Error('Not activated');
  
  return repo.metalTypes.findBySymbol(currentActivation.id, symbol);
});

ipcMain.handle("metalPriceHistory:getByMetalType", async (_e, metalTypeId) => {
  if (!currentActivation) throw new Error('Not activated');
  
  return repo.metalPriceHistory.getByMetalType(currentActivation.id, metalTypeId);
});

