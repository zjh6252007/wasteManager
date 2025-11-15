"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // 激活相关
  auth: {
    activateAccount: (activationCode, username, password) => electron.ipcRenderer.invoke("auth:activateAccount", activationCode, username, password),
    authenticateUser: (username, password) => electron.ipcRenderer.invoke("auth:authenticateUser", username, password),
    checkActivationStatus: (activationCode) => electron.ipcRenderer.invoke("auth:checkActivationStatus", activationCode),
    getCurrentUser: () => electron.ipcRenderer.invoke("auth:getCurrentUser"),
    getCurrentActivation: () => electron.ipcRenderer.invoke("auth:getCurrentActivation"),
    logout: () => electron.ipcRenderer.invoke("auth:logout")
  },
  // 管理员功能
  admin: {
    createActivationCode: (data) => electron.ipcRenderer.invoke("admin:createActivationCode", data),
    renewActivation: (activationCode) => electron.ipcRenderer.invoke("admin:renewActivation", activationCode),
    disableActivation: (activationCode) => electron.ipcRenderer.invoke("admin:disableActivation", activationCode)
  },
  // 测试功能
  test: {
    createTestActivationCode: () => electron.ipcRenderer.invoke("test:createTestActivationCode")
  },
  // 客户相关
  customers: {
    create: (data) => electron.ipcRenderer.invoke("customers:create", data),
    getAll: () => electron.ipcRenderer.invoke("customers:getAll"),
    getById: (id) => electron.ipcRenderer.invoke("customers:getById", id),
    search: (query) => electron.ipcRenderer.invoke("customers:search", query),
    getPaginated: (options) => electron.ipcRenderer.invoke("customers:getPaginated", options),
    update: (customerId, data) => electron.ipcRenderer.invoke("customers:update", customerId, data)
  },
  // 垃圾类型相关
  wasteTypes: {
    getAll: () => electron.ipcRenderer.invoke("wasteTypes:getAll"),
    getById: (id) => electron.ipcRenderer.invoke("wasteTypes:getById", id)
  },
  // 称重会话相关
  weighingSessions: {
    create: (data) => electron.ipcRenderer.invoke("weighingSessions:create", data),
    updateTotal: (sessionId, totalAmount) => electron.ipcRenderer.invoke("weighingSessions:updateTotal", sessionId, totalAmount),
    update: (sessionId, data) => electron.ipcRenderer.invoke("weighingSessions:update", sessionId, data),
    getById: (id) => electron.ipcRenderer.invoke("weighingSessions:getById", id),
    getUnfinishedCount: () => electron.ipcRenderer.invoke("weighingSessions:getUnfinishedCount"),
    deleteAll: () => electron.ipcRenderer.invoke("weighingSessions:deleteAll")
  },
  // 称重记录相关
  weighings: {
    create: (data) => electron.ipcRenderer.invoke("weighings:create", data),
    getBySession: (sessionId) => electron.ipcRenderer.invoke("weighings:getBySession", sessionId),
    deleteBySession: (sessionId) => electron.ipcRenderer.invoke("weighings:deleteBySession", sessionId),
    getAll: () => electron.ipcRenderer.invoke("weighings:getAll"),
    getById: (id) => electron.ipcRenderer.invoke("weighings:getById", id),
    getPaginated: (options) => electron.ipcRenderer.invoke("weighings:getPaginated", options)
  },
  // 车辆相关
  vehicles: {
    getAll: () => electron.ipcRenderer.invoke("vehicles:getAll"),
    getById: (id) => electron.ipcRenderer.invoke("vehicles:getById", id),
    getByCustomerId: (customerId) => electron.ipcRenderer.invoke("vehicles:getByCustomerId", customerId),
    create: (data) => electron.ipcRenderer.invoke("vehicles:create", data)
  },
  // 导入功能
  import: {
    selectFile: () => electron.ipcRenderer.invoke("import:selectFile"),
    importCustomers: (filePath) => electron.ipcRenderer.invoke("import:importCustomers", filePath),
    importVehicles: (filePath) => electron.ipcRenderer.invoke("import:importVehicles", filePath),
    onProgress: (callback) => {
      electron.ipcRenderer.on("import:progress", (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      electron.ipcRenderer.removeAllListeners("import:progress");
    }
  },
  // 文件选择功能
  file: {
    selectImage: () => electron.ipcRenderer.invoke("file:selectImage")
  },
  // 生物识别功能
  biometric: {
    getByCustomerId: (customerId) => electron.ipcRenderer.invoke("biometric:getByCustomerId", customerId),
    getAll: () => electron.ipcRenderer.invoke("biometric:getAll"),
    saveFaceImage: (customerId, imageData) => electron.ipcRenderer.invoke("biometric:saveFaceImage", customerId, imageData),
    saveFingerprint: (customerId, template, imageData) => electron.ipcRenderer.invoke("biometric:saveFingerprint", customerId, template, imageData),
    saveSignatureImage: (customerId, imageData) => electron.ipcRenderer.invoke("biometric:saveSignatureImage", customerId, imageData)
  },
  // 图片读取功能
  image: {
    readFile: (filePath) => electron.ipcRenderer.invoke("image:readFile", filePath)
  },
  // 报告生成功能
  report: {
    generatePoliceReport: (sessionId) => electron.ipcRenderer.invoke("report:generatePoliceReport", sessionId),
    generateInventoryReport: (startDate, endDate) => electron.ipcRenderer.invoke("report:generateInventoryReport", startDate, endDate)
  },
  // 驾照照片功能
  license: {
    savePhoto: (customerId, imageData) => electron.ipcRenderer.invoke("license:savePhoto", customerId, imageData)
  },
  // 摄像头功能
  camera: {
    start: () => electron.ipcRenderer.invoke("camera:start"),
    stop: () => electron.ipcRenderer.invoke("camera:stop"),
    capture: () => electron.ipcRenderer.invoke("camera:capture"),
    getDevices: () => electron.ipcRenderer.invoke("camera:getDevices")
  },
  // IPC监听器（用于摄像头设备枚举）
  ipc: {
    on: (channel, callback) => {
      electron.ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },
    send: (channel, ...args) => {
      electron.ipcRenderer.send(channel, ...args);
    },
    removeListener: (channel, callback) => {
      electron.ipcRenderer.removeListener(channel, callback);
    }
  },
  // 指纹板功能
  fingerprint: {
    init: () => electron.ipcRenderer.invoke("fingerprint:init"),
    startCapture: () => electron.ipcRenderer.invoke("fingerprint:startCapture"),
    stopCapture: () => electron.ipcRenderer.invoke("fingerprint:stopCapture"),
    capture: () => electron.ipcRenderer.invoke("fingerprint:capture"),
    verify: (template) => electron.ipcRenderer.invoke("fingerprint:verify", template),
    getStatus: () => electron.ipcRenderer.invoke("fingerprint:getStatus"),
    listAllUsbDevices: () => electron.ipcRenderer.invoke("fingerprint:listAllUsbDevices")
  },
  // 手写板功能
  tablet: {
    init: () => electron.ipcRenderer.invoke("tablet:init"),
    startCapture: () => electron.ipcRenderer.invoke("tablet:startCapture"),
    stopCapture: () => electron.ipcRenderer.invoke("tablet:stopCapture"),
    capture: () => electron.ipcRenderer.invoke("tablet:capture"),
    getStatus: () => electron.ipcRenderer.invoke("tablet:getStatus"),
    lockCursor: (bounds) => electron.ipcRenderer.invoke("tablet:lockCursor", bounds),
    unlockCursor: () => electron.ipcRenderer.invoke("tablet:unlockCursor")
  },
  // 设置功能
  settings: {
    getSettings: () => electron.ipcRenderer.invoke("settings:getSettings"),
    saveSettings: (settings) => electron.ipcRenderer.invoke("settings:saveSettings", settings),
    getDevices: (deviceType) => electron.ipcRenderer.invoke("settings:getDevices", deviceType),
    testDevice: (deviceId, type) => electron.ipcRenderer.invoke("settings:testDevice", deviceId, type),
    resetSettings: () => electron.ipcRenderer.invoke("settings:resetSettings"),
    exportSettings: () => electron.ipcRenderer.invoke("settings:exportSettings"),
    importSettings: (settingsJson) => electron.ipcRenderer.invoke("settings:importSettings", settingsJson)
  },
  // 更新功能
  update: {
    checkForUpdates: () => electron.ipcRenderer.invoke("update:checkForUpdates"),
    downloadUpdate: (downloadUrl) => electron.ipcRenderer.invoke("update:downloadUpdate", downloadUrl),
    getCurrentVersion: () => electron.ipcRenderer.invoke("update:getCurrentVersion"),
    onDownloadProgress: (callback) => {
      electron.ipcRenderer.on("update:download-progress", (_event, progress) => callback(progress));
    },
    removeDownloadProgressListener: () => {
      electron.ipcRenderer.removeAllListeners("update:download-progress");
    }
  },
  // 备份功能
  backup: {
    performBackup: () => electron.ipcRenderer.invoke("backup:performBackup"),
    checkNetwork: () => electron.ipcRenderer.invoke("backup:checkNetwork"),
    updateSettings: (backupServerUrl) => electron.ipcRenderer.invoke("backup:updateSettings", backupServerUrl),
    onProgress: (callback) => {
      electron.ipcRenderer.on("backup:progress", (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      electron.ipcRenderer.removeAllListeners("backup:progress");
    }
  },
  // 同步功能
  sync: {
    discoverDevices: () => electron.ipcRenderer.invoke("sync:discoverDevices"),
    syncWithDevice: (device) => electron.ipcRenderer.invoke("sync:syncWithDevice", device),
    syncFromCloud: () => electron.ipcRenderer.invoke("sync:syncFromCloud"),
    performAutoSync: () => electron.ipcRenderer.invoke("sync:performAutoSync"),
    startLocalSync: () => electron.ipcRenderer.invoke("sync:startLocalSync"),
    stopLocalSync: () => electron.ipcRenderer.invoke("sync:stopLocalSync"),
    onProgress: (callback) => {
      electron.ipcRenderer.on("sync:progress", (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      electron.ipcRenderer.removeAllListeners("sync:progress");
    }
  },
  // 金属种类功能
  metalTypes: {
    create: (data) => electron.ipcRenderer.invoke("metalTypes:create", data),
    getAll: () => electron.ipcRenderer.invoke("metalTypes:getAll"),
    getById: (id) => electron.ipcRenderer.invoke("metalTypes:getById", id),
    update: (id, data) => electron.ipcRenderer.invoke("metalTypes:update", id, data),
    delete: (id) => electron.ipcRenderer.invoke("metalTypes:delete", id),
    findBySymbol: (symbol) => electron.ipcRenderer.invoke("metalTypes:findBySymbol", symbol)
  },
  // 金属价格历史功能
  metalPriceHistory: {
    getByMetalType: (metalTypeId) => electron.ipcRenderer.invoke("metalPriceHistory:getByMetalType", metalTypeId)
  }
});
//# sourceMappingURL=preload.cjs.map
