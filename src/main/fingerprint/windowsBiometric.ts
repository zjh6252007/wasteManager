/**
 * Windows Biometric Framework (WBF) 接口
 * 用于访问Windows Hello指纹设备
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface WindowsBiometricDevice {
  id: string;
  name: string;
  type: string;
  status: string;
}

export interface BiometricCaptureResult {
  success: boolean;
  template?: Buffer;
  imageData?: Buffer;
  error?: string;
}

/**
 * Windows Biometric Framework 服务
 */
export class WindowsBiometricService {
  /**
   * 检测Windows Biometric设备
   */
  static async detectDevices(): Promise<WindowsBiometricDevice[]> {
    const devices: WindowsBiometricDevice[] = [];
    
    try {
      // 使用PowerShell查询Windows Biometric设备
      const command = `powershell -Command "Get-WmiObject -Class Win32_BiometricDevice | Select-Object Name, Manufacturer, Status | ConvertTo-Json"`;
      
      try {
        const { stdout } = await execAsync(command);
        if (stdout && stdout.trim()) {
          const result = JSON.parse(stdout);
          const deviceList = Array.isArray(result) ? result : [result];
          
          for (const device of deviceList) {
            if (device && device.Name) {
              devices.push({
                id: `wbf_${device.Name.replace(/\s+/g, '_')}`,
                name: device.Name,
                type: 'fingerprint',
                status: device.Status || 'Unknown'
              });
            }
          }
        }
      } catch (error) {
        console.error('Error querying WBF devices:', error);
      }
      
      // 也尝试通过设备管理器查询生物识别设备
      try {
        const deviceManagerCommand = `powershell -Command "Get-PnpDevice | Where-Object {$_.Class -eq 'Biometric'} | Select-Object FriendlyName, Status, InstanceId | ConvertTo-Json"`;
        const { stdout: dmOutput } = await execAsync(deviceManagerCommand);
        
        if (dmOutput && dmOutput.trim()) {
          const dmResult = JSON.parse(dmOutput);
          const dmDeviceList = Array.isArray(dmResult) ? dmResult : [dmResult];
          
          for (const device of dmDeviceList) {
            if (device && device.FriendlyName && device.Status === 'OK') {
              // 检查是否已经在列表中
              const exists = devices.some(d => d.name === device.FriendlyName);
              if (!exists) {
                devices.push({
                  id: `wbf_${device.InstanceId}`,
                  name: device.FriendlyName,
                  type: 'fingerprint',
                  status: device.Status || 'OK'
                });
              }
            }
          }
        }
      } catch (error) {
        console.error('Error querying device manager:', error);
      }
      
    } catch (error) {
      console.error('Error detecting Windows Biometric devices:', error);
    }
    
    return devices;
  }

  /**
   * 检查Windows Biometric服务是否可用
   */
  static async isAvailable(): Promise<boolean> {
    try {
      const command = `powershell -Command "Get-Service -Name 'WbioSrvc' | Select-Object Status"`;
      const { stdout } = await execAsync(command);
      return stdout.includes('Running');
    } catch (error) {
      return false;
    }
  }

  /**
   * 初始化Windows Biometric Framework
   */
  static async initialize(): Promise<boolean> {
    try {
      // 检查服务是否运行
      const isAvailable = await this.isAvailable();
      if (!isAvailable) {
        console.log('Windows Biometric Service is not running');
        return false;
      }
      
      // 检查是否有可用设备
      const devices = await this.detectDevices();
      if (devices.length === 0) {
        console.log('No Windows Biometric devices found');
        return false;
      }
      
      console.log(`Found ${devices.length} Windows Biometric device(s):`, devices);
      return true;
    } catch (error) {
      console.error('Error initializing Windows Biometric Framework:', error);
      return false;
    }
  }

  /**
   * 通过Windows Hello采集指纹
   * 使用PowerShell调用Windows Runtime API
   */
  static async captureFingerprint(): Promise<BiometricCaptureResult> {
    try {
      // 使用PowerShell调用Windows Hello API
      // 注意：这需要用户交互，因为Windows Hello需要用户确认
      const command = `powershell -Command "$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Runtime.WindowsRuntime; $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]; Function Await($WinRtTask, $ResultType) { $asTask = $asTaskGeneric.MakeGenericMethod($ResultType); $netTask = $asTask.Invoke($null, @($WinRtTask)); $netTask.Wait(-1) | Out-Null; $netTask.Result }; $provider = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]::RequestVerificationAsync('请验证您的指纹'); $result = Await $provider ([Windows.Security.Credentials.UI.UserConsentVerificationResult]); if ($result -eq 'Verified') { Write-Output 'SUCCESS' } else { Write-Output 'FAILED' } } catch { Write-Output ('ERROR: ' + $_.Exception.Message) }"`;
      
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
      
      if (stdout && stdout.trim() === 'SUCCESS') {
        // 指纹验证成功，但我们需要实际的指纹数据
        // Windows Hello API 不直接提供指纹模板，只提供验证结果
        // 我们需要使用 WinBio API 来获取实际的指纹数据
        
        // 尝试使用 WinBio API 通过 PowerShell
        return await this.captureFingerprintWithWinBio();
      } else {
        return {
          success: false,
          error: stdout || stderr || '指纹验证失败'
        };
      }
    } catch (error: any) {
      console.error('Error capturing fingerprint via Windows Hello:', error);
      return {
        success: false,
        error: error.message || 'Fingerprint capture failed'
      };
    }
  }

  /**
   * 使用WinBio API采集指纹（需要管理员权限）
   */
  private static async captureFingerprintWithWinBio(): Promise<BiometricCaptureResult> {
    try {
      // 创建一个临时的C#脚本来调用WinBio API
      // 由于WinBio API比较复杂，我们使用一个简化的方法
      // 通过PowerShell调用Windows Runtime API
      
      // 注意：WinBio API需要管理员权限，并且比较复杂
      // 这里我们返回一个提示，建议使用设备制造商的SDK
      
      return {
        success: false,
        error: 'Windows Hello API 仅支持验证，不支持直接采集指纹模板。\n\n建议：\n1. 使用设备制造商提供的SDK进行指纹采集\n2. 或者使用Windows Hello进行验证，然后手动输入验证结果'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'WinBio API call failed'
      };
    }
  }
}

