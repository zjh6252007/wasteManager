import React, { useState, useEffect } from 'react';
import './Settings.css';

interface SettingsProps {
  onClose: () => void;
}

interface DeviceInfo {
  id: string;
  name: string;
  type: 'camera' | 'fingerprint' | 'tablet' | 'scale' | 'printer';
  status: 'connected' | 'disconnected' | 'error';
  details?: any;
}

interface AppSettings {
  language: string;
  theme: 'light' | 'dark' | 'auto';
  notifications: boolean;
  autoSave: boolean;
  defaultCamera?: string;
  defaultFingerprint?: string;
  dataRetention: number;
  backupEnabled: boolean;
  backupInterval: number;
  backupServerUrl?: string;
  autoUpdateCheck: boolean;
  updateCheckInterval: number;
}

// 格式化字节数
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'devices' | 'sync' | 'advanced'>('general');
  const [settings, setSettings] = useState<AppSettings>({
    language: 'en-US',
    theme: 'light',
    notifications: true,
    autoSave: true,
    dataRetention: 365,
    backupEnabled: false,
    backupInterval: 24,
    backupServerUrl: 'https://backup-server-1378.azurewebsites.net/backup/upload',
    autoUpdateCheck: true,
    updateCheckInterval: 24
  });
  const [updateStatus, setUpdateStatus] = useState<{
    checking: boolean;
    available: boolean;
    downloading: boolean;
    version?: string;
    releaseNotes?: string;
    downloadUrl?: string;
    downloadProgress?: {
      downloaded: number;
      total: number;
      percent: number;
    };
  }>({
    checking: false,
    available: false,
    downloading: false
  });
  const [backupStatus, setBackupStatus] = useState<{
    backingUp: boolean;
    progress?: {
      stage: string;
      progress: number;
      message: string;
    };
    lastBackup?: string;
    networkStatus?: boolean;
  }>({
    backingUp: false
  });
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // 同步相关状态
  const [syncStatus, setSyncStatus] = useState<{
    syncing: boolean;
    progress?: {
      stage: string;
      progress: number;
      message: string;
      deviceCount?: number;
      syncedRecords?: number;
      totalRecords?: number;
    };
    discoveredDevices?: Array<{
      id: string;
      name: string;
      ip: string;
      port: number;
      activationId: number;
      lastSyncTime?: string;
    }>;
    lastSync?: string;
  }>({
    syncing: false
  });

  useEffect(() => {
    loadSettings();
    loadDevices();
    
    // 设置同步进度监听
    (window.electronAPI as any).sync.onProgress((progress: any) => {
      setSyncStatus(prev => ({
        ...prev,
        progress: progress,
        syncing: progress.stage !== 'completed' && progress.stage !== 'error'
      }));
    });
    
    return () => {
      (window.electronAPI as any).sync.removeProgressListener();
    };
  }, []);

  const loadSettings = async () => {
    try {
      const settingsData = await window.electronAPI.settings.getSettings();
      setSettings(settingsData);
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  };

  const loadDevices = async () => {
    try {
      setIsLoading(true);
      // Set timeout to avoid infinite waiting
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Device loading timeout')), 10000)
      );
      
      const devicesData = await Promise.race([
        window.electronAPI.settings.getDevices(),
        timeoutPromise
      ]) as DeviceInfo[];
      
      setDevices(devicesData);
    } catch (error) {
      console.error('Failed to load device list:', error);
      setDevices([]); // Set to empty array on error to avoid infinite loading
      showMessage('error', `Failed to load devices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh devices of a specific type
  const refreshDeviceType = async (deviceType: DeviceInfo['type']) => {
    try {
      // Set loading state only for this specific device type
      setIsLoading(true);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Device loading timeout')), 10000)
      );
      
      // Only get devices of the specific type
      const devicesData = await Promise.race([
        window.electronAPI.settings.getDevices(deviceType),
        timeoutPromise
      ]) as DeviceInfo[];
      
      // Only update devices of the specific type, keep other device types unchanged
      setDevices(prevDevices => {
        const otherDevices = prevDevices.filter(d => d.type !== deviceType);
        return [...otherDevices, ...devicesData];
      });
    } catch (error) {
      console.error(`Failed to refresh ${deviceType} devices:`, error);
      showMessage('error', `Failed to refresh devices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      await window.electronAPI.settings.saveSettings(settings);
      showMessage('success', 'Settings saved successfully!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      showMessage('error', 'Failed to save settings');
    }
  };

  // 设置下载进度监听
  useEffect(() => {
    const progressCallback = (progress: { downloaded: number; total: number; percent: number }) => {
      setUpdateStatus(prev => ({
        ...prev,
        downloadProgress: progress
      }));
    };

    window.electronAPI.update.onDownloadProgress(progressCallback);

    return () => {
      window.electronAPI.update.removeDownloadProgressListener();
    };
  }, []);

  // 设置备份进度监听
  useEffect(() => {
    const progressCallback = (progress: { stage: string; progress: number; message: string }) => {
      setBackupStatus(prev => ({
        ...prev,
        progress: progress
      }));
    };

    window.electronAPI.backup.onProgress(progressCallback);

    // 检查网络状态
    window.electronAPI.backup.checkNetwork().then((isOnline) => {
      setBackupStatus(prev => ({ ...prev, networkStatus: isOnline }));
    });

    return () => {
      window.electronAPI.backup.removeProgressListener();
    };
  }, []);

  const handleBackupNow = async () => {
    if (!settings.backupServerUrl) {
      showMessage('error', 'Please configure backup server URL first');
      return;
    }

    try {
      setBackupStatus(prev => ({ ...prev, backingUp: true }));
      
      // 更新备份服务器URL
      await window.electronAPI.backup.updateSettings(settings.backupServerUrl);
      
      // 执行备份
      const result = await window.electronAPI.backup.performBackup();
      
      setBackupStatus(prev => ({
        ...prev,
        backingUp: false,
        lastBackup: new Date().toLocaleString()
      }));
      
      showMessage('success', result.message || 'Backup completed successfully');
    } catch (error) {
      console.error('Backup failed:', error);
      setBackupStatus(prev => ({ ...prev, backingUp: false }));
      showMessage('error', `Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCheckForUpdates = async () => {
    try {
      setUpdateStatus({ checking: true, available: false, downloading: false });
      const result = await window.electronAPI.update.checkForUpdates();
      
      if (result.available) {
        setUpdateStatus({
          checking: false,
          available: true,
          downloading: false,
          version: result.version,
          releaseNotes: result.releaseNotes,
          downloadUrl: result.downloadUrl
        });
        
        // 显示更新提示对话框
        const shouldUpdate = confirm(
          `A new version ${result.version} is available!\n\n${result.releaseNotes || 'Update available'}\n\nWould you like to download and install it now?`
        );
        
        if (shouldUpdate && result.downloadUrl) {
          setUpdateStatus(prev => ({
            ...prev,
            downloading: true,
            downloadProgress: { downloaded: 0, total: 0, percent: 0 }
          }));
          
          try {
            await window.electronAPI.update.downloadUpdate(result.downloadUrl);
            // 下载和安装已开始，应用将自动退出
            showMessage('success', 'Update downloaded. Installation will begin shortly...');
          } catch (error) {
            console.error('Failed to download update:', error);
            setUpdateStatus(prev => ({
              ...prev,
              downloading: false
            }));
            showMessage('error', `Failed to download update: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      } else {
        setUpdateStatus({
          checking: false,
          available: false,
          downloading: false
        });
        showMessage('success', 'You are using the latest version!');
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setUpdateStatus({ checking: false, available: false, downloading: false });
      showMessage('error', `Failed to check for updates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const resetSettings = async () => {
    if (confirm('Are you sure you want to reset all settings? This action cannot be undone.')) {
      try {
        await window.electronAPI.settings.resetSettings();
        await loadSettings();
        showMessage('success', 'Settings have been reset');
      } catch (error) {
        console.error('Failed to reset settings:', error);
        showMessage('error', 'Failed to reset settings');
      }
    }
  };

  const exportSettings = async () => {
    try {
      const settingsJson = await window.electronAPI.settings.exportSettings();
      const blob = new Blob([settingsJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'settings.json';
      a.click();
      URL.revokeObjectURL(url);
      showMessage('success', 'Settings exported successfully');
    } catch (error) {
      console.error('Failed to export settings:', error);
      showMessage('error', 'Failed to export settings');
    }
  };

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSettingChange = (key: keyof AppSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>System Settings</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>

        <div className="settings-content">
          <div className="settings-sidebar">
            <button 
              className={activeTab === 'general' ? 'active' : ''}
              onClick={() => setActiveTab('general')}
            >
              🏠 General Settings
            </button>
            <button 
              className={activeTab === 'devices' ? 'active' : ''}
              onClick={() => setActiveTab('devices')}
            >
              🔧 Device Management
            </button>
            <button 
              className={activeTab === 'sync' ? 'active' : ''}
              onClick={() => setActiveTab('sync')}
            >
              🔄 Data Sync
            </button>
            <button 
              className={activeTab === 'advanced' ? 'active' : ''}
              onClick={() => setActiveTab('advanced')}
            >
              ⚙️ Advanced Settings
            </button>
          </div>

          <div className="settings-main">
            {activeTab === 'general' && (
              <div className="settings-section">
                <h3>General Settings</h3>
                
                <div className="setting-group">
                  <label>Language Settings</label>
                  <select 
                    value={settings.language}
                    onChange={(e) => handleSettingChange('language', e.target.value)}
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="zh-TW">繁體中文</option>
                    <option value="en-US">English</option>
                    <option value="ja-JP">日本語</option>
                  </select>
                </div>

                <div className="setting-group">
                  <label>Theme Settings</label>
                  <select 
                    value={settings.theme}
                    onChange={(e) => handleSettingChange('theme', e.target.value)}
                  >
                    <option value="light">Light Theme</option>
                    <option value="dark">Dark Theme</option>
                    <option value="auto">Follow System</option>
                  </select>
                </div>

                <div className="setting-group">
                  <label>
                    <input 
                      type="checkbox"
                      checked={settings.notifications}
                      onChange={(e) => handleSettingChange('notifications', e.target.checked)}
                    />
                    Enable Notifications
                  </label>
                </div>

                <div className="setting-group">
                  <label>
                    <input 
                      type="checkbox"
                      checked={settings.autoSave}
                      onChange={(e) => handleSettingChange('autoSave', e.target.checked)}
                    />
                    Auto Save
                  </label>
                </div>

                <div className="setting-group" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #dee2e6' }}>
                  <h4 style={{ marginBottom: '1rem' }}>Update Settings</h4>
                  <label>
                    <input 
                      type="checkbox"
                      checked={settings.autoUpdateCheck}
                      onChange={(e) => handleSettingChange('autoUpdateCheck', e.target.checked)}
                    />
                    Automatically check for updates
                  </label>
                </div>

                {settings.autoUpdateCheck && (
                  <div className="setting-group">
                    <label>Check for updates every (hours)</label>
                    <input 
                      type="number"
                      value={settings.updateCheckInterval}
                      onChange={(e) => handleSettingChange('updateCheckInterval', parseInt(e.target.value) || 24)}
                      min="1"
                      max="168"
                      style={{ width: '100px', padding: '4px 8px', marginLeft: '8px' }}
                    />
                  </div>
                )}

                <div className="setting-group" style={{ marginTop: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={handleCheckForUpdates}
                      disabled={updateStatus.checking || updateStatus.downloading}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: (updateStatus.checking || updateStatus.downloading) ? '#6c757d' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: (updateStatus.checking || updateStatus.downloading) ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      {updateStatus.checking ? 'Checking...' : updateStatus.downloading ? 'Downloading...' : 'Check for Updates Now'}
                    </button>
                    {updateStatus.downloading && updateStatus.downloadProgress && (
                      <div style={{ marginTop: '10px', width: '100%' }}>
                        <div style={{ 
                          width: '100%', 
                          height: '20px', 
                          backgroundColor: '#e9ecef', 
                          borderRadius: '10px', 
                          overflow: 'hidden',
                          marginBottom: '5px'
                        }}>
                          <div style={{
                            width: `${updateStatus.downloadProgress.percent}%`,
                            height: '100%',
                            backgroundColor: '#007bff',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>
                        <div style={{ fontSize: '12px', color: '#666', textAlign: 'center' }}>
                          {updateStatus.downloadProgress.percent}% ({formatBytes(updateStatus.downloadProgress.downloaded)} / {formatBytes(updateStatus.downloadProgress.total)})
                        </div>
                      </div>
                    )}
                    {updateStatus.available && !updateStatus.downloading && (
                      <span style={{ color: '#28a745', fontWeight: '500', fontSize: '14px' }}>
                        ✓ New version {updateStatus.version} available!
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'devices' && (
              <div className="settings-section">
                <h3>Device Management</h3>
                
                {isLoading ? (
                  <div className="loading">Loading devices...</div>
                ) : (
                  <>
                    {/* Camera devices */}
                    <div className="device-category">
                      <div className="device-category-header">
                        <h4 className="device-category-title">
                          <span className="device-category-icon">📷</span>
                          Camera
                        </h4>
                        <button 
                          onClick={() => refreshDeviceType('camera')}
                          className="refresh-device-btn"
                          disabled={isLoading}
                        >
                          🔄 Refresh
                        </button>
                      </div>
                      <div className="device-list">
                        {devices.filter(d => d.type === 'camera').length === 0 ? (
                          <div className="no-devices-in-category">
                            <p>No camera device detected</p>
                          </div>
                        ) : (
                          devices.filter(d => d.type === 'camera').map(device => (
                            <div key={device.id} className="device-item">
                              <div className="device-info">
                                <div className="device-name">{device.name}</div>
                                <div className={`device-status ${device.status}`}>
                                  {device.status === 'connected' ? 'Connected' : 
                                   device.status === 'disconnected' ? 'Disconnected' : 'Error'}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Fingerprint scanner devices */}
                    <div className="device-category">
                      <div className="device-category-header">
                        <h4 className="device-category-title">
                          <span className="device-category-icon">👆</span>
                          Fingerprint Scanner
                        </h4>
                        <button 
                          onClick={() => refreshDeviceType('fingerprint')}
                          className="refresh-device-btn"
                          disabled={isLoading}
                        >
                          🔄 Refresh
                        </button>
                      </div>
                      <div className="device-list">
                        {devices.filter(d => d.type === 'fingerprint').length === 0 ? (
                          <div className="no-devices-in-category">
                            <p>No fingerprint scanner device detected</p>
                          </div>
                        ) : (
                          devices.filter(d => d.type === 'fingerprint').map(device => (
                            <div key={device.id} className="device-item">
                              <div className="device-info">
                                <div className="device-name">{device.name}</div>
                                <div className={`device-status ${device.status}`}>
                                  {device.status === 'connected' ? 'Connected' : 
                                   device.status === 'disconnected' ? 'Disconnected' : 'Error'}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Handwriting tablet devices */}
                    <div className="device-category">
                      <div className="device-category-header">
                        <h4 className="device-category-title">
                          <span className="device-category-icon">✍️</span>
                          Handwriting Tablet
                        </h4>
                        <button 
                          onClick={() => refreshDeviceType('tablet')}
                          className="refresh-device-btn"
                          disabled={isLoading}
                        >
                          🔄 Refresh
                        </button>
                      </div>
                      <div className="device-list">
                        {devices.filter(d => d.type === 'tablet').length === 0 ? (
                          <div className="no-devices-in-category">
                            <p>No handwriting tablet device detected</p>
                          </div>
                        ) : (
                          devices.filter(d => d.type === 'tablet').map(device => (
                            <div key={device.id} className="device-item">
                              <div className="device-info">
                                <div className="device-name">{device.name}</div>
                                <div className={`device-status ${device.status}`}>
                                  {device.status === 'connected' ? 'Connected' : 
                                   device.status === 'disconnected' ? 'Disconnected' : 'Error'}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Weighing scale devices */}
                    <div className="device-category">
                      <div className="device-category-header">
                        <h4 className="device-category-title">
                          <span className="device-category-icon">⚖️</span>
                          Weighing Scale
                        </h4>
                        <button 
                          onClick={() => refreshDeviceType('scale')}
                          className="refresh-device-btn"
                          disabled={isLoading}
                        >
                          🔄 Refresh
                        </button>
                      </div>
                      <div className="device-list">
                        {devices.filter(d => d.type === 'scale').length === 0 ? (
                          <div className="no-devices-in-category">
                            <p>No weighing scale device detected</p>
                          </div>
                        ) : (
                          devices.filter(d => d.type === 'scale').map(device => (
                            <div key={device.id} className="device-item">
                              <div className="device-info">
                                <div className="device-name">{device.name}</div>
                                <div className={`device-status ${device.status}`}>
                                  {device.status === 'connected' ? 'Connected' : 
                                   device.status === 'disconnected' ? 'Disconnected' : 'Error'}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Invoice printer devices */}
                    <div className="device-category">
                      <div className="device-category-header">
                        <h4 className="device-category-title">
                          <span className="device-category-icon">🖨️</span>
                          Invoice Printer
                        </h4>
                        <button 
                          onClick={() => refreshDeviceType('printer')}
                          className="refresh-device-btn"
                          disabled={isLoading}
                        >
                          🔄 Refresh
                        </button>
                      </div>
                      <div className="device-list">
                        {devices.filter(d => d.type === 'printer').length === 0 ? (
                          <div className="no-devices-in-category">
                            <p>No invoice printer device detected</p>
                          </div>
                        ) : (
                          devices.filter(d => d.type === 'printer').map(device => (
                            <div key={device.id} className="device-item">
                              <div className="device-info">
                                <div className="device-name">{device.name}</div>
                                <div className={`device-status ${device.status}`}>
                                  {device.status === 'connected' ? 'Connected' : 
                                   device.status === 'disconnected' ? 'Disconnected' : 'Error'}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            
            {activeTab === 'sync' && (
              <div className="settings-section">
                <h3>Data Synchronization</h3>
                
                <div className="setting-group">
                  <p style={{ color: '#666', marginBottom: '20px' }}>
                    Synchronize data between devices on the same network or from the cloud server.
                  </p>
                  
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    <button
                      onClick={async () => {
                        setSyncStatus(prev => ({ ...prev, syncing: true }));
                        try {
                          const result = await (window.electronAPI as any).sync.performAutoSync();
                          if (result.success) {
                            setMessage({ type: 'success', text: `Sync completed: ${result.syncedRecords} records synced` });
                            setSyncStatus(prev => ({ ...prev, lastSync: new Date().toISOString(), syncing: false }));
                          } else {
                            setMessage({ type: 'error', text: `Sync failed: ${result.message}` });
                            setSyncStatus(prev => ({ ...prev, syncing: false }));
                          }
                        } catch (error) {
                          setMessage({ type: 'error', text: `Sync error: ${error instanceof Error ? error.message : 'Unknown error'}` });
                          setSyncStatus(prev => ({ ...prev, syncing: false }));
                        }
                      }}
                      disabled={syncStatus.syncing}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#1976d2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: syncStatus.syncing ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      {syncStatus.syncing ? 'Syncing...' : '🔄 Auto Sync (Local Network or Cloud)'}
                    </button>
                    
                    <button
                      onClick={async () => {
                        setSyncStatus(prev => ({ ...prev, syncing: true }));
                        try {
                          const devices = await (window.electronAPI as any).sync.discoverDevices();
                          setSyncStatus(prev => ({ ...prev, discoveredDevices: devices, syncing: false }));
                          setMessage({ type: 'success', text: `Found ${devices.length} device(s) on local network` });
                        } catch (error) {
                          setMessage({ type: 'error', text: `Discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}` });
                          setSyncStatus(prev => ({ ...prev, syncing: false }));
                        }
                      }}
                      disabled={syncStatus.syncing}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: syncStatus.syncing ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      🔍 Discover Local Devices
                    </button>
                    
                    <button
                      onClick={async () => {
                        setSyncStatus(prev => ({ ...prev, syncing: true }));
                        try {
                          const result = await (window.electronAPI as any).sync.syncFromCloud();
                          if (result.success) {
                            setMessage({ type: 'success', text: `Cloud sync completed: ${result.syncedRecords} records synced` });
                            setSyncStatus(prev => ({ ...prev, lastSync: new Date().toISOString(), syncing: false }));
                          } else {
                            setMessage({ type: 'error', text: `Cloud sync failed: ${result.message}` });
                            setSyncStatus(prev => ({ ...prev, syncing: false }));
                          }
                        } catch (error) {
                          setMessage({ type: 'error', text: `Cloud sync error: ${error instanceof Error ? error.message : 'Unknown error'}` });
                          setSyncStatus(prev => ({ ...prev, syncing: false }));
                        }
                      }}
                      disabled={syncStatus.syncing || !settings.backupServerUrl}
                      style={{
                        padding: '10px 20px',
                        backgroundColor: '#ff9800',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: (syncStatus.syncing || !settings.backupServerUrl) ? 'not-allowed' : 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        opacity: !settings.backupServerUrl ? 0.5 : 1
                      }}
                    >
                      ☁️ Sync from Cloud
                    </button>
                  </div>
                  
                  {syncStatus.progress && (
                    <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '5px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontWeight: '500' }}>{syncStatus.progress.message}</span>
                        <span style={{ color: '#666' }}>{syncStatus.progress.progress}%</span>
                      </div>
                      <div style={{ width: '100%', height: '8px', backgroundColor: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${syncStatus.progress.progress}%`,
                            height: '100%',
                            backgroundColor: '#1976d2',
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </div>
                      {syncStatus.progress.syncedRecords !== undefined && (
                        <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                          Synced: {syncStatus.progress.syncedRecords} / {syncStatus.progress.totalRecords || '?'} records
                        </div>
                      )}
                    </div>
                  )}
                  
                  {syncStatus.discoveredDevices && syncStatus.discoveredDevices.length > 0 && (
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={{ marginBottom: '10px' }}>Discovered Devices ({syncStatus.discoveredDevices.length})</h4>
                      {syncStatus.discoveredDevices.map((device) => (
                        <div
                          key={device.id}
                          style={{
                            padding: '15px',
                            marginBottom: '10px',
                            border: '1px solid #e0e0e0',
                            borderRadius: '5px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: '500' }}>{device.name}</div>
                            <div style={{ fontSize: '12px', color: '#666' }}>
                              {device.ip}:{device.port}
                              {device.lastSyncTime && ` • Last sync: ${new Date(device.lastSyncTime).toLocaleString()}`}
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              setSyncStatus(prev => ({ ...prev, syncing: true }));
                              try {
                                const result = await (window.electronAPI as any).sync.syncWithDevice(device);
                                if (result.success) {
                                  setMessage({ type: 'success', text: `Sync with ${device.name} completed: ${result.syncedRecords} records synced` });
                                  setSyncStatus(prev => ({ ...prev, lastSync: new Date().toISOString(), syncing: false }));
                                } else {
                                  setMessage({ type: 'error', text: `Sync failed: ${result.message}` });
                                  setSyncStatus(prev => ({ ...prev, syncing: false }));
                                }
                              } catch (error) {
                                setMessage({ type: 'error', text: `Sync error: ${error instanceof Error ? error.message : 'Unknown error'}` });
                                setSyncStatus(prev => ({ ...prev, syncing: false }));
                              }
                            }}
                            disabled={syncStatus.syncing}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#1976d2',
                              color: 'white',
                              border: 'none',
                              borderRadius: '5px',
                              cursor: syncStatus.syncing ? 'not-allowed' : 'pointer',
                              fontSize: '12px'
                            }}
                          >
                            Sync Now
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {syncStatus.lastSync && (
                    <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#e8f5e9', borderRadius: '5px', fontSize: '12px', color: '#2e7d32' }}>
                      ✓ Last sync: {new Date(syncStatus.lastSync).toLocaleString()}
                    </div>
                  )}
                  
                  {!settings.backupServerUrl && (
                    <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '5px', fontSize: '12px', color: '#856404' }}>
                      ⚠️ Cloud sync requires a backup server URL. Configure it in Advanced Settings.
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {activeTab === 'advanced' && (
              <div className="settings-section">
                <h3>Advanced Settings</h3>
                
                <div className="setting-group">
                  <label>Data Retention (Days)</label>
                  <input 
                    type="number"
                    value={settings.dataRetention}
                    onChange={(e) => handleSettingChange('dataRetention', parseInt(e.target.value))}
                    min="1"
                    max="3650"
                  />
                </div>

                <div className="setting-group">
                  <label>
                    <input 
                      type="checkbox"
                      checked={settings.backupEnabled}
                      onChange={(e) => handleSettingChange('backupEnabled', e.target.checked)}
                    />
                    Enable Auto Backup
                  </label>
                </div>

                {settings.backupEnabled && (
                  <>
                    <div className="setting-group">
                      <label>Backup Server URL</label>
                      <input 
                        type="text"
                        value={settings.backupServerUrl || ''}
                        onChange={(e) => {
                          handleSettingChange('backupServerUrl', e.target.value);
                          // 更新备份服务配置
                          window.electronAPI.backup.updateSettings(e.target.value);
                        }}
                        placeholder="https://your-backup-server.com/api"
                        style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                      />
                      <small style={{ color: '#666', fontSize: '12px', display: 'block', marginTop: '5px' }}>
                        Enter the URL of your backup server API endpoint
                      </small>
                    </div>

                    <div className="setting-group">
                      <label>Backup Interval (Hours)</label>
                      <input 
                        type="number"
                        value={settings.backupInterval}
                        onChange={(e) => handleSettingChange('backupInterval', parseInt(e.target.value))}
                        min="1"
                        max="168"
                      />
                    </div>

                    <div className="setting-group" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #dee2e6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={handleBackupNow}
                          disabled={backupStatus.backingUp || !settings.backupServerUrl}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: (backupStatus.backingUp || !settings.backupServerUrl) ? '#6c757d' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: (backupStatus.backingUp || !settings.backupServerUrl) ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '500'
                          }}
                        >
                          {backupStatus.backingUp ? 'Backing up...' : 'Backup Now'}
                        </button>
                        
                        {backupStatus.networkStatus !== undefined && (
                          <span style={{ 
                            color: backupStatus.networkStatus ? '#28a745' : '#dc3545',
                            fontSize: '14px'
                          }}>
                            {backupStatus.networkStatus ? '✓ Network Available' : '✗ Network Unavailable'}
                          </span>
                        )}

                        {backupStatus.lastBackup && (
                          <span style={{ color: '#666', fontSize: '12px' }}>
                            Last backup: {backupStatus.lastBackup}
                          </span>
                        )}
                      </div>

                      {backupStatus.backingUp && backupStatus.progress && (
                        <div style={{ marginTop: '10px', width: '100%' }}>
                          <div style={{ 
                            width: '100%', 
                            height: '20px', 
                            backgroundColor: '#e9ecef', 
                            borderRadius: '10px', 
                            overflow: 'hidden',
                            marginBottom: '5px'
                          }}>
                            <div style={{
                              width: `${backupStatus.progress.progress}%`,
                              height: '100%',
                              backgroundColor: '#28a745',
                              transition: 'width 0.3s ease'
                            }} />
                          </div>
                          <div style={{ fontSize: '12px', color: '#666', textAlign: 'center' }}>
                            {backupStatus.progress.message} ({backupStatus.progress.progress}%)
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <div className="settings-actions">
                  <button onClick={exportSettings} className="export-btn">
                    📤 Export Settings
                  </button>
                  <button onClick={resetSettings} className="reset-btn">
                    🔄 Reset Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-footer">
          {message && (
            <div className={`message ${message.type}`}>
              {message.text}
            </div>
          )}
          <div className="footer-actions">
            <button onClick={onClose} className="cancel-btn">
              Cancel
            </button>
            <button onClick={saveSettings} className="save-btn">
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
