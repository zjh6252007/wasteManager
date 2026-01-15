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

      // 方法2: 从GitHub Releases检查
      return await this.checkFromGitHub();

    } catch (error) {
      console.error('Failed to check for updates:', error);
      // 如果 GitHub 检查失败（如 404），返回无更新而不是抛出错误
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
        console.log('Update server not found, returning no update available');
        return { available: false };
      }
      throw new Error(`Failed to check for updates: ${errorMessage}`);
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
      const url = new URL(this.updateServerUrl!);
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
    // 配置GitHub仓库信息
    const repoOwner = 'zjh6252007';
    const repoName = 'wasteManager';

    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;
    console.log(`[Update] Checking GitHub releases from: ${apiUrl}`);
    console.log(`[Update] Current version: ${this.currentVersion}`);

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
              if (res.statusCode === 404) {
                console.error(`[Update] GitHub repository or release not found: ${apiUrl}`);
                console.error(`[Update] Please check: 1) Repository is public, 2) Release is published (not draft), 3) Repository name is correct`);
                reject(new Error(`GitHub repository or release not found (404). Please check if the repository is public and a release exists.`));
              } else {
                reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`));
              }
              return;
            }

            const release = JSON.parse(data);
            const latestVersion = release.tag_name.replace(/^v/, ''); // 移除 'v' 前缀
            console.log(`[Update] Latest version from GitHub: ${latestVersion} (tag: ${release.tag_name})`);
            console.log(`[Update] Is newer? ${this.isNewerVersion(latestVersion)}`);

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
   * 支持处理 HTTP 重定向（如 GitHub 的 302 重定向）
   */
  async downloadUpdate(downloadUrl: string): Promise<void> {
    // 处理重定向，获取最终下载 URL
    const finalUrl = await this.followRedirects(downloadUrl);
    
    return new Promise((resolve, reject) => {
      const url = new URL(finalUrl);
      const client = url.protocol === 'https:' ? https : http;
      
      // 创建临时目录
      const tempDir = app.getPath('temp');
      let fileName = path.basename(url.pathname) || `update-${Date.now()}.exe`;
      let filePath = path.join(tempDir, fileName);

      // 检查文件是否已存在，如果存在则删除
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      let file: fs.WriteStream | null = null;
      let downloadedBytes = 0;
      let totalBytes = 0;

      const req = client.get(url, {
        headers: {
          'User-Agent': 'garbage-recycle-scale-updater'
        }
      }, (res) => {
        // 如果仍然是重定向，继续跟随
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (file) {
            file.close();
          }
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          // 递归跟随重定向
          this.followRedirects(res.headers.location)
            .then(newUrl => this.downloadUpdate(newUrl))
            .then(() => resolve())
            .catch(reject);
          return;
        }

        // 尝试从 Content-Disposition 头获取文件名
        if (res.headers['content-disposition']) {
          const contentDisposition = res.headers['content-disposition'];
          const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (filenameMatch && filenameMatch[1]) {
            let extractedFileName = filenameMatch[1].replace(/['"]/g, '');
            // 处理 URL 编码的文件名
            try {
              extractedFileName = decodeURIComponent(extractedFileName);
            } catch {
              // 如果解码失败，使用原始文件名
            }
            if (extractedFileName) {
              fileName = extractedFileName;
              filePath = path.join(tempDir, fileName);
              // 如果新文件路径已存在，删除它
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
            }
          }
        }

        // 确保文件名有扩展名（如果没有，默认使用 .exe）
        if (!path.extname(fileName)) {
          fileName = `${fileName}.exe`;
          filePath = path.join(tempDir, fileName);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }

        // 创建文件流
        file = fs.createWriteStream(filePath);

        // 获取文件总大小
        totalBytes = parseInt(res.headers['content-length'] || '0', 10);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (file) {
            file.write(chunk);
          }

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
          if (file) {
            file.end();
          }
          
          if (res.statusCode !== 200) {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }

          // 等待文件完全写入并关闭
          if (file) {
            file.on('close', () => {
              // 确保文件已完全写入
              setTimeout(() => {
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
              }, 500); // 等待 500ms 确保文件完全写入
            });
          } else {
            // 如果没有文件流，直接等待后安装
            setTimeout(() => {
              this.installUpdate(filePath)
                .then(() => resolve())
                .catch((error) => {
                  if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                  }
                  reject(error);
                });
            }, 500);
          }
        });
      });

      req.on('error', (error) => {
        if (file) {
          file.close();
        }
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(error);
      });

      req.setTimeout(300000, () => { // 5分钟超时
        req.destroy();
        if (file) {
          file.close();
        }
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * 跟随 HTTP 重定向，获取最终下载 URL
   * @param url 初始 URL
   * @param maxRedirects 最大重定向次数（默认 10）
   * @returns 最终 URL
   */
  private async followRedirects(url: string, maxRedirects: number = 10): Promise<string> {
    if (maxRedirects <= 0) {
      throw new Error('Too many redirects');
    }

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const req = client.get(urlObj, {
        headers: {
          'User-Agent': 'garbage-recycle-scale-updater'
        }
      }, (res) => {
        // 如果是重定向（3xx），跟随 Location 头
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location;
          // 处理相对 URL
          const finalUrl = redirectUrl.startsWith('http') 
            ? redirectUrl 
            : `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
          
          // 消耗响应数据以避免内存泄漏
          res.resume();
          
          // 递归跟随重定向
          this.followRedirects(finalUrl, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        // 如果不是重定向，返回原始 URL
        res.resume();
        resolve(url);
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Redirect check timeout'));
      });
    });
  }

  /**
   * 自动安装更新并重启应用
   */
  private async installUpdate(installerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 检查文件是否存在
      if (!fs.existsSync(installerPath)) {
        reject(new Error(`Installer file not found: ${installerPath}`));
        return;
      }

      // 获取文件扩展名（不区分大小写）
      const ext = path.extname(installerPath).toLowerCase();
      const isExe = ext === '.exe';
      const isMsi = ext === '.msi';

      // 获取应用的可执行文件路径（用于安装后重启）
      const appPath = app.getPath('exe');
      const appDir = path.dirname(appPath);
      
      // 对于 MSI，应用通常安装在 Program Files 中
      // 我们需要找到安装后的可执行文件路径
      // 这里使用一个通用的方法：查找 waste-recycling-scale.exe
      let restartPath = appPath; // 默认使用当前路径

      let installCommand: string;
      let installArgs: string[];

      if (isExe) {
        // 对于 .exe 安装程序（Squirrel），尝试静默安装
        installCommand = installerPath;
        installArgs = ['/S', '/NCRC']; // 静默安装，跳过CRC检查
      } else if (isMsi) {
        // 对于 .msi 安装程序（WiX）
        // 创建一个批处理脚本来启动安装并等待完成后重启应用
        const restartScript = this.createRestartScript(installerPath);
        if (restartScript) {
          // 使用批处理脚本启动安装，脚本会等待安装完成并重启应用
          installCommand = 'cmd.exe';
          installArgs = ['/c', restartScript];
        } else {
          // 如果脚本创建失败，回退到直接启动 msiexec
          installCommand = 'msiexec.exe';
          const logFile = path.join(app.getPath('temp'), `update-install-${Date.now()}.log`);
          installArgs = [
            '/i', installerPath,
            '/qn',           // 完全静默安装（无UI）
            '/norestart',    // 不重启系统
            '/L*v', logFile  // 记录日志以便调试
          ];
        }
      } else {
        reject(new Error('Unsupported installer format'));
        return;
      }

      console.log(`Installing update: ${installCommand} ${installArgs.join(' ')}`);

      // 确保文件可执行（Windows 上通常不需要，但确保文件已完全写入）
      try {
        // 检查文件是否存在且可读
        fs.accessSync(installerPath, fs.constants.R_OK);
      } catch (error) {
        reject(new Error(`Installer file is not accessible: ${error instanceof Error ? error.message : 'Unknown error'}`));
        return;
      }

      // 启动安装程序
      let installer: ReturnType<typeof spawn>;
      try {
        installer = spawn(installCommand, installArgs, {
          detached: true,
          stdio: 'ignore',
          shell: isMsi && installCommand === 'cmd.exe', // 对于批处理脚本，需要 shell
          windowsVerbatimArguments: false // Windows 上正确处理参数
        });
      } catch (error) {
        reject(new Error(`Failed to spawn installer process: ${error instanceof Error ? error.message : 'Unknown error'}`));
        return;
      }

      installer.on('error', (error) => {
        // 如果是 EBUSY 错误，提供更友好的错误信息
        if (error.message.includes('EBUSY') || (error as any).code === 'EBUSY') {
          reject(new Error(`Installer file is busy. Please close any applications that might be using it and try again. Original error: ${error.message}`));
        } else {
          reject(new Error(`Failed to start installer: ${error.message}`));
        }
      });

      // 等待安装程序成功启动
      installer.on('spawn', () => {
        console.log('Update installer spawned successfully');
        installer.unref(); // 允许父进程退出

        // 等待一小段时间确保安装程序已启动
        setTimeout(() => {
          // 安装程序已启动，退出当前应用
          // 安装程序完成后会通过脚本启动新版本
          console.log('Update installer started, quitting application...');
          app.quit();
          resolve();
        }, 2000);
      });
    });
  }

  /**
   * 创建重启脚本（用于 MSI 安装后自动重启应用）
   */
  private createRestartScript(installerPath: string): string | null {
    try {
      const scriptPath = path.join(app.getPath('temp'), `restart-after-update-${Date.now()}.bat`);
      const appPath = app.getPath('exe');
      const logFile = path.join(app.getPath('temp'), `update-install-${Date.now()}.log`);
      
      // 尝试找到安装后的应用路径
      // 通常安装在 Program Files\Waste Recycling Scale System\app-0.1.0\waste-recycling-scale.exe
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const appName = 'Waste Recycling Scale System';
      const possiblePaths = [
        path.join(programFiles, appName, 'app-0.1.0', 'waste-recycling-scale.exe'),
        path.join(programFiles, appName, 'waste-recycling-scale.exe'),
        appPath // 如果找不到，使用当前路径
      ];

      // 创建批处理脚本
      // 脚本会：1. 启动 MSI 安装 2. 等待安装完成 3. 启动新版本应用
      const scriptContent = `@echo off
REM Start MSI installation in background
start /wait "" msiexec.exe /i "${installerPath}" /qn /norestart /L*v "${logFile}"

REM Wait for msiexec to completely finish
:wait
tasklist /FI "IMAGENAME eq msiexec.exe" 2>NUL | find /I /N "msiexec.exe">NUL
if "%ERRORLEVEL%"=="0" (
  timeout /t 2 /nobreak >NUL
  goto wait
)

REM Wait a bit more to ensure installation is complete
timeout /t 3 /nobreak >NUL

REM Try to start the application from possible locations
${possiblePaths.map(p => `if exist "${p}" (
  start "" "${p}"
  goto :started
)`).join('\n')}

:started
REM Clean up script after a delay
timeout /t 2 /nobreak >NUL
del "%~f0"
`;

      fs.writeFileSync(scriptPath, scriptContent, 'utf8');
      console.log(`Created restart script: ${scriptPath}`);
      return scriptPath;
    } catch (error) {
      console.error('Failed to create restart script:', error);
      return null;
    }
  }

  /**
   * 获取当前版本
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }
}

