import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface CameraResult {
  success: boolean;
  imagePath?: string;
  error?: string;
}

export class CameraService {
  private mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * 启动摄像头
   */
  async startCamera(): Promise<boolean> {
    try {
      // 发送消息到渲染进程启动摄像头
      this.mainWindow.webContents.send('camera:start');
      return true;
    } catch (error) {
      console.error('启动摄像头失败:', error);
      return false;
    }
  }

  /**
   * 停止摄像头
   */
  async stopCamera(): Promise<void> {
    try {
      this.mainWindow.webContents.send('camera:stop');
    } catch (error) {
      console.error('停止摄像头失败:', error);
    }
  }

  /**
   * 拍照
   */
  async capturePhoto(): Promise<CameraResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          error: 'Photo capture timeout'
        });
      }, 10000); // 10秒超时

      // 监听拍照结果
      const handlePhotoResult = (event: any, result: CameraResult) => {
        clearTimeout(timeout);
        this.mainWindow.webContents.removeListener('camera:photo-result', handlePhotoResult);
        resolve(result);
      };

      this.mainWindow.webContents.on('camera:photo-result', handlePhotoResult);
      
      // 发送拍照命令
      this.mainWindow.webContents.send('camera:capture');
    });
  }


  /**
   * 获取摄像头设备列表
   */
  async getCameraDevices(): Promise<MediaDeviceInfo[]> {
    return new Promise((resolve, reject) => {
      // 设置超时（5秒）
      const timeout = setTimeout(() => {
        // 清理监听器
        ipcMain.removeListener('camera:devices', handleDevices);
        reject(new Error('获取摄像头设备超时'));
      }, 5000);

      const handleDevices = (event: any, devices: any[]) => {
        clearTimeout(timeout);
        // 清理监听器
        ipcMain.removeListener('camera:devices', handleDevices);
        console.log('主进程收到摄像头设备列表:', devices?.length || 0, '个设备');
        console.log('设备详情:', devices);
        
        // 将接收到的对象转换为MediaDeviceInfo格式
        const mediaDevices: MediaDeviceInfo[] = (devices || []).map((d: any) => ({
          deviceId: d.deviceId,
          kind: d.kind || 'videoinput',
          label: d.label || '',
          groupId: d.groupId || ''
        } as MediaDeviceInfo));
        
        resolve(mediaDevices);
      };

      // 使用 ipcMain 监听，因为渲染进程使用 ipcRenderer.send
      ipcMain.once('camera:devices', handleDevices);
      
      // 发送消息到渲染进程请求设备列表
      console.log('主进程发送摄像头设备枚举请求');
      this.mainWindow.webContents.send('camera:get-devices');
    });
  }
}
