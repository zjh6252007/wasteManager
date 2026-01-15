import { BrowserWindow, ipcMain } from 'electron';
import { FingerprintHardware } from './fingerprintHardware';
import { WindowsBiometricService } from './windowsBiometric';

export interface FingerprintResult {
  success: boolean;
  template?: Buffer;
  imageData?: Buffer;
  error?: string;
}

export class FingerprintService {
  private mainWindow: BrowserWindow;
  private hardware: FingerprintHardware | null = null;
  private isSimulated: boolean = false;
  private useWbf: boolean = false; // 标记是否使用Windows Biometric Framework

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * 初始化指纹板
   */
  async initializeFingerprint(): Promise<boolean> {
    try {
      // 首先尝试直接USB访问（优先使用直接访问，兼容性更好）
      const devices = await FingerprintHardware.detectDevices();
      
      if (devices.length > 0) {
        console.log(`Detected ${devices.length} USB fingerprint devices:`, devices);
        
        // 尝试初始化所有检测到的设备，直到找到一个可用的
        for (const device of devices) {
          this.hardware = new FingerprintHardware();
          try {
            const success = await this.hardware.initialize(device.id);
            
            if (success) {
              console.log('Fingerprint hardware initialized successfully:', this.hardware.getDeviceInfo());
              this.isSimulated = false;
              this.useWbf = false; // USB访问成功，不使用WBF
              return true;
            } else {
              console.warn(`Device ${device.id} initialization failed, trying next device...`);
              this.hardware = null;
            }
          } catch (error: any) {
            console.warn(`Device ${device.id} initialization exception:`, error.message);
            this.hardware = null;
            
            // 如果是Windows独占错误，记录但继续尝试其他设备
            if (error && error.message && (error.message.includes('Windows system exclusive') || error.message.includes('Windows系统独占') || error.message.includes('does not support direct USB access') || error.message.includes('不支持直接USB访问'))) {
              console.log(`Device ${device.id} is exclusively used by Windows, skipping this device`);
              continue;
            }
          }
        }
        
        // 如果所有USB设备都初始化失败，检查是否有WBF可用
        console.log('All USB devices initialization failed, checking Windows Biometric Framework...');
      }
      
      // 如果USB访问失败，尝试使用Windows Biometric Framework
      const isWbfAvailable = await WindowsBiometricService.isAvailable();
      if (isWbfAvailable) {
        const wbfDevices = await WindowsBiometricService.detectDevices();
        if (wbfDevices.length > 0) {
          console.log(`Detected ${wbfDevices.length} Windows Biometric devices:`, wbfDevices);
          this.useWbf = true;
          // Note: WBF mode cannot directly capture fingerprint templates, only for verification
          console.log('Note: Windows Biometric Framework only supports verification, does not support fingerprint template capture');
          return true;
        }
      }
      
      // 如果USB设备检测到但初始化失败，且没有WBF，返回false
      if (devices.length > 0) {
        console.error('Fingerprint device detected but cannot be initialized. Possible reasons:\n1. Device is occupied by another program\n2. Need to install dedicated driver\n3. Device does not support direct USB access');
        return false;
      }
      
      console.log('No fingerprint hardware device detected, please ensure device is connected');
      this.isSimulated = false;
      return false;
    } catch (error) {
      console.error('Failed to initialize fingerprint device:', error);
      this.hardware = null;
      return false;
    }
  }

  /**
   * 开始指纹采集
   */
  async startFingerprintCapture(): Promise<boolean> {
    try {
      if (!this.hardware && !this.useWbf) {
        console.error('Fingerprint hardware not initialized');
        return false;
      }
      
      if (this.hardware) {
        return await this.hardware.startCapture();
      }
      
      // WBF模式下，无法直接控制设备，返回true让用户知道可以开始
      if (this.useWbf) {
        console.log('Windows Biometric Framework mode: Device is ready');
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Failed to start fingerprint capture:', error);
      return false;
    }
  }

  /**
   * 停止指纹采集
   */
  async stopFingerprintCapture(): Promise<void> {
    try {
      if (this.hardware) {
        await this.hardware.stopCapture();
      }
      // WBF模式下无需停止操作
    } catch (error) {
      console.error('Failed to stop fingerprint capture:', error);
    }
  }

  /**
   * 采集指纹
   */
  async captureFingerprint(): Promise<FingerprintResult> {
    if (!this.hardware && !this.useWbf) {
      return {
        success: false,
        error: '指纹硬件未初始化'
      };
    }
    
    if (this.hardware) {
      try {
        const result = await this.hardware.capture();
        
        return {
          success: result.success,
          template: result.template,
          imageData: result.imageData,
          error: result.error
        };
      } catch (error) {
        console.error('Fingerprint capture failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
    
    // WBF模式下，尝试通过Windows Biometric Framework采集
    if (this.useWbf) {
      try {
        console.log('Attempting to capture fingerprint via Windows Biometric Framework...');
        const result = await WindowsBiometricService.captureFingerprint();
        
        if (result.success) {
          return {
            success: true,
            template: result.template,
            imageData: result.imageData
          };
        } else {
          return {
            success: false,
            error: result.error || 'Windows Biometric Framework采集失败'
          };
        }
      } catch (error) {
        console.error('Windows Biometric Framework capture failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Windows Biometric Framework capture failed'
        };
      }
    }
    
    // 如果既没有硬件也没有WBF，返回错误
    return {
      success: false,
      error: '设备不支持直接USB访问。此设备可能需要：\n1. 设备制造商提供的专用驱动和SDK\n2. 通过Windows Biometric Framework访问（需要Windows Hello支持）\n3. 检查设备管理器中设备状态是否正常'
    };
  }


  /**
   * 验证指纹
   */
  async verifyFingerprint(template: Buffer): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ipcMain.removeListener('fingerprint:verify-result', handleVerifyResult);
        resolve(false);
      }, 10000);

      const handleVerifyResult = (event: any, result: boolean) => {
        clearTimeout(timeout);
        ipcMain.removeListener('fingerprint:verify-result', handleVerifyResult);
        resolve(result);
      };

      ipcMain.once('fingerprint:verify-result', handleVerifyResult);
      this.mainWindow.webContents.send('fingerprint:verify', template);
    });
  }

  /**
   * 获取指纹板状态
   */
  async getFingerprintStatus(): Promise<string> {
    if (!this.hardware) {
      return 'Not initialized';
    }
    
    return this.hardware.getStatus();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.hardware) {
      this.hardware.cleanup();
      this.hardware = null;
    }
  }
}
