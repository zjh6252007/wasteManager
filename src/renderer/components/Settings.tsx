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
  defaultCamera?: string;
  defaultFingerprint?: string;
  defaultPrinter?: string;
  autoUpdateCheck: boolean;
  updateCheckInterval: number;
}

interface CompanySettings {
  companyName: string;
  address: string;
  city: string;
  zipCode: string;
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
  const [activeTab, setActiveTab] = useState<'general' | 'devices' | 'account' | 'company'>('general');
  const [settings, setSettings] = useState<AppSettings>({
    language: 'en-US',
    theme: 'light',
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
  const [showUpdateConfirm, setShowUpdateConfirm] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    companyName: '',
    address: '',
    city: '',
    zipCode: ''
  });
  
  useEffect(() => {
    loadSettings();
    loadDevices();
    loadCompanySettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settingsData = await window.electronAPI.settings.getSettings();
      setSettings(settingsData);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadCompanySettings = async () => {
    try {
      const settingsData = await window.electronAPI.settings.getSettings();
      setCompanySettings({
        companyName: settingsData.companyName || '',
        address: settingsData.address || '',
        city: settingsData.city || '',
        zipCode: settingsData.zipCode || ''
      });
    } catch (error) {
      console.error('Failed to load company settings:', error);
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

  // Test SigWeb Service
  const testSigWebService = async () => {
    try {
      console.log('[Settings] Testing SigWeb Service...');
      
      // Check if SigWeb is installed directly from window (SigWebTablet.js is loaded in renderer)
      let sigWebInstalled = false;
      let sigWebVersion = '';
      
      if (typeof (window as any).IsSigWebInstalled === 'function') {
        try {
          sigWebInstalled = (window as any).IsSigWebInstalled();
          console.log(`[Settings] SigWeb installed: ${sigWebInstalled}`);
          
          if (sigWebInstalled && typeof (window as any).GetSigWebVersion === 'function') {
            sigWebVersion = (window as any).GetSigWebVersion();
            console.log(`[Settings] SigWeb version: ${sigWebVersion}`);
          }
        } catch (error) {
          console.error('[Settings] Error checking SigWeb:', error);
        }
      } else {
        console.warn('[Settings] IsSigWebInstalled function not found - SigWebTablet.js may not be loaded');
      }
      
      if (sigWebInstalled) {
        showMessage('success', `SigWeb Service is running! Version: ${sigWebVersion || 'unknown'}`);
      } else {
        showMessage('error', 'SigWeb Service is not running or not installed. Please check if SigWeb Service is running on ports 47289/47290.');
      }
    } catch (error) {
      console.error('[Settings] SigWeb test failed:', error);
      showMessage('error', `Failed to test SigWeb: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Refresh devices of a specific type
  const refreshDeviceType = async (deviceType: DeviceInfo['type']) => {
    try {
      // Set loading state only for this specific device type
      setIsLoading(true);
      console.log(`[Settings] Refreshing ${deviceType} devices...`);
      
      // For tablet devices, check SigWeb first
      if (deviceType === 'tablet') {
        try {
          // Check SigWeb directly from window (SigWebTablet.js is loaded in renderer)
          let sigWebInstalled = false;
          let sigWebVersion = '';
          
          if (typeof (window as any).IsSigWebInstalled === 'function') {
            try {
              sigWebInstalled = (window as any).IsSigWebInstalled();
              console.log(`[Settings] SigWeb installed: ${sigWebInstalled}`);
              
              if (sigWebInstalled && typeof (window as any).GetSigWebVersion === 'function') {
                sigWebVersion = (window as any).GetSigWebVersion();
                console.log(`[Settings] SigWeb version: ${sigWebVersion}`);
              }
            } catch (error) {
              console.warn(`[Settings] SigWeb check failed:`, error);
            }
          }
          
          if (sigWebInstalled) {
            
            // If SigWeb is installed, add it as a detected device
            const sigWebDevice: DeviceInfo = {
              id: 'sigweb_tablet',
              name: `SigWeb Signature Pad (v${sigWebVersion})`,
              type: 'tablet',
              status: 'connected',
              details: {
                sigWebInstalled: true,
                version: sigWebVersion
              }
            };
            
            // Still get hardware devices, but add SigWeb device first
            const timeoutDuration = 30000;
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Device loading timeout after ${timeoutDuration}ms`)), timeoutDuration)
            );
            
            console.log(`[Settings] Calling getDevices for ${deviceType}...`);
            let hardwareDevices: DeviceInfo[] = [];
            try {
              hardwareDevices = await Promise.race([
                window.electronAPI.settings.getDevices(deviceType),
                timeoutPromise
              ]) as DeviceInfo[];
            } catch (error) {
              console.warn(`[Settings] Hardware device detection failed, but SigWeb is available:`, error);
            }
            
            // Combine SigWeb device with hardware devices
            const devicesData = [sigWebDevice, ...hardwareDevices];
            console.log(`[Settings] Received ${devicesData.length} ${deviceType} devices (including SigWeb):`, devicesData);
            
            setDevices(prevDevices => {
              const otherDevices = prevDevices.filter(d => d.type !== deviceType);
              return [...otherDevices, ...devicesData];
            });
            return;
          }
        } catch (error) {
          console.warn(`[Settings] SigWeb check failed:`, error);
          // Continue with hardware detection
        }
      }
      
