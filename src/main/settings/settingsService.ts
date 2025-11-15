import { repo } from '../db/connection';
import { BrowserWindow } from 'electron';
import { CameraService } from '../camera/cameraService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DeviceInfo {
  id: string;
  name: string;
  type: 'camera' | 'fingerprint' | 'tablet' | 'scale' | 'printer';
  status: 'connected' | 'disconnected' | 'error';
  details?: any;
}

export interface AppSettings {
  language: string;
  theme: 'light' | 'dark' | 'auto';
  notifications: boolean;
  autoSave: boolean;
  defaultCamera?: string;
  defaultFingerprint?: string;
  dataRetention: number; // days
  backupEnabled: boolean;
  backupInterval: number; // hours
  backupServerUrl?: string;
}

export class SettingsService {
  private activationId: number;
  private mainWindow: BrowserWindow | null;

  constructor(activationId: number, mainWindow?: BrowserWindow | null) {
    this.activationId = activationId;
    this.mainWindow = mainWindow || null;
  }

  /**
   * 获取应用设置
   */
  async getSettings(): Promise<AppSettings> {
    const settings = repo.userSettings.getAll(this.activationId);
    
    return {
      language: settings.language || 'en-US',
      theme: (settings.theme as any) || 'light',
      notifications: settings.notifications === 'true',
      autoSave: settings.autoSave === 'true',
      defaultCamera: settings.defaultCamera,
      defaultFingerprint: settings.defaultFingerprint,
      dataRetention: parseInt(settings.dataRetention) || 365,
      backupEnabled: settings.backupEnabled === 'true',
      backupInterval: parseInt(settings.backupInterval) || 24,
      backupServerUrl: settings.backupServerUrl || 'https://backup-server-1378.azurewebsites.net/backup/upload'
    };
  }

