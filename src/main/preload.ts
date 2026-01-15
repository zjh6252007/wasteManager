import { contextBridge, ipcRenderer } from "electron";

// Expose secure API to renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Activation related
  auth: {
    activateAccount: (activationCode: string, username: string, password: string) => 
      ipcRenderer.invoke("auth:activateAccount", activationCode, username, password),
    activateAccountWithCode: (username: string, activationCode: string) => 
      ipcRenderer.invoke("auth:activateAccountWithCode", username, activationCode),
    authenticateUser: (username: string, password: string) => 
      ipcRenderer.invoke("auth:authenticateUser", username, password),
    verifyPassword: (username: string, password: string) => 
      ipcRenderer.invoke("auth:verifyPassword", username, password),
    changePassword: (currentPassword: string, newPassword: string) => 
      ipcRenderer.invoke("auth:changePassword", currentPassword, newPassword),
    checkActivationStatus: (activationCode: string) => ipcRenderer.invoke("auth:checkActivationStatus", activationCode),
    getCurrentUser: () => ipcRenderer.invoke("auth:getCurrentUser"),
    getCurrentActivation: () => ipcRenderer.invoke("auth:getCurrentActivation"),
    logout: () => ipcRenderer.invoke("auth:logout"),
    renewActivation: (activationCode: string) => ipcRenderer.invoke("auth:renewActivation", activationCode),
    onExpirationUpdated: (callback: (data: { expiresAt: string }) => void) => {
      ipcRenderer.on("auth:expiration-updated", (_event, data) => callback(data));
    },
  },

  // Admin functions
  admin: {
    createActivationCode: (data: any) => ipcRenderer.invoke("admin:createActivationCode", data),
    renewActivation: (activationCode: string) => ipcRenderer.invoke("admin:renewActivation", activationCode),
    disableActivation: (activationCode: string) => ipcRenderer.invoke("admin:disableActivation", activationCode),
  },

  // Test functions
  test: {
    createTestActivationCode: () => ipcRenderer.invoke("test:createTestActivationCode"),
  },

  // Customer related
  customers: {
    create: (data: any) => ipcRenderer.invoke("customers:create", data),
    getAll: () => ipcRenderer.invoke("customers:getAll"),
    getById: (id: number) => ipcRenderer.invoke("customers:getById", id),
    search: (query: string) => ipcRenderer.invoke("customers:search", query),
    getPaginated: (options: { page: number; pageSize: number; searchQuery?: string }) => ipcRenderer.invoke("customers:getPaginated", options),
    update: (customerId: number, data: any) => ipcRenderer.invoke("customers:update", customerId, data),
  },

  // Waste type related
  wasteTypes: {
    getAll: () => ipcRenderer.invoke("wasteTypes:getAll"),
    getById: (id: number) => ipcRenderer.invoke("wasteTypes:getById", id),
  },

  // Weighing session related
  weighingSessions: {
    create: (data: any) => ipcRenderer.invoke("weighingSessions:create", data),
    updateTotal: (sessionId: number, totalAmount: number) => ipcRenderer.invoke("weighingSessions:updateTotal", sessionId, totalAmount),
    update: (sessionId: number, data: any) => ipcRenderer.invoke("weighingSessions:update", sessionId, data),
    getById: (id: number) => ipcRenderer.invoke("weighingSessions:getById", id),
    getUnfinishedCount: () => ipcRenderer.invoke("weighingSessions:getUnfinishedCount"),
    delete: (sessionId: number) => ipcRenderer.invoke("weighingSessions:delete", sessionId),
    deleteAll: () => ipcRenderer.invoke("weighingSessions:deleteAll"),
  },

  // Weighing record related
  weighings: {
    create: (data: any) => ipcRenderer.invoke("weighings:create", data),
    getBySession: (sessionId: number) => ipcRenderer.invoke("weighings:getBySession", sessionId),
    deleteBySession: (sessionId: number) => ipcRenderer.invoke("weighings:deleteBySession", sessionId),
    getAll: () => ipcRenderer.invoke("weighings:getAll"),
    getById: (id: number) => ipcRenderer.invoke("weighings:getById", id),
    getPaginated: (options: any) => ipcRenderer.invoke("weighings:getPaginated", options),
  },

  // Vehicle related
  vehicles: {
    getAll: () => ipcRenderer.invoke("vehicles:getAll"),
    getById: (id: number) => ipcRenderer.invoke("vehicles:getById", id),
    getByCustomerId: (customerId: number) => ipcRenderer.invoke("vehicles:getByCustomerId", customerId),
    create: (data: any) => ipcRenderer.invoke("vehicles:create", data),
  },

  // Import functions
  import: {
    selectFile: () => ipcRenderer.invoke("import:selectFile"),
    readFile: (filePath: string) => ipcRenderer.invoke("import:readFile", filePath),
    importCustomers: (filePath: string) => ipcRenderer.invoke("import:importCustomers", filePath),
    importVehicles: (filePath: string) => ipcRenderer.invoke("import:importVehicles", filePath),
    onProgress: (callback: (progress: { current: number; total: number; percent: number; message: string }) => void) => {
      ipcRenderer.on('import:progress', (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners('import:progress');
    },
  },

  // Export functions
  export: {
    saveFile: (content: string, defaultFileName: string) => ipcRenderer.invoke("export:saveFile", content, defaultFileName),
    openFolder: (filePath: string) => ipcRenderer.invoke("export:openFolder", filePath),
  },

  // File functions
  file: {
    selectImage: () => ipcRenderer.invoke("file:selectImage"),
    readAsArrayBuffer: (filePath: string) => ipcRenderer.invoke("file:readAsArrayBuffer", filePath),
  },

  // Biometric functions
  biometric: {
    getByCustomerId: (customerId: number | string) => ipcRenderer.invoke("biometric:getByCustomerId", customerId),
    getAll: () => ipcRenderer.invoke("biometric:getAll"),
    saveFaceImage: (customerId: number | string, imageData: ArrayBuffer) => ipcRenderer.invoke("biometric:saveFaceImage", customerId, imageData),
    saveFingerprint: (customerId: number | string, template: ArrayBuffer, imageData?: ArrayBuffer) => ipcRenderer.invoke("biometric:saveFingerprint", customerId, template, imageData),
    saveSignatureImage: (customerId: number | string, imageData: ArrayBuffer) => ipcRenderer.invoke("biometric:saveSignatureImage", customerId, imageData),
  },
  // Image reading functions
  image: {
    readFile: (filePathOrUrl: string, options?: { 
      localPath?: string | null; 
      cloudUrl?: string | null;
      folder?: 'biometric' | 'customers' | 'products';
      prefix?: string;
    }) => ipcRenderer.invoke("image:readFile", filePathOrUrl, options),
  },

  // Report generation functions
  report: {
    generatePoliceReport: (sessionId: number) => ipcRenderer.invoke("report:generatePoliceReport", sessionId),
    getBatchReportCount: (startDate?: string, endDate?: string, customerName?: string) => ipcRenderer.invoke("report:getBatchReportCount", startDate, endDate, customerName),
    generatePoliceReportsBatch: (startDate?: string, endDate?: string, customerName?: string) => ipcRenderer.invoke("report:generatePoliceReportsBatch", startDate, endDate, customerName),
    generateInventoryReport: (startDate: string, endDate: string) => ipcRenderer.invoke("report:generateInventoryReport", startDate, endDate),
    onBatchProgress: (callback: (progress: { current: number; total: number; sessionId: number }) => void) => {
      ipcRenderer.on("report:batchProgress", (_event, progress) => callback(progress));
    },
    removeBatchProgressListener: (callback: (progress: { current: number; total: number; sessionId: number }) => void) => {
      ipcRenderer.removeListener("report:batchProgress", (_event, progress) => callback(progress));
    },
  },

  // Driver license photo functions
  license: {
    savePhoto: (customerId: number, imageData: ArrayBuffer) => ipcRenderer.invoke("license:savePhoto", customerId, imageData),
  },
  // Product photo functions
  product: {
    uploadPhoto: (imageData: ArrayBuffer, weighingId?: string | number) => ipcRenderer.invoke("product:uploadPhoto", imageData, weighingId),
  },

  // Camera functions
  camera: {
    start: () => ipcRenderer.invoke("camera:start"),
    stop: () => ipcRenderer.invoke("camera:stop"),
    capture: () => ipcRenderer.invoke("camera:capture"),
    getDevices: () => ipcRenderer.invoke("camera:getDevices"),
  },
  
  // IPC listeners (for camera device enumeration)
  ipc: {
    on: (channel: string, callback: (...args: any[]) => void) => {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },
    send: (channel: string, ...args: any[]) => {
      ipcRenderer.send(channel, ...args);
    },
    removeListener: (channel: string, callback: (...args: any[]) => void) => {
      ipcRenderer.removeListener(channel, callback);
    },
  },

  // Fingerprint device functions
  fingerprint: {
    init: () => ipcRenderer.invoke("fingerprint:init"),
    startCapture: () => ipcRenderer.invoke("fingerprint:startCapture"),
    stopCapture: () => ipcRenderer.invoke("fingerprint:stopCapture"),
    capture: () => ipcRenderer.invoke("fingerprint:capture"),
    verify: (template: ArrayBuffer) => ipcRenderer.invoke("fingerprint:verify", template),
    getStatus: () => ipcRenderer.invoke("fingerprint:getStatus"),
    listAllUsbDevices: () => ipcRenderer.invoke("fingerprint:listAllUsbDevices"),
  },
  
  // Signature pad functions
  tablet: {
    detectDevices: () => ipcRenderer.invoke("tablet:detectDevices"),
    init: () => ipcRenderer.invoke("tablet:init"),
    startCapture: () => ipcRenderer.invoke("tablet:startCapture"),
    stopCapture: () => ipcRenderer.invoke("tablet:stopCapture"),
    capture: () => ipcRenderer.invoke("tablet:capture"),
    getStatus: () => ipcRenderer.invoke("tablet:getStatus"),
    moveCursor: (x: number, y: number) => ipcRenderer.invoke("tablet:moveCursor", x, y),
    lockCursor: (bounds: { x: number, y: number, width: number, height: number }) => ipcRenderer.invoke("tablet:lockCursor", bounds),
    unlockCursor: () => ipcRenderer.invoke("tablet:unlockCursor"),
  },

  // Settings functions
  settings: {
    getSettings: () => ipcRenderer.invoke("settings:getSettings"),
    saveSettings: (settings: any) => ipcRenderer.invoke("settings:saveSettings", settings),
    getDevices: (deviceType?: string) => ipcRenderer.invoke("settings:getDevices", deviceType),
    getDefaultPrinter: () => ipcRenderer.invoke("settings:getDefaultPrinter"),
    testDevice: (deviceId: string, type: string) => ipcRenderer.invoke("settings:testDevice", deviceId, type),
    resetSettings: () => ipcRenderer.invoke("settings:resetSettings"),
    exportSettings: () => ipcRenderer.invoke("settings:exportSettings"),
    importSettings: (settingsJson: string) => ipcRenderer.invoke("settings:importSettings", settingsJson),
    checkSigWebInstalled: () => {
      // Note: Preload runs in isolated context, cannot access renderer's window
      // This function is kept for compatibility, but components should check directly
      // by calling window.IsSigWebInstalled() in the renderer process
      console.log('[Preload] checkSigWebInstalled called (note: preload cannot access renderer window)');
      console.log('[Preload] Components should call window.IsSigWebInstalled() directly in renderer');
      return false; // Always return false from preload, components should check directly
    },
    getSigWebVersion: () => {
      // Note: Preload runs in isolated context, cannot access renderer's window
      // Components should call window.GetSigWebVersion() directly in renderer
      console.log('[Preload] getSigWebVersion called (note: preload cannot access renderer window)');
      return ''; // Always return empty from preload, components should check directly
    },
  },

  // Print functions
  print: {
    printInvoice: (sessionId: number, printerName?: string) => ipcRenderer.invoke("print:printInvoice", sessionId, printerName),
  },

  // Update functions
  update: {
    checkForUpdates: () => ipcRenderer.invoke("update:checkForUpdates"),
    downloadUpdate: (downloadUrl: string) => ipcRenderer.invoke("update:downloadUpdate", downloadUrl),
    getCurrentVersion: () => ipcRenderer.invoke("update:getCurrentVersion"),
    onDownloadProgress: (callback: (progress: { downloaded: number; total: number; percent: number }) => void) => {
      ipcRenderer.on("update:download-progress", (_event, progress) => callback(progress));
    },
    removeDownloadProgressListener: () => {
      ipcRenderer.removeAllListeners("update:download-progress");
    },
  },

  // Backup functions
  backup: {
    performBackup: () => ipcRenderer.invoke("backup:performBackup"),
    checkNetwork: () => ipcRenderer.invoke("backup:checkNetwork"),
    updateSettings: (backupServerUrl: string) => ipcRenderer.invoke("backup:updateSettings", backupServerUrl),
    onProgress: (callback: (progress: { stage: string; progress: number; message: string }) => void) => {
      ipcRenderer.on("backup:progress", (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners("backup:progress");
    },
  },

  // Sync functions removed - data syncs via PowerSync in renderer process

  // Metal type functions
  metalTypes: {
    create: (data: any) => ipcRenderer.invoke("metalTypes:create", data),
    getAll: () => ipcRenderer.invoke("metalTypes:getAll"),
    getById: (id: number) => ipcRenderer.invoke("metalTypes:getById", id),
    update: (id: number, data: any) => ipcRenderer.invoke("metalTypes:update", id, data),
    delete: (id: number) => ipcRenderer.invoke("metalTypes:delete", id),
    findBySymbol: (symbol: string) => ipcRenderer.invoke("metalTypes:findBySymbol", symbol),
  },

  // Metal price history functions
  metalPriceHistory: {
    getByMetalType: (metalTypeId: number) => ipcRenderer.invoke("metalPriceHistory:getByMetalType", metalTypeId),
  },

  // PowerSync functions (for renderer process)
  powersync: {
    getConfig: () => ipcRenderer.invoke("powersync:getConfig"),
    generateJWT: (activationId: string | number) => ipcRenderer.invoke("powersync:generateJWT", activationId),
    checkJWTSecret: () => ipcRenderer.invoke("powersync:checkJWTSecret") as Promise<any>,
    uploadCrud: (transaction: any) => ipcRenderer.invoke("powersync:uploadCrud", transaction),
    // 注意：getService 不能通过 IPC 暴露（服务在渲染进程中）
    // 使用 window.getPowerSyncService() 或 window.powerSyncService 访问
    getService: () => {
      // 返回渲染进程中的服务实例（通过 window 对象访问）
      return (window as any).powerSyncService || null;
    },
    onStatusChanged: (status: any) => {
      // 发送状态变化到主进程（可选）
      ipcRenderer.send("powersync:status-changed", status);
    },
    onDataUpdated: () => {
      // 发送数据更新通知到主进程（可选）
      ipcRenderer.send("powersync:data-updated");
    },
  },
});

// Type declarations for PowerSync
declare global {
  interface Window {
    electronAPI: {
      // ... existing types ...
      powersync: {
        getConfig: () => Promise<{ activationId: number; endpoint: string; devToken: string } | null>;
        uploadCrud: (transaction: any) => Promise<{ success: boolean }>;
        onStatusChanged: (status: any) => void;
        onDataUpdated: () => void;
      };
    };
  }
}

// Type declarations
declare global {
  interface Window {
    electronAPI: {
      auth: {
        activateAccount: (activationCode: string, username: string, password: string) => Promise<any>;
        authenticateUser: (username: string, password: string) => Promise<any>;
        verifyPassword: (username: string, password: string) => Promise<{ success: boolean; message: string }>;
        checkActivationStatus: (activationCode: string) => Promise<any>;
        getCurrentUser: () => Promise<any>;
        getCurrentActivation: () => Promise<any>;
        logout: () => Promise<any>;
      };
      admin: {
        createActivationCode: (data: any) => Promise<any>;
        renewActivation: (activationCode: string) => Promise<any>;
        disableActivation: (activationCode: string) => Promise<any>;
      };
      test: {
        createTestActivationCode: () => Promise<any>;
      };
      customers: {
        create: (data: any) => Promise<any>;
        getAll: () => Promise<any[]>;
        getById: (id: number) => Promise<any>;
        search: (query: string) => Promise<any[]>;
        getPaginated: (options: { page: number; pageSize: number; searchQuery?: string }) => Promise<{
          data: any[];
          total: number;
          page: number;
          pageSize: number;
          totalPages: number;
        }>;
        update: (customerId: number, data: any) => Promise<any>;
      };
      wasteTypes: {
        getAll: () => Promise<any[]>;
        getById: (id: number) => Promise<any>;
      };
      weighingSessions: {
        create: (data: any) => Promise<any>;
        updateTotal: (sessionId: number, totalAmount: number) => Promise<any>;
        update: (sessionId: number, data: any) => Promise<any>;
        getById: (id: number) => Promise<any>;
        getUnfinishedCount: () => Promise<number>;
        delete: (sessionId: number) => Promise<any>;
        deleteAll: () => Promise<any>;
      };
      weighings: {
        create: (data: any) => Promise<any>;
        getBySession: (sessionId: number) => Promise<any[]>;
        deleteBySession: (sessionId: number) => Promise<any>;
        getAll: () => Promise<any[]>;
        getById: (id: number) => Promise<any>;
        getPaginated: (options: any) => Promise<any>;
      };
      vehicles: {
        getAll: () => Promise<any[]>;
        getById: (id: number) => Promise<any>;
        getByCustomerId: (customerId: number) => Promise<any[]>;
        create: (data: any) => Promise<any>;
      };
      import: {
        selectFile: () => Promise<string | null>;
        importCustomers: (filePath: string) => Promise<any>;
        importVehicles: (filePath: string) => Promise<any>;
        onProgress: (callback: (progress: { current: number; total: number; percent: number; message: string }) => void) => void;
        removeProgressListener: () => void;
      };
      file: {
        selectImage: () => Promise<string | null>;
      };
      biometric: {
        getByCustomerId: (customerId: number | string) => Promise<any>;
        getAll: () => Promise<any[]>;
        saveFaceImage: (customerId: number | string, imageData: ArrayBuffer) => Promise<string>;
        saveFingerprint: (customerId: number | string, template: ArrayBuffer, imageData?: ArrayBuffer) => Promise<string>;
        saveSignatureImage: (customerId: number | string, imageData: ArrayBuffer) => Promise<string>;
      };
      image: {
        readFile: (
          filePathOrUrl: string, 
          options?: { 
            localPath?: string | null; 
            cloudUrl?: string | null;
            folder?: 'biometric' | 'customers' | 'products';
            prefix?: string;
          }
        ) => Promise<string | null>;
      };
      report: {
        generatePoliceReport: (sessionId: number) => Promise<any>;
        generatePoliceReportsBatch: (startDate?: string, endDate?: string, customerName?: string) => Promise<{ success: boolean; filePath: string }>;
        generateInventoryReport: (startDate: string, endDate: string) => Promise<any>;
        onBatchProgress: (callback: (progress: { current: number; total: number; sessionId: number }) => void) => void;
        removeBatchProgressListener: (callback: (progress: { current: number; total: number; sessionId: number }) => void) => void;
      };
      license: {
        savePhoto: (customerId: number, imageData: ArrayBuffer) => Promise<string>;
      };
      camera: {
        start: () => Promise<boolean>;
        stop: () => Promise<void>;
        capture: () => Promise<any>;
        getDevices: () => Promise<MediaDeviceInfo[]>;
      };
      ipc: {
        on: (channel: string, callback: (...args: any[]) => void) => void;
        send: (channel: string, ...args: any[]) => void;
        removeListener: (channel: string, callback: (...args: any[]) => void) => void;
      };
      fingerprint: {
        init: () => Promise<boolean>;
        startCapture: () => Promise<boolean>;
        stopCapture: () => Promise<void>;
        capture: () => Promise<any>;
        verify: (template: ArrayBuffer) => Promise<boolean>;
        getStatus: () => Promise<string>;
        listAllUsbDevices: () => Promise<Array<{vendorId: number, productId: number, vendorIdHex: string, productIdHex: string, manufacturer?: string, product?: string}>>;
      };
      tablet: {
        init: () => Promise<boolean>;
        startCapture: () => Promise<boolean>;
        stopCapture: () => Promise<void>;
        capture: () => Promise<any>;
        getStatus: () => Promise<string>;
        lockCursor: (bounds: { x: number, y: number, width: number, height: number }) => Promise<{ success: boolean; error?: string }>;
        unlockCursor: () => Promise<{ success: boolean; error?: string }>;
      };
      settings: {
        getSettings: () => Promise<any>;
        saveSettings: (settings: any) => Promise<void>;
        getDevices: (deviceType?: string) => Promise<any[]>;
        getDefaultPrinter: () => Promise<any>;
        testDevice: (deviceId: string, type: string) => Promise<boolean>;
        resetSettings: () => Promise<void>;
        exportSettings: () => Promise<string>;
        importSettings: (settingsJson: string) => Promise<void>;
        checkSigWebInstalled: () => boolean;
        getSigWebVersion: () => string;
      };
      print: {
        printInvoice: (sessionId: number, printerName?: string) => Promise<{ success: boolean }>;
      };
      update: {
        checkForUpdates: () => Promise<any>;
        downloadUpdate: (downloadUrl: string) => Promise<void>;
        getCurrentVersion: () => Promise<string>;
        onDownloadProgress: (callback: (progress: { downloaded: number; total: number; percent: number }) => void) => void;
        removeDownloadProgressListener: () => void;
      };
      backup: {
        performBackup: () => Promise<any>;
        checkNetwork: () => Promise<boolean>;
        updateSettings: (backupServerUrl: string) => Promise<void>;
        onProgress: (callback: (progress: { stage: string; progress: number; message: string }) => void) => void;
        removeProgressListener: () => void;
      };
      sync: {
        discoverDevices: () => Promise<any[]>;
        syncWithDevice: (device: any) => Promise<any>;
        syncFromCloud: () => Promise<any>;
        performAutoSync: () => Promise<any>;
        startLocalSync: () => Promise<any>;
        stopLocalSync: () => Promise<any>;
        checkDataMismatch: () => Promise<{ mismatched: boolean; localHash: string; cloudHash: string | null }>;
        uploadToCloud: (forceUploadAll?: boolean) => Promise<any>;
        downloadFromCloud: (forceFullSync?: boolean) => Promise<any>;
        checkNetwork: () => Promise<boolean>;
        onProgress: (callback: (progress: { stage: string; progress: number; message: string; deviceCount?: number; syncedRecords?: number; totalRecords?: number }) => void) => void;
        onDataMismatch: (callback: (data: { mismatched: boolean; message: string }) => void) => void;
        onClosingSync: (callback: (data: { message: string }) => void) => void;
        onClosingSyncComplete: (callback: (data: { success: boolean; message: string }) => void) => void;
        removeProgressListener: () => void;
        removeDataMismatchListener: () => void;
        removeClosingSyncListener: () => void;
      };
      metalTypes: {
        create: (data: any) => Promise<any>;
        getAll: () => Promise<any[]>;
        getById: (id: number) => Promise<any>;
        update: (id: number, data: any) => Promise<any>;
        delete: (id: number) => Promise<any>;
        findBySymbol: (symbol: string) => Promise<any>;
      };
      metalPriceHistory: {
        getByMetalType: (metalTypeId: number) => Promise<any[]>;
      };
    };
  }
}
