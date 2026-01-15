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
  autoUpdateCheck?: boolean;
  updateCheckInterval?: number;
}

export class SettingsService {
  private activationId: number;
  private mainWindow: BrowserWindow | null;

  constructor(activationId: number, mainWindow?: BrowserWindow | null) {
    this.activationId = activationId;
    this.mainWindow = mainWindow || null;
  }

  /**
   * Get application settings
   */
  async getSettings(): Promise<AppSettings & { companyName?: string; address?: string; city?: string; zipCode?: string }> {
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
      backupServerUrl: settings.backupServerUrl || 'https://backup-server-1378.azurewebsites.net',
      autoUpdateCheck: settings.autoUpdateCheck === 'true',
      updateCheckInterval: parseInt(settings.updateCheckInterval) || 24,
      // Company settings
      companyName: settings.companyName,
      address: settings.address,
      city: settings.city,
      zipCode: settings.zipCode
    };
  }

  /**
   * Save application settings
   */
  async saveSettings(settings: Partial<AppSettings>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        repo.userSettings.set(this.activationId, key, String(value));
      }
    }
  }

  /**
   * Get device list
   */
  async getDevices(deviceType?: DeviceInfo['type']): Promise<DeviceInfo[]> {
    const devices: DeviceInfo[] = [];
    
    try {
      // If device type is specified, only get devices of that type
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
      
      // Get all devices
      // Get real camera devices
      const cameraDevices = await this.getCameraDevices();
      devices.push(...cameraDevices);
      
      // Get real fingerprint devices
      const fingerprintDevices = await this.getFingerprintDevices();
      devices.push(...fingerprintDevices);
      
      // Get signature pad devices
      const tabletDevices = await this.getTabletDevices();
      devices.push(...tabletDevices);
      
      // Get scale devices
      const scaleDevices = await this.getScaleDevices();
      devices.push(...scaleDevices);
      
      // Get invoice printer devices
      const printerDevices = await this.getPrinterDevices();
      devices.push(...printerDevices);
    } catch (error) {
      console.error('Failed to get device list:', error);
    }
    
    return devices;
  }

  /**
   * Get camera devices
   */
  private async getCameraDevices(): Promise<DeviceInfo[]> {
    try {
      // If main window exists, use CameraService to get devices
      if (this.mainWindow) {
        try {
          const cameraService = new CameraService(this.mainWindow);
          console.log('SettingsService: Starting to get camera devices...');
          const devices = await Promise.race([
            cameraService.getCameraDevices(),
            new Promise<MediaDeviceInfo[]>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 6000)
            )
          ]);
          
          console.log('SettingsService: Received device list, count:', devices?.length || 0);
          
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
          
          console.log('SettingsService: Converted device list:', result);
          return result;
        } catch (error) {
          console.error('Failed to get camera devices via CameraService:', error);
          // If getting devices via CameraService fails, return empty array instead of throwing error
          return [];
        }
      }
      
      // If no main window, return empty array
      return [];
    } catch (error) {
      console.error('Failed to get camera devices:', error);
      return [];
    }
  }

  /**
   * Get fingerprint devices
   */
  private async getFingerprintDevices(): Promise<DeviceInfo[]> {
    try {
      const deviceList: DeviceInfo[] = [];
      
      // First try to detect Windows Biometric Framework devices
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
      
      // Then try to detect USB fingerprint devices
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
        
        // If no known devices detected, try listing all USB devices for debugging
        if (usbDevices.length === 0 && deviceList.length === 0) {
          console.log('No known fingerprint devices found, listing all USB devices for debugging...');
          try {
            const allDevices = await FingerprintHardware.listAllUsbDevices();
            console.log('All USB devices:', allDevices);
            
            // Return all HID devices as possible fingerprint devices
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
   * Get signature pad devices
   * Supports all Windows plug-and-play signature pad devices
   */
  private async getTabletDevices(): Promise<DeviceInfo[]> {
    try {
      const devices: DeviceInfo[] = [];
      const deviceIds = new Set<string>(); // For deduplication
      
      console.log('Starting to detect signature pad devices...');
      
      // Method 1: Detect all Digitizer class devices (most common signature pad type)
      // Don't rely on device name, any Digitizer class device is considered a signature pad
      try {
        console.log('Detecting all Digitizer class devices...');
        const { stdout: digitizerOutput } = await execAsync(
          `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'Digitizer'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
        );
        
        if (digitizerOutput && digitizerOutput.trim()) {
          try {
            const digitizerList = JSON.parse(digitizerOutput);
            const digitizerArray = Array.isArray(digitizerList) ? digitizerList : [digitizerList];
            
            console.log(`Found ${digitizerArray.length} Digitizer devices`);
            
            for (const device of digitizerArray) {
              if (device && (device.Status === 'OK' || device.Status === 'Started' || device.Status === 'Error')) {
                const instanceId = device.InstanceId || `tablet_${devices.length}`;
                if (!deviceIds.has(instanceId)) {
                  const friendlyName = device.FriendlyName || 'Handwriting Tablet';
                  console.log(`Detected digitizer device: ${friendlyName} (Status: ${device.Status})`);
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
            console.log('Failed to parse Digitizer device JSON:', parseError);
            console.log('Original output:', digitizerOutput.substring(0, 500));
          }
        } else {
          console.log('No Digitizer class devices found');
        }
      } catch (digitizerError: any) {
        console.log('Digitizer detection failed:', digitizerError.message || digitizerError);
      }
      
      // Method 2: Detect signature pads in USB devices
      // Many signature pads connect via USB, detect USB devices
      try {
        console.log('Detecting signature pads in USB devices...');
        const { stdout: usbOutput } = await execAsync(
          `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'USB' -or $_.Class -eq 'USBDevice'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
        );
        
        if (usbOutput && usbOutput.trim()) {
          try {
            const usbList = JSON.parse(usbOutput);
            const usbArray = Array.isArray(usbList) ? usbList : [usbList];
            
            console.log(`Found ${usbArray.length} USB devices, filtering signature pads...`);
            
            for (const device of usbArray) {
              if (device && (device.Status === 'OK' || device.Status === 'Started')) {
                const friendlyName = (device.FriendlyName || '').toLowerCase();
                // Broader matching conditions, including common USB signature pad keywords
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
                    console.log(`Detected USB signature pad device: ${device.FriendlyName}`);
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
            console.log('Failed to parse USB device JSON:', parseError);
          }
        }
      } catch (usbError: any) {
        console.log('USB device detection failed:', usbError.message || usbError);
      }
      
      // Method 3: Detect HID devices (Human Interface Device)
      // Signature pads are usually also HID devices
      try {
        console.log('Detecting HID class devices...');
        const { stdout: hidOutput } = await execAsync(
          `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'HIDClass'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
        );
        
        if (hidOutput && hidOutput.trim()) {
          try {
            const hidList = JSON.parse(hidOutput);
            const hidArray = Array.isArray(hidList) ? hidList : [hidList];
            
            console.log(`Found ${hidArray.length} HID devices, filtering signature pads...`);
            
            for (const device of hidArray) {
              if (device && (device.Status === 'OK' || device.Status === 'Started')) {
                const friendlyName = (device.FriendlyName || '').toLowerCase();
                // Broad matching, including all possible signature pad keywords
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
                    console.log(`Detected HID signature pad device: ${device.FriendlyName}`);
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
            console.log('Failed to parse HID device JSON:', parseError);
          }
        }
      } catch (hidError: any) {
        console.log('HID device detection failed:', hidError.message || hidError);
      }
      
      // Method 4: If still not found, try detecting all input devices
      if (devices.length === 0) {
        try {
          console.log('Trying to detect all input devices...');
          const { stdout: inputOutput } = await execAsync(
            `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'Keyboard' -or $_.Class -eq 'Mouse' -or $_.Class -eq 'SystemDevice'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`
          );
          
          if (inputOutput && inputOutput.trim()) {
            try {
              const inputList = JSON.parse(inputOutput);
              const inputArray = Array.isArray(inputList) ? inputList : [inputList];
              
              console.log(`Found ${inputArray.length} input devices, filtering...`);
              
              for (const device of inputArray) {
                if (device && (device.Status === 'OK' || device.Status === 'Started')) {
                  const friendlyName = (device.FriendlyName || '').toLowerCase();
                  // Very broad matching
                  if (friendlyName.includes('tablet') ||
                      friendlyName.includes('signature') ||
                      friendlyName.includes('digitizer') ||
                      friendlyName.includes('pen') ||
                      friendlyName.includes('pad') ||
                      friendlyName.includes('board')) {
                    const instanceId = device.InstanceId || `tablet_${devices.length}`;
                    if (!deviceIds.has(instanceId)) {
                      console.log(`Detected possible input signature pad device: ${device.FriendlyName}`);
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
              console.log('Failed to parse input device JSON:', parseError);
            }
          }
        } catch (inputError: any) {
          console.log('Input device detection failed:', inputError.message || inputError);
        }
      }
      
      // If all methods fail, at least return a generic device (if user says device is connected)
      if (devices.length === 0) {
        console.log('No signature pad devices detected');
        console.log('Tip: Please check Device Manager for Digitizer, HID or USB devices');
      } else {
        console.log(`Signature pad device detection completed, found ${devices.length} devices`);
        devices.forEach((device, index) => {
          console.log(`  Device ${index + 1}: ${device.name} (${device.status})`);
        });
      }
      
      return devices;
    } catch (error) {
      console.error('Failed to get tablet devices:', error);
      return [];
    }
  }

  /**
   * Get scale devices
   */
  private async getScaleDevices(): Promise<DeviceInfo[]> {
    try {
      // This needs to be implemented based on the actual scale SDK
      // Can be detected through serial port device enumeration
      // Currently returns empty array as there are no actual devices
      return [];
    } catch (error) {
      console.error('Failed to get scale devices:', error);
      return [];
    }
  }

  /**
   * Get invoice printer devices
   */
  private async getPrinterDevices(): Promise<DeviceInfo[]> {
    try {
      // This needs to be implemented based on the actual printer SDK
      // Can be detected through system printer API
      // Currently returns empty array as there are no actual devices
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
      throw new Error('Settings file format error');
    }
  }
}
