import { app, shell } from 'electron';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export interface UpdateInfo {
  available: boolean;
  version?: string;
  releaseNotes?: string;
  downloadUrl?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

export class UpdateService {
  private currentVersion: string;
  private updateServerUrl?: string;
  private downloadProgressCallback?: (progress: DownloadProgress) => void;

  constructor(updateServerUrl?: string) {
    this.currentVersion = app.getVersion();
    this.updateServerUrl = updateServerUrl;
  }

  /**
   * 设置下载进度回调
   */
  setProgressCallback(callback: (progress: DownloadProgress) => void) {
    this.downloadProgressCallback = callback;
  }

  /**
   * 检查更新
   * 可以从GitHub Releases或自定义服务器检查
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    try {
      // 方法1: 从自定义服务器检查（如果配置了）
      if (this.updateServerUrl) {
        return await this.checkFromCustomServer();
      }

      // 方法2: 从GitHub Releases检查（默认）
      return await this.checkFromGitHub();

    } catch (error) {
      console.error('Failed to check for updates:', error);
      throw new Error(`Failed to check for updates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 从自定义服务器检查更新
   */
  private async checkFromCustomServer(): Promise<UpdateInfo> {
    if (!this.updateServerUrl) {
      throw new Error('Update server URL not configured');
    }

    return new Promise((resolve, reject) => {
      const url = new URL(this.updateServerUrl);
      const client = url.protocol === 'https:' ? https : http;

      const req = client.get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const updateInfo = JSON.parse(data);
            // 期望格式: { version: "1.0.0", releaseNotes: "...", downloadUrl: "..." }
            if (this.isNewerVersion(updateInfo.version)) {
              resolve({
                available: true,
                version: updateInfo.version,
                releaseNotes: updateInfo.releaseNotes,
                downloadUrl: updateInfo.downloadUrl
              });
            } else {
              resolve({ available: false });
            }
          } catch (error) {
            reject(new Error('Failed to parse update server response'));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Update check timeout'));
      });
    });
  }

  /**
   * 从GitHub Releases检查更新
   * 需要配置GitHub仓库信息
   */
  private async checkFromGitHub(): Promise<UpdateInfo> {
    // 默认使用当前仓库（需要根据实际情况配置）
    const repoOwner = 'your-username'; // 替换为实际的GitHub用户名或组织
    const repoName = 'garbage-recycle-scale'; // 替换为实际的仓库名

    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;

    return new Promise((resolve, reject) => {
      https.get(apiUrl, {
        headers: {
          'User-Agent': 'garbage-recycle-scale-updater'
        }
      }, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API returned status ${res.statusCode}`));
              return;
            }

            const release = JSON.parse(data);
            const latestVersion = release.tag_name.replace(/^v/, ''); // 移除 'v' 前缀

            if (this.isNewerVersion(latestVersion)) {
              // 查找Windows安装包
              const windowsAsset = release.assets.find((asset: any) => 
                asset.name.includes('.exe') || asset.name.includes('.msi') || asset.name.includes('win')
              );

              resolve({
                available: true,
                version: latestVersion,
                releaseNotes: release.body || release.name,
                downloadUrl: windowsAsset?.browser_download_url || release.html_url
              });
            } else {
              resolve({ available: false });
            }
          } catch (error) {
            reject(new Error('Failed to parse GitHub API response'));
          }
        });
      }).on('error', (error) => {
        reject(error);
      }).setTimeout(10000, () => {
        reject(new Error('Update check timeout'));
      });
    });
  }

  /**
   * 比较版本号
   */
  private isNewerVersion(version: string): boolean {
    const current = this.parseVersion(this.currentVersion);
    const latest = this.parseVersion(version);

    for (let i = 0; i < Math.max(current.length, latest.length); i++) {
      const currentPart = current[i] || 0;
      const latestPart = latest[i] || 0;

      if (latestPart > currentPart) {
        return true;
      } else if (latestPart < currentPart) {
        return false;
      }
    }

    return false;
  }

  /**
   * 解析版本号为数字数组
   */
  private parseVersion(version: string): number[] {
    return version.split('.').map(part => parseInt(part, 10) || 0);
  }

  /**
   * 下载更新并自动安装
   */
  async downloadUpdate(downloadUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(downloadUrl);
      const client = url.protocol === 'https:' ? https : http;
      
      // 创建临时目录
      const tempDir = app.getPath('temp');
      const fileName = path.basename(url.pathname) || `update-${Date.now()}.exe`;
      const filePath = path.join(tempDir, fileName);

      // 检查文件是否已存在，如果存在则删除
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      const file = fs.createWriteStream(filePath);
      let downloadedBytes = 0;
      let totalBytes = 0;

      const req = client.get(url, (res) => {
        // 获取文件总大小
        totalBytes = parseInt(res.headers['content-length'] || '0', 10);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          file.write(chunk);

          // 报告下载进度
          if (this.downloadProgressCallback && totalBytes > 0) {
            const percent = Math.round((downloadedBytes / totalBytes) * 100);
            this.downloadProgressCallback({
              downloaded: downloadedBytes,
              total: totalBytes,
              percent
            });
          }
        });

        res.on('end', () => {
          file.end();
          
          if (res.statusCode !== 200) {
            fs.unlinkSync(filePath);
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }

          // 下载完成，自动安装
          this.installUpdate(filePath)
            .then(() => resolve())
            .catch((error) => {
              // 安装失败，清理文件
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              reject(error);
            });
        });
      });

      req.on('error', (error) => {
        file.close();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(error);
      });

      req.setTimeout(300000, () => { // 5分钟超时
        req.destroy();
        file.close();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * 自动安装更新
   */
  private async installUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Windows 下运行安装程序
      // 使用 /S 参数进行静默安装（如果安装程序支持）
      // 或者使用 /VERYSILENT /SUPPRESSMSGBOXES 等参数（取决于安装程序类型）
      const isExe = installerPath.endsWith('.exe');
      const isMsi = installerPath.endsWith('.msi');

      let installCommand: string;
      let installArgs: string[];

      if (isExe) {
        // 对于 .exe 安装程序，尝试静默安装
        // 注意：不是所有安装程序都支持静默安装参数
        installCommand = installerPath;
        installArgs = ['/S', '/NCRC']; // 静默安装，跳过CRC检查
      } else if (isMsi) {
        // 对于 .msi 安装程序
        installCommand = 'msiexec.exe';
        installArgs = ['/i', installerPath, '/quiet', '/norestart'];
      } else {
        reject(new Error('Unsupported installer format'));
        return;
      }

      console.log(`Installing update: ${installCommand} ${installArgs.join(' ')}`);

      // 启动安装程序
      const installer = spawn(installCommand, installArgs, {
        detached: true,
        stdio: 'ignore'
      });

      installer.on('error', (error) => {
        reject(new Error(`Failed to start installer: ${error.message}`));
      });

      installer.unref(); // 允许父进程退出

      // 等待一小段时间确保安装程序已启动
      setTimeout(() => {
        // 安装程序已启动，退出当前应用
        // 安装程序完成后会启动新版本
        app.quit();
        resolve();
      }, 2000);
    });
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }
}

