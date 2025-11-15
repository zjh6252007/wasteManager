import { BrowserWindow } from 'electron';

export interface SignatureResult {
  success: boolean;
  imageData?: Buffer;
  error?: string;
}

export class TabletService {
  private mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  /**
   * 初始化手写板
   */
  async initializeTablet(): Promise<boolean> {
    try {
      // 发送消息到渲染进程初始化手写板
      this.mainWindow.webContents.send('tablet:init');
      return true;
    } catch (error) {
      console.error('Failed to initialize tablet:', error);
      return false;
    }
  }

  /**
   * 开始签名采集
   */
  async startSignatureCapture(): Promise<boolean> {
    try {
      this.mainWindow.webContents.send('tablet:start-capture');
      return true;
    } catch (error) {
      console.error('Failed to start signature capture:', error);
      return false;
    }
  }

  /**
   * 停止签名采集
   */
  async stopSignatureCapture(): Promise<void> {
    try {
      this.mainWindow.webContents.send('tablet:stop-capture');
    } catch (error) {
      console.error('Failed to stop signature capture:', error);
    }
  }

  /**
   * 采集签名
   */
  async captureSignature(): Promise<SignatureResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          error: 'Signature capture timeout'
        });
      }, 30000); // 30秒超时

      // 监听签名采集结果
      const handleSignatureResult = (event: any, result: SignatureResult) => {
        clearTimeout(timeout);
        this.mainWindow.webContents.removeListener('tablet:capture-result', handleSignatureResult);
        resolve(result);
      };

      this.mainWindow.webContents.on('tablet:capture-result', handleSignatureResult);
      
      // 发送签名采集命令
      this.mainWindow.webContents.send('tablet:capture');
    });
  }

  /**
   * 获取手写板状态
   */
  async getTabletStatus(): Promise<string> {
    return new Promise((resolve) => {
      const handleStatus = (event: any, status: string) => {
        this.mainWindow.webContents.removeListener('tablet:status', handleStatus);
        resolve(status);
      };

      this.mainWindow.webContents.on('tablet:status', handleStatus);
      this.mainWindow.webContents.send('tablet:get-status');
    });
  }
}