      // Increase timeout for tablet devices (they may take longer to detect)
      const timeoutDuration = deviceType === 'tablet' ? 30000 : 10000;
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Device loading timeout after ${timeoutDuration}ms`)), timeoutDuration)
      );
      
      // Only get devices of the specific type
      console.log(`[Settings] Calling getDevices for ${deviceType}...`);
      const devicesData = await Promise.race([
        window.electronAPI.settings.getDevices(deviceType),
        timeoutPromise
      ]) as DeviceInfo[];
      
      console.log(`[Settings] Received ${devicesData.length} ${deviceType} devices:`, devicesData);
      
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
    setIsSaving(true);
    try {
      // Save app settings
      await window.electronAPI.settings.saveSettings(settings);
      // Save company settings
      await window.electronAPI.settings.saveSettings({
        companyName: companySettings.companyName,
        address: companySettings.address,
        city: companySettings.city,
        zipCode: companySettings.zipCode
      });
      showMessage('success', 'Settings saved successfully!');
    } catch (error) {
      console.error('Failed to save settings:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error details:', errorMessage);
      showMessage('error', `Failed to save settings: ${errorMessage}`);
    } finally {
      setIsSaving(false);
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
        
        // 显示自定义更新确认弹窗
        setShowUpdateConfirm(true);
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
      
      // Provide more user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
        showMessage('error', 'Update server not configured. Please contact your administrator.');
      } else {
        showMessage('error', `Failed to check for updates: ${errorMessage}`);
      }
    }
  };

  const handleConfirmUpdate = async () => {
    if (!updateStatus.downloadUrl) return;
    
    setShowUpdateConfirm(false);
    
    setUpdateStatus(prev => ({
      ...prev,
      downloading: true,
      downloadProgress: { downloaded: 0, total: 0, percent: 0 }
    }));
    
    // 显示开始下载的提示
    showMessage('info', 'Starting download... The application will automatically restart after installation.');
    
    try {
      await window.electronAPI.update.downloadUpdate(updateStatus.downloadUrl);
      // 下载完成，安装已开始，应用将自动退出并重启
      showMessage('success', 'Update downloaded. Installation in progress. The application will restart automatically...');
      // 给用户一点时间看到消息
      setTimeout(() => {
        // 应用会在 installUpdate 中自动退出
      }, 1000);
    } catch (error) {
      console.error('Failed to download update:', error);
      setUpdateStatus(prev => ({
        ...prev,
        downloading: false
      }));
      showMessage('error', `Failed to download update: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCancelUpdate = () => {
    setShowUpdateConfirm(false);
  };