  /**
   * 保存应用设置
   */
  async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        repo.userSettings.set(this.activationId, key, String(value));
      }
    }
  }

  /**
   * 获取设备列表
   */
  async getDevices(deviceType?: DeviceInfo['type']): Promise<DeviceInfo[]> {
    const devices: DeviceInfo[] = [];
    
    try {
      // 如果指定了设备类型，只获取该类型的设备
      if (deviceType) {
        switch (deviceType) {
          case 'camera':
            return await this.getCameraDevices();
          case 'fingerprint':
            return await this.getFingerprintDevices();
          case 'tablet':
            return await this.getTabletDevices();
          case 'scale':
            return await this.getScaleDevices();
          case 'printer':
            return await this.getPrinterDevices();
          default:
            return [];
        }
      }
      
      // 获取所有设备
      // 获取真实摄像头设备
      const cameraDevices = await this.getCameraDevices();
      devices.push(...cameraDevices);
      
      // 获取真实指纹板设备
      const fingerprintDevices = await this.getFingerprintDevices();
      devices.push(...fingerprintDevices);
      
      // 获取手写板设备
      const tabletDevices = await this.getTabletDevices();
      devices.push(...tabletDevices);
      
      // 获取过磅秤设备
      const scaleDevices = await this.getScaleDevices();
      devices.push(...scaleDevices);
      
      // 获取开发票机器设备
      const printerDevices = await this.getPrinterDevices();
      devices.push(...printerDevices);
    } catch (error) {
      console.error('Failed to get device list:', error);
    }
    
    return devices;
  }

  /**
   * 获取摄像头设备
   */
  private async getCameraDevices(): Promise<DeviceInfo[]> {
    try {
      // 如果有主窗口，使用CameraService来获取设备
      if (this.mainWindow) {
        try {
          const cameraService = new CameraService(this.mainWindow);
          console.log('SettingsService: 开始获取摄像头设备...');
          const devices = await Promise.race([
            cameraService.getCameraDevices(),
            new Promise<MediaDeviceInfo[]>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 6000)
            )
          ]);
          
          console.log('SettingsService: 收到设备列表，数量:', devices?.length || 0);
          
          const result = devices
            .filter(device => device.kind === 'videoinput')
            .map(device => ({
              id: device.deviceId,
              name: device.label || `Camera ${device.deviceId.slice(0, 8)}`,
              type: 'camera' as const,
              status: 'connected' as const,
              details: {
                groupId: device.groupId,
                kind: device.kind
              }
            }));
          
          console.log('SettingsService: 转换后的设备列表:', result);
          return result;
        } catch (error) {
          console.error('Failed to get camera devices via CameraService:', error);
          // 如果通过CameraService获取失败，返回空数组而不是抛出错误
          return [];
        }
      }
      
      // 如果没有主窗口，返回空数组
      return [];
    } catch (error) {
      console.error('Failed to get camera devices:', error);
      return [];
    }
  }

  /**
   * 获取指纹板设备
   */
  private async getFingerprintDevices(): Promise<DeviceInfo[]> {
    try {
      const deviceList: DeviceInfo[] = [];
      
      // 首先尝试检测Windows Biometric Framework设备
      try {
        const { WindowsBiometricService } = await import('../fingerprint/windowsBiometric');
        const wbfDevices = await WindowsBiometricService.detectDevices();
        
        for (const device of wbfDevices) {
          let status: 'connected' | 'disconnected' | 'error' = 'connected';
          if (device.status === 'OK') {
            status = 'connected';
          } else if (device.status === 'Error') {
            status = 'error';
          } else {
            status = 'disconnected';
          }
          
          deviceList.push({
            id: device.id,
            name: device.name,
            type: 'fingerprint' as const,
            status: status,
            details: {
              type: 'Windows Biometric Framework',
              status: device.status
            }
          });
        }
      } catch (error) {
        console.error('Failed to detect WBF devices:', error);
      }
      
      // 然后尝试检测USB指纹设备
      try {
        const { FingerprintHardware } = await import('../fingerprint/fingerprintHardware');
        const usbDevices = await FingerprintHardware.detectDevices();
        
        for (const device of usbDevices) {
          deviceList.push({
            id: device.id,
            name: device.product || device.manufacturer || 'Unknown Fingerprint Device',
            type: 'fingerprint' as const,
            status: 'connected' as const,
            details: {
              vendorId: device.vendorId,
              productId: device.productId,
              manufacturer: device.manufacturer,
              serialNumber: device.serialNumber,
              type: 'USB'
            }
          });
        }
        
        // 如果没有检测到已知设备，尝试列出所有USB设备以便调试
        if (usbDevices.length === 0 && deviceList.length === 0) {
          console.log('No known fingerprint devices found, listing all USB devices for debugging...');
          try {
            const allDevices = await FingerprintHardware.listAllUsbDevices();
            console.log('All USB devices:', allDevices);
            
            // 返回所有HID设备作为可能的指纹设备
            const { BrowserWindow } = await import('electron');
            const mainWindow = BrowserWindow.getAllWindows()[0];
            if (mainWindow) {
              mainWindow.webContents.send('fingerprint:debug-usb-devices', allDevices);
            }
          } catch (error) {
            console.error('Failed to list USB devices:', error);
          }
        }
      } catch (error) {
        console.error('Failed to detect USB fingerprint devices:', error);
      }
      
      return deviceList;
    } catch (error) {
      console.error('Failed to get fingerprint devices:', error);
      return [];
    }
  }

  /**
   * 获取手写板设备
   * 支持所有Windows即插即用的手写板设备
   */
  private async getTabletDevices(): Promise<DeviceInfo[]> {
    try {
      const devices: DeviceInfo[] = [];
      const deviceIds = new Set<string>(); // 用于去重
      
      console.log('开始检测手写板设备...');
      
      // 方法1: 检测所有Digitizer类设备（最常见的手写板类型）
      // 不依赖设备名称，只要是Digitizer类就认为是手写板
      try {
        console.log('检测所有Digitizer类设备...');
        const { stdout: digitizerOutput } = await execAsync(
          `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'Digitizer'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
        );
        
        if (digitizerOutput && digitizerOutput.trim()) {
          try {
            const digitizerList = JSON.parse(digitizerOutput);
            const digitizerArray = Array.isArray(digitizerList) ? digitizerList : [digitizerList];
            
            console.log(`找到 ${digitizerArray.length} 个Digitizer设备`);
            
            for (const device of digitizerArray) {
              if (device && (device.Status === 'OK' || device.Status === 'Started' || device.Status === 'Error')) {
                const instanceId = device.InstanceId || `tablet_${devices.length}`;
                if (!deviceIds.has(instanceId)) {
                  const friendlyName = device.FriendlyName || 'Handwriting Tablet';
                  console.log(`检测到数字化仪设备: ${friendlyName} (状态: ${device.Status})`);
                  devices.push({
                    id: instanceId,
                    name: friendlyName,
                    type: 'tablet' as const,
                    status: device.Status === 'OK' || device.Status === 'Started' ? 'connected' as const : 'disconnected' as const,
                    details: {
                      instanceId: device.InstanceId,
                      status: device.Status
                    }
                  });
                  deviceIds.add(instanceId);
                }
              }
            }
          } catch (parseError) {
            console.log('解析Digitizer设备JSON失败:', parseError);
            console.log('原始输出:', digitizerOutput.substring(0, 500));
          }
        } else {
          console.log('未找到Digitizer类设备');
        }
      } catch (digitizerError: any) {
        console.log('Digitizer检测失败:', digitizerError.message || digitizerError);
      }
      
      // 方法2: 检测USB设备中的手写板
      // 很多手写板通过USB连接，检测USB设备
      try {
        console.log('检测USB设备中的手写板...');
        const { stdout: usbOutput } = await execAsync(
          `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'USB' -or $_.Class -eq 'USBDevice'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
        );
        
        if (usbOutput && usbOutput.trim()) {
          try {
            const usbList = JSON.parse(usbOutput);
            const usbArray = Array.isArray(usbList) ? usbList : [usbList];
            
            console.log(`找到 ${usbArray.length} 个USB设备，正在筛选手写板...`);
            
            for (const device of usbArray) {
              if (device && (device.Status === 'OK' || device.Status === 'Started')) {
                const friendlyName = (device.FriendlyName || '').toLowerCase();
                // 更宽泛的匹配条件，包括常见的USB手写板关键词
                if (friendlyName.includes('tablet') ||
                    friendlyName.includes('signature') ||
                    friendlyName.includes('digitizer') ||
                    friendlyName.includes('pen') ||
                    friendlyName.includes('drawing') ||
                    friendlyName.includes('graphics') ||
                    friendlyName.includes('pad') ||
                    friendlyName.includes('board') ||
                    friendlyName.includes('sign') ||
                    friendlyName.includes('input')) {
                  const instanceId = device.InstanceId || `tablet_${devices.length}`;
                  if (!deviceIds.has(instanceId)) {
                    console.log(`检测到USB手写板设备: ${device.FriendlyName}`);
                    devices.push({
                      id: instanceId,
                      name: device.FriendlyName || 'Handwriting Tablet',
                      type: 'tablet' as const,
                      status: 'connected' as const,
                      details: {
                        instanceId: device.InstanceId,
                        status: device.Status
                      }
                    });
                    deviceIds.add(instanceId);
                  }
                }
              }
            }
          } catch (parseError) {
            console.log('解析USB设备JSON失败:', parseError);
          }
        }
      } catch (usbError: any) {
        console.log('USB设备检测失败:', usbError.message || usbError);
      }
      
      // 方法3: 检测HID设备（Human Interface Device）
      // 手写板通常也是HID设备
      try {
        console.log('检测HID类设备...');
        const { stdout: hidOutput } = await execAsync(
          `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'HIDClass'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
        );
        
        if (hidOutput && hidOutput.trim()) {
          try {
            const hidList = JSON.parse(hidOutput);
            const hidArray = Array.isArray(hidList) ? hidList : [hidList];
            
            console.log(`找到 ${hidArray.length} 个HID设备，正在筛选手写板...`);
            
            for (const device of hidArray) {
              if (device && (device.Status === 'OK' || device.Status === 'Started')) {
                const friendlyName = (device.FriendlyName || '').toLowerCase();
                // 宽泛匹配，包括所有可能的手写板关键词
                if (friendlyName.includes('tablet') ||
                    friendlyName.includes('signature') ||
                    friendlyName.includes('digitizer') ||
                    friendlyName.includes('pen') ||
                    friendlyName.includes('drawing') ||
                    friendlyName.includes('graphics') ||
                    friendlyName.includes('pad') ||
                    friendlyName.includes('board') ||
                    friendlyName.includes('sign') ||
                    friendlyName.includes('input') ||
                    friendlyName.includes('touch') ||
                    friendlyName.includes('pointer')) {
                  const instanceId = device.InstanceId || `tablet_${devices.length}`;
                  if (!deviceIds.has(instanceId)) {
                    console.log(`检测到HID手写板设备: ${device.FriendlyName}`);
                    devices.push({
                      id: instanceId,
                      name: device.FriendlyName || 'Handwriting Tablet',
                      type: 'tablet' as const,
                      status: 'connected' as const,
                      details: {
                        instanceId: device.InstanceId,
                        status: device.Status
                      }
                    });
                    deviceIds.add(instanceId);
                  }
                }
              }
            }
          } catch (parseError) {
            console.log('解析HID设备JSON失败:', parseError);
          }
        }
      } catch (hidError: any) {
        console.log('HID设备检测失败:', hidError.message || hidError);
      }
      
      // 方法4: 如果仍然没有找到，尝试检测所有输入设备
      if (devices.length === 0) {
        try {
          console.log('尝试检测所有输入设备...');
          const { stdout: inputOutput } = await execAsync(
            `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'Keyboard' -or $_.Class -eq 'Mouse' -or $_.Class -eq 'SystemDevice'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
          );
          
          if (inputOutput && inputOutput.trim()) {
            try {
              const inputList = JSON.parse(inputOutput);
              const inputArray = Array.isArray(inputList) ? inputList : [inputList];
              
              console.log(`找到 ${inputArray.length} 个输入设备，正在筛选...`);
              
              for (const device of inputArray) {
                if (device && (device.Status === 'OK' || device.Status === 'Started')) {
                  const friendlyName = (device.FriendlyName || '').toLowerCase();
                  // 非常宽泛的匹配
                  if (friendlyName.includes('tablet') ||
                      friendlyName.includes('signature') ||
                      friendlyName.includes('digitizer') ||
                      friendlyName.includes('pen') ||
                      friendlyName.includes('pad') ||
                      friendlyName.includes('board')) {
                    const instanceId = device.InstanceId || `tablet_${devices.length}`;
                    if (!deviceIds.has(instanceId)) {
                      console.log(`检测到可能的输入手写板设备: ${device.FriendlyName}`);
                      devices.push({
                        id: instanceId,
                        name: device.FriendlyName || 'Handwriting Tablet',
                        type: 'tablet' as const,
                        status: 'connected' as const,
                        details: {
                          instanceId: device.InstanceId,
                          status: device.Status
                        }
                      });
                      deviceIds.add(instanceId);
                    }
                  }
                }
              }
            } catch (parseError) {
              console.log('解析输入设备JSON失败:', parseError);
            }
          }
        } catch (inputError: any) {
          console.log('输入设备检测失败:', inputError.message || inputError);
        }
      }
      
      // 如果所有方法都失败，至少返回一个通用设备（如果用户说设备已连接）
      if (devices.length === 0) {
        console.log('未检测到任何手写板设备');
        console.log('提示: 请检查设备管理器中是否有Digitizer、HID或USB设备');
      } else {
        console.log(`手写板设备检测完成，找到 ${devices.length} 个设备`);
        devices.forEach((device, index) => {
          console.log(`  设备 ${index + 1}: ${device.name} (${device.status})`);
        });
      }
      
      return devices;
    } catch (error) {
      console.error('Failed to get tablet devices:', error);
      return [];
    }
  }

  /**
   * 获取过磅秤设备
   */
  private async getScaleDevices(): Promise<DeviceInfo[]> {
    try {
      // 这里需要根据实际的过磅秤SDK来实现
      // 可以通过串口设备枚举来检测
      // 目前返回空数组，因为没有实际设备
      return [];
    } catch (error) {
      console.error('Failed to get scale devices:', error);
      return [];
    }
  }

  /**
   * 获取开发票机器设备
   */
  private async getPrinterDevices(): Promise<DeviceInfo[]> {
    try {
      // 这里需要根据实际的打印机SDK来实现
      // 可以通过系统打印机API来检测
      // 目前返回空数组，因为没有实际设备
      return [];
    } catch (error) {
      console.error('Failed to get printer devices:', error);
      return [];
    }
  }

  /**
   * 测试设备连接
   */
  async testDevice(deviceId: string, type: 'camera' | 'fingerprint' | 'tablet' | 'scale' | 'printer'): Promise<boolean> {
    try {
      if (type === 'camera') {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } }
        });
        stream.getTracks().forEach(track => track.stop());
        return true;
      } else if (type === 'fingerprint') {
        // 这里需要根据实际的指纹板SDK来实现测试
        return true;
      } else if (type === 'tablet') {
        // 这里需要根据实际的手写板SDK来实现测试
        return true;
      } else if (type === 'scale') {
        // 这里需要根据实际的过磅秤SDK来实现测试
        return true;
      } else if (type === 'printer') {
        // 这里需要根据实际的打印机SDK来实现测试
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to test device connection:', error);
      return false;
    }
  }

  /**
   * 重置设置
   */
  async resetSettings(): Promise<void> {
    const defaultSettings: AppSettings = {
      language: 'en-US',
      theme: 'light',
      notifications: true,
      autoSave: true,
      dataRetention: 365,
      backupEnabled: false,
      backupInterval: 24
    };
    
    await this.saveSettings(defaultSettings);
  }

  /**
   * 导出设置
   */
  async exportSettings(): Promise<string> {
    const settings = await this.getSettings();
    return JSON.stringify(settings, null, 2);
  }

  /**
   * 导入设置
   */
  async importSettings(settingsJson: string): Promise<void> {
    try {
      const settings = JSON.parse(settingsJson);
      await this.saveSettings(settings);
    } catch (error) {
      throw new Error('设置文件格式错误');
    }
  }
}
