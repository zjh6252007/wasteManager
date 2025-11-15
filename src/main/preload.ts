import { contextBridge, ipcRenderer } from "electron";

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld("electronAPI", {
  // 激活相关
  auth: {
    activateAccount: (activationCode: string, username: string, password: string) => 
      ipcRenderer.invoke("auth:activateAccount", activationCode, username, password),
    authenticateUser: (username: string, password: string) => 
      ipcRenderer.invoke("auth:authenticateUser", username, password),
    checkActivationStatus: (activationCode: string) => ipcRenderer.invoke("auth:checkActivationStatus", activationCode),
    getCurrentUser: () => ipcRenderer.invoke("auth:getCurrentUser"),
    getCurrentActivation: () => ipcRenderer.invoke("auth:getCurrentActivation"),
    logout: () => ipcRenderer.invoke("auth:logout"),
  },

  // 管理员功能
  admin: {
    createActivationCode: (data: any) => ipcRenderer.invoke("admin:createActivationCode", data),
    renewActivation: (activationCode: string) => ipcRenderer.invoke("admin:renewActivation", activationCode),
    disableActivation: (activationCode: string) => ipcRenderer.invoke("admin:disableActivation", activationCode),
  },

  // 测试功能
  test: {
    createTestActivationCode: () => ipcRenderer.invoke("test:createTestActivationCode"),
  },

  // 客户相关
  customers: {
    create: (data: any) => ipcRenderer.invoke("customers:create", data),
    getAll: () => ipcRenderer.invoke("customers:getAll"),
    getById: (id: number) => ipcRenderer.invoke("customers:getById", id),
    search: (query: string) => ipcRenderer.invoke("customers:search", query),
    getPaginated: (options: { page: number; pageSize: number; searchQuery?: string }) => ipcRenderer.invoke("customers:getPaginated", options),
    update: (customerId: number, data: any) => ipcRenderer.invoke("customers:update", customerId, data),
  },

  // 垃圾类型相关
  wasteTypes: {
    getAll: () => ipcRenderer.invoke("wasteTypes:getAll"),
    getById: (id: number) => ipcRenderer.invoke("wasteTypes:getById", id),
  },

  // 称重会话相关
  weighingSessions: {
    create: (data: any) => ipcRenderer.invoke("weighingSessions:create", data),
    updateTotal: (sessionId: number, totalAmount: number) => ipcRenderer.invoke("weighingSessions:updateTotal", sessionId, totalAmount),
    update: (sessionId: number, data: any) => ipcRenderer.invoke("weighingSessions:update", sessionId, data),
    getById: (id: number) => ipcRenderer.invoke("weighingSessions:getById", id),
    getUnfinishedCount: () => ipcRenderer.invoke("weighingSessions:getUnfinishedCount"),
    deleteAll: () => ipcRenderer.invoke("weighingSessions:deleteAll"),
  },

  // 称重记录相关
  weighings: {
    create: (data: any) => ipcRenderer.invoke("weighings:create", data),
    getBySession: (sessionId: number) => ipcRenderer.invoke("weighings:getBySession", sessionId),
    deleteBySession: (sessionId: number) => ipcRenderer.invoke("weighings:deleteBySession", sessionId),
    getAll: () => ipcRenderer.invoke("weighings:getAll"),
    getById: (id: number) => ipcRenderer.invoke("weighings:getById", id),
    getPaginated: (options: any) => ipcRenderer.invoke("weighings:getPaginated", options),
  },

  // 车辆相关
  vehicles: {
    getAll: () => ipcRenderer.invoke("vehicles:getAll"),
    getById: (id: number) => ipcRenderer.invoke("vehicles:getById", id),
    getByCustomerId: (customerId: number) => ipcRenderer.invoke("vehicles:getByCustomerId", customerId),
    create: (data: any) => ipcRenderer.invoke("vehicles:create", data),
  },

  // 导入功能
  import: {
    selectFile: () => ipcRenderer.invoke("import:selectFile"),
    importCustomers: (filePath: string) => ipcRenderer.invoke("import:importCustomers", filePath),
    importVehicles: (filePath: string) => ipcRenderer.invoke("import:importVehicles", filePath),
    onProgress: (callback: (progress: { current: number; total: number; percent: number; message: string }) => void) => {
      ipcRenderer.on('import:progress', (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners('import:progress');
    },
  },

  // 文件选择功能
  file: {
    selectImage: () => ipcRenderer.invoke("file:selectImage"),
  },

  // 生物识别功能
  biometric: {
    getByCustomerId: (customerId: number) => ipcRenderer.invoke("biometric:getByCustomerId", customerId),
    getAll: () => ipcRenderer.invoke("biometric:getAll"),
    saveFaceImage: (customerId: number, imageData: ArrayBuffer) => ipcRenderer.invoke("biometric:saveFaceImage", customerId, imageData),
    saveFingerprint: (customerId: number, template: ArrayBuffer, imageData?: ArrayBuffer) => ipcRenderer.invoke("biometric:saveFingerprint", customerId, template, imageData),
    saveSignatureImage: (customerId: number, imageData: ArrayBuffer) => ipcRenderer.invoke("biometric:saveSignatureImage", customerId, imageData),
  },

  // 图片读取功能
  image: {
    readFile: (filePath: string) => ipcRenderer.invoke("image:readFile", filePath),
  },

  // 报告生成功能
  report: {
    generatePoliceReport: (sessionId: number) => ipcRenderer.invoke("report:generatePoliceReport", sessionId),
    generateInventoryReport: (startDate: string, endDate: string) => ipcRenderer.invoke("report:generateInventoryReport", startDate, endDate),
  },

  // 驾照照片功能
  license: {
    savePhoto: (customerId: number, imageData: ArrayBuffer) => ipcRenderer.invoke("license:savePhoto", customerId, imageData),
  },

  // 摄像头功能
  camera: {
    start: () => ipcRenderer.invoke("camera:start"),
    stop: () => ipcRenderer.invoke("camera:stop"),
    capture: () => ipcRenderer.invoke("camera:capture"),
    getDevices: () => ipcRenderer.invoke("camera:getDevices"),
  },
  
  // IPC监听器（用于摄像头设备枚举）
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

  // 指纹板功能
  fingerprint: {
    init: () => ipcRenderer.invoke("fingerprint:init"),
    startCapture: () => ipcRenderer.invoke("fingerprint:startCapture"),
    stopCapture: () => ipcRenderer.invoke("fingerprint:stopCapture"),
    capture: () => ipcRenderer.invoke("fingerprint:capture"),
    verify: (template: ArrayBuffer) => ipcRenderer.invoke("fingerprint:verify", template),
    getStatus: () => ipcRenderer.invoke("fingerprint:getStatus"),
    listAllUsbDevices: () => ipcRenderer.invoke("fingerprint:listAllUsbDevices"),
  },
  
  // 手写板功能
  tablet: {
    init: () => ipcRenderer.invoke("tablet:init"),
    startCapture: () => ipcRenderer.invoke("tablet:startCapture"),
    stopCapture: () => ipcRenderer.invoke("tablet:stopCapture"),
    capture: () => ipcRenderer.invoke("tablet:capture"),
    getStatus: () => ipcRenderer.invoke("tablet:getStatus"),
    lockCursor: (bounds: { x: number, y: number, width: number, height: number }) => ipcRenderer.invoke("tablet:lockCursor", bounds),
    unlockCursor: () => ipcRenderer.invoke("tablet:unlockCursor"),
  },

  // 设置功能
  settings: {
    getSettings: () => ipcRenderer.invoke("settings:getSettings"),
    saveSettings: (settings: any) => ipcRenderer.invoke("settings:saveSettings", settings),
    getDevices: (deviceType?: string) => ipcRenderer.invoke("settings:getDevices", deviceType),
    testDevice: (deviceId: string, type: string) => ipcRenderer.invoke("settings:testDevice", deviceId, type),
    resetSettings: () => ipcRenderer.invoke("settings:resetSettings"),
    exportSettings: () => ipcRenderer.invoke("settings:exportSettings"),
    importSettings: (settingsJson: string) => ipcRenderer.invoke("settings:importSettings", settingsJson),
  },

  // 更新功能
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

  // 备份功能
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

  // 同步功能
  sync: {
    discoverDevices: () => ipcRenderer.invoke("sync:discoverDevices"),
    syncWithDevice: (device: any) => ipcRenderer.invoke("sync:syncWithDevice", device),
    syncFromCloud: () => ipcRenderer.invoke("sync:syncFromCloud"),
    performAutoSync: () => ipcRenderer.invoke("sync:performAutoSync"),
    startLocalSync: () => ipcRenderer.invoke("sync:startLocalSync"),
    stopLocalSync: () => ipcRenderer.invoke("sync:stopLocalSync"),
    onProgress: (callback: (progress: { stage: string; progress: number; message: string; deviceCount?: number; syncedRecords?: number; totalRecords?: number }) => void) => {
      ipcRenderer.on("sync:progress", (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners("sync:progress");
    },
  },

  // 金属种类功能
  metalTypes: {
    create: (data: any) => ipcRenderer.invoke("metalTypes:create", data),
    getAll: () => ipcRenderer.invoke("metalTypes:getAll"),
    getById: (id: number) => ipcRenderer.invoke("metalTypes:getById", id),
    update: (id: number, data: any) => ipcRenderer.invoke("metalTypes:update", id, data),
    delete: (id: number) => ipcRenderer.invoke("metalTypes:delete", id),
    findBySymbol: (symbol: string) => ipcRenderer.invoke("metalTypes:findBySymbol", symbol),
  },

  // 金属价格历史功能
  metalPriceHistory: {
    getByMetalType: (metalTypeId: number) => ipcRenderer.invoke("metalPriceHistory:getByMetalType", metalTypeId),
  },
});

// 类型声明
declare global {
  interface Window {
    electronAPI: {
      auth: {
        activateAccount: (activationCode: string, username: string, password: string) => Promise<any>;
        authenticateUser: (username: string, password: string) => Promise<any>;
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
        getByCustomerId: (customerId: number) => Promise<any>;
        getAll: () => Promise<any[]>;
        saveFaceImage: (customerId: number, imageData: ArrayBuffer) => Promise<string>;
        saveFingerprint: (customerId: number, template: ArrayBuffer, imageData?: ArrayBuffer) => Promise<string>;
        saveSignatureImage: (customerId: number, imageData: ArrayBuffer) => Promise<string>;
      };
      image: {
        readFile: (filePath: string) => Promise<string | null>;
      };
      report: {
        generatePoliceReport: (sessionId: number) => Promise<any>;
        generateInventoryReport: (startDate: string, endDate: string) => Promise<any>;
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
        testDevice: (deviceId: string, type: string) => Promise<boolean>;
        resetSettings: () => Promise<void>;
        exportSettings: () => Promise<string>;
        importSettings: (settingsJson: string) => Promise<void>;
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