  const showMessage = (type: 'success' | 'error' | 'info', text: string) => {
    setMessage({ type: type === 'info' ? 'success' : type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // Change Password Form Component
  const ChangePasswordForm: React.FC = () => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isChanging, setIsChanging] = useState(false);
    const [changePasswordMessage, setChangePasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleChangePassword = async () => {
      // 验证输入
      if (!currentPassword) {
        setChangePasswordMessage({ type: 'error', text: 'Please enter your current password' });
        return;
      }

      if (!newPassword) {
        setChangePasswordMessage({ type: 'error', text: 'Please enter a new password' });
        return;
      }

      if (newPassword.length < 6) {
        setChangePasswordMessage({ type: 'error', text: 'New password must be at least 6 characters long' });
        return;
      }

      if (newPassword !== confirmPassword) {
        setChangePasswordMessage({ type: 'error', text: 'New password and confirm password do not match' });
        return;
      }

      if (currentPassword === newPassword) {
        setChangePasswordMessage({ type: 'error', text: 'New password must be different from current password' });
        return;
      }

      setIsChanging(true);
      setChangePasswordMessage(null);

      try {
        const result = await (window.electronAPI as any).auth.changePassword(currentPassword, newPassword);
        
        if (result.success) {
          setChangePasswordMessage({ type: 'success', text: result.message || 'Password changed successfully!' });
          // 清空表单
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          // 3秒后清除成功消息
          setTimeout(() => setChangePasswordMessage(null), 3000);
        } else {
          setChangePasswordMessage({ type: 'error', text: result.message || 'Failed to change password' });
        }
      } catch (error: any) {
        console.error('Failed to change password:', error);
        setChangePasswordMessage({ type: 'error', text: `Failed to change password: ${error.message || 'Unknown error'}` });
      } finally {
        setIsChanging(false);
      }
    };

    return (
      <div className="setting-group" style={{ maxWidth: '500px' }}>
        <div className="setting-group" style={{ marginBottom: '1.5rem' }}>
          <label>Current Password</label>
          <input 
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter your current password"
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            disabled={isChanging}
          />
        </div>

        <div className="setting-group" style={{ marginBottom: '1.5rem' }}>
          <label>New Password</label>
          <input 
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password (at least 6 characters)"
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            disabled={isChanging}
          />
          <small style={{ color: '#666', fontSize: '12px', display: 'block', marginTop: '5px' }}>
            Password must be at least 6 characters long
          </small>
        </div>

        <div className="setting-group" style={{ marginBottom: '1.5rem' }}>
          <label>Confirm New Password</label>
          <input 
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
            disabled={isChanging}
          />
        </div>

        {changePasswordMessage && (
          <div 
            style={{ 
              padding: '10px', 
              marginBottom: '1rem',
              borderRadius: '4px',
              backgroundColor: changePasswordMessage.type === 'success' ? '#d4edda' : '#f8d7da',
              color: changePasswordMessage.type === 'success' ? '#155724' : '#721c24',
              border: `1px solid ${changePasswordMessage.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`
            }}
          >
            {changePasswordMessage.text}
          </div>
        )}

        <div className="setting-group">
          <button
            onClick={handleChangePassword}
            disabled={isChanging}
            style={{
              padding: '10px 20px',
              backgroundColor: isChanging ? '#6c757d' : '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isChanging ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500'
            }}
          >
            {isChanging ? (
              <>
                <span className="spinner"></span>
                Changing Password...
              </>
            ) : (
              'Change Password'
            )}
          </button>
        </div>
      </div>
    );
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
              className={activeTab === 'company' ? 'active' : ''}
              onClick={() => setActiveTab('company')}
            >
              🏢 Company Settings
            </button>
            <button 
              className={activeTab === 'account' ? 'active' : ''}
              onClick={() => setActiveTab('account')}
            >
              👤 Account Settings
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
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={testSigWebService}
                            className="refresh-device-btn"
                            style={{ 
                              backgroundColor: '#28a745',
                              fontSize: '12px',
                              padding: '6px 12px'
                            }}
                            title="Test SigWeb Service connection"
                          >
                            🧪 Test SigWeb
                          </button>
                          <button 
                            onClick={() => refreshDeviceType('tablet')}
                            className="refresh-device-btn"
                            disabled={isLoading}
                          >
                            🔄 Refresh
                          </button>
                        </div>
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
                            <div key={device.id} className="device-item" style={{ 
                              border: settings.defaultPrinter === device.id ? '2px solid #007bff' : '1px solid #dee2e6',
                              backgroundColor: settings.defaultPrinter === device.id ? '#f0f7ff' : 'white'
                            }}>
                              <div className="device-info" style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <div className="device-name">{device.name}</div>
                                  {settings.defaultPrinter === device.id && (
                                    <span style={{ 
                                      fontSize: '11px', 
                                      backgroundColor: '#007bff', 
                                      color: 'white', 
                                      padding: '2px 8px', 
                                      borderRadius: '10px',
                                      fontWeight: '500'
                                    }}>
                                      Default
                                    </span>
                                  )}
                                  {device.details?.isDefault && settings.defaultPrinter !== device.id && (
                                    <span style={{ 
                                      fontSize: '11px', 
                                      backgroundColor: '#6c757d', 
                                      color: 'white', 
                                      padding: '2px 8px', 
                                      borderRadius: '10px',
                                      fontWeight: '500'
                                    }}>
                                      System Default
                                    </span>
                                  )}
                                </div>
                                <div className={`device-status ${device.status}`}>
                                  {device.status === 'connected' ? 'Connected' : 
                                   device.status === 'disconnected' ? 'Disconnected' : 'Error'}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  handleSettingChange('defaultPrinter', device.id);
                                  showMessage('success', `Set "${device.name}" as default printer`);
                                }}
                                style={{
                                  padding: '6px 12px',
                                  backgroundColor: settings.defaultPrinter === device.id ? '#6c757d' : '#007bff',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                  fontWeight: '500',
                                  whiteSpace: 'nowrap',
                                  marginLeft: '10px'
                                }}
                                disabled={settings.defaultPrinter === device.id}
                                title={settings.defaultPrinter === device.id ? 'Already set as default' : 'Set as default printer'}
                              >
                                {settings.defaultPrinter === device.id ? '✓ Default' : 'Set as Default'}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            
            {activeTab === 'company' && (
              <div className="settings-section">
                <h3>Company Settings</h3>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Configure your company information. These settings will be used in reports and receipts.
                </p>
                
                <div className="setting-group">
                  <label>Company Name</label>
                  <input 
                    type="text"
                    value={companySettings.companyName}
                    onChange={(e) => setCompanySettings(prev => ({ ...prev, companyName: e.target.value }))}
                    placeholder="Enter company name"
                    style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                  />
                </div>

                <div className="setting-group">
                  <label>Address</label>
                  <input 
                    type="text"
                    value={companySettings.address}
                    onChange={(e) => setCompanySettings(prev => ({ ...prev, address: e.target.value }))}
                    placeholder="Enter street address"
                    style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                  />
                </div>

                <div className="setting-group">
                  <label>City</label>
                  <input 
                    type="text"
                    value={companySettings.city}
                    onChange={(e) => setCompanySettings(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="Enter city"
                    style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                  />
                </div>

                <div className="setting-group">
                  <label>Zip Code</label>
                  <input 
                    type="text"
                    value={companySettings.zipCode}
                    onChange={(e) => setCompanySettings(prev => ({ ...prev, zipCode: e.target.value }))}
                    placeholder="Enter zip code"
                    style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                  />
                </div>
              </div>
            )}
            
            {activeTab === 'account' && (
              <div className="settings-section">
                <h3>Account Settings</h3>
                <p style={{ color: '#666', marginBottom: '20px' }}>
                  Change your account password. You need to enter your current password to proceed.
                </p>
                
                <ChangePasswordForm />
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
            <button 
              onClick={saveSettings} 
              className="save-btn"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <span className="spinner"></span>
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 自定义更新确认弹窗 */}
      {showUpdateConfirm && (
        <div className="update-confirm-overlay" onClick={handleCancelUpdate}>
          <div className="update-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Update Available</h3>
            <p>
              A new version <strong>{updateStatus.version}</strong> is available!
            </p>
            {updateStatus.releaseNotes && (
              <div className="release-notes">
                <strong>Release Notes:</strong>
                <pre>{updateStatus.releaseNotes}</pre>
              </div>
            )}
            <p>
              Would you like to download and install it now?
            </p>
            <p className="update-warning">
              The application will automatically restart after installation.
            </p>
            <div className="update-confirm-actions">
              <button 
                onClick={handleCancelUpdate}
                className="cancel-btn"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmUpdate}
                className="confirm-btn"
              >
                Download & Install
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
