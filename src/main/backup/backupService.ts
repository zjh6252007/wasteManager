import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { getDb } from '../db/connection';
import FormData from 'form-data';

export interface BackupProgress {
  stage: 'preparing' | 'exporting' | 'uploading' | 'completed' | 'error';
  progress: number; // 0-100
  message: string;
}

export interface BackupResult {
  success: boolean;
  message: string;
  backupId?: string;
  timestamp?: string;
}

export class BackupService {
  private backupServerUrl?: string;
  private activationId: number;
  private progressCallback?: (progress: BackupProgress) => void;

  constructor(activationId: number, backupServerUrl?: string) {
    this.activationId = activationId;
    this.backupServerUrl = backupServerUrl;
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback: (progress: BackupProgress) => void) {
    this.progressCallback = callback;
  }

  /**
   * 检查网络连接
   */
  async checkNetworkConnection(): Promise<boolean> {
    if (!this.backupServerUrl) {
      return false;
    }

    try {
      const url = new URL(this.backupServerUrl);
      const client = url.protocol === 'https:' ? https : http;
      
      return new Promise((resolve) => {
        const req = client.get(url, { timeout: 5000 }, (res) => {
          resolve(res.statusCode !== undefined && res.statusCode < 500);
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  /**
   * 导出数据库为JSON
   */
  private async exportDatabase(): Promise<any> {
    const db = getDb();
    const data: any = {
      version: app.getVersion(),
      timestamp: new Date().toISOString(),
      activationId: this.activationId,
      tables: {}
    };

    // 导出所有表的数据
    const tables = [
      'activations',
      'users',
      'customers',
      'metal_types',
      'metal_price_history',
      'vehicles',
      'biometric_data',
      'weighing_sessions',
      'weighings',
      'system_config',
      'user_settings'
    ];

    for (const table of tables) {
      try {
        const rows = db.prepare(`SELECT * FROM ${table} WHERE activation_id = ?`).all(this.activationId);
        data.tables[table] = rows;
      } catch (error) {
        console.error(`Error exporting table ${table}:`, error);
        data.tables[table] = [];
      }
    }

    // 导出所有激活码相关的数据（用于完整备份）
    if (this.activationId) {
      // 如果只需要当前激活码的数据，已经在上面的查询中过滤了
    }

    return data;
  }

  /**
   * 收集需要备份的文件列表
   */
  private async collectFiles(): Promise<string[]> {
    const files: string[] = [];
    const userDataPath = app.getPath('userData');
    
    // 收集生物识别图片
    const db = getDb();
    const biometricData = db.prepare(`
      SELECT face_image_path, fingerprint_image_path, signature_image_path 
      FROM biometric_data 
      WHERE activation_id = ? 
      AND (face_image_path IS NOT NULL OR fingerprint_image_path IS NOT NULL OR signature_image_path IS NOT NULL)
    `).all(this.activationId) as Array<{
      face_image_path?: string;
      fingerprint_image_path?: string;
      signature_image_path?: string;
    }>;

    for (const bio of biometricData) {
      if (bio.face_image_path && fs.existsSync(bio.face_image_path)) {
        files.push(bio.face_image_path);
      }
      if (bio.fingerprint_image_path && fs.existsSync(bio.fingerprint_image_path)) {
        files.push(bio.fingerprint_image_path);
      }
      if (bio.signature_image_path && fs.existsSync(bio.signature_image_path)) {
        files.push(bio.signature_image_path);
      }
    }

    // 收集客户证件照片
    const customers = db.prepare(`
      SELECT license_photo_path 
      FROM customers 
      WHERE activation_id = ? AND license_photo_path IS NOT NULL
    `).all(this.activationId) as Array<{ license_photo_path?: string }>;

    for (const customer of customers) {
      if (customer.license_photo_path && fs.existsSync(customer.license_photo_path)) {
        files.push(customer.license_photo_path);
      }
    }

    // 收集产品照片（如果有）
    const weighings = db.prepare(`
      SELECT product_photo_path 
      FROM weighings 
      WHERE activation_id = ? AND product_photo_path IS NOT NULL
    `).all(this.activationId) as Array<{ product_photo_path?: string }>;

    for (const weighing of weighings) {
      if (weighing.product_photo_path && fs.existsSync(weighing.product_photo_path)) {
        files.push(weighing.product_photo_path);
      }
    }

    return files;
  }

  /**
   * 创建备份包（ZIP格式）
   */
  private async createBackupPackage(): Promise<string> {
    this.reportProgress('preparing', 10, 'Preparing backup...');

    // 导出数据库
    this.reportProgress('exporting', 20, 'Exporting database...');
    const dbData = await this.exportDatabase();

    // 收集文件
    this.reportProgress('exporting', 40, 'Collecting files...');
    const files = await this.collectFiles();

    // 创建临时目录
    const tempDir = app.getPath('temp');
    const backupId = `backup_${this.activationId}_${Date.now()}`;
    const backupDir = path.join(tempDir, backupId);
    
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // 保存数据库JSON
    const dbPath = path.join(backupDir, 'database.json');
    fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2));

    // 复制文件
    this.reportProgress('exporting', 60, 'Copying files...');
    const filesDir = path.join(backupDir, 'files');
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (fs.existsSync(file)) {
        const fileName = path.basename(file);
        const destPath = path.join(filesDir, fileName);
        fs.copyFileSync(file, destPath);
      }
      this.reportProgress('exporting', 60 + Math.floor((i / files.length) * 20), `Copying files... (${i + 1}/${files.length})`);
    }

    // 创建文件清单
    const manifest = {
      database: 'database.json',
      files: files.map(f => path.basename(f)),
      fileCount: files.length,
      timestamp: new Date().toISOString()
    };
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    this.reportProgress('exporting', 90, 'Backup package created');
    return backupDir;
  }

  /**
   * 上传备份到服务器
   */
  private async uploadBackup(backupDir: string): Promise<BackupResult> {
    if (!this.backupServerUrl) {
      throw new Error('Backup server URL not configured');
    }

    this.reportProgress('uploading', 0, 'Preparing upload...');

    // 创建ZIP文件（简化版：直接上传目录，实际应该压缩）
    // 这里我们上传整个目录作为multipart form data
    
    const url = new URL(this.backupServerUrl);
    if (!url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    url.pathname += 'backup/upload';

    return new Promise((resolve, reject) => {
      const formData = this.createFormData(backupDir);
      const client = url.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'POST',
        headers: formData.getHeaders()
      };

      const req = client.request(url, options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            try {
              const result = JSON.parse(responseData);
              this.reportProgress('completed', 100, 'Backup completed successfully');
              resolve({
                success: true,
                message: 'Backup uploaded successfully',
                backupId: result.backupId || `backup_${Date.now()}`,
                timestamp: new Date().toISOString()
              });
            } catch {
              this.reportProgress('completed', 100, 'Backup completed successfully');
              resolve({
                success: true,
                message: 'Backup uploaded successfully',
                timestamp: new Date().toISOString()
              });
            }
          } else {
            this.reportProgress('error', 0, `Upload failed: ${res.statusCode}`);
            reject(new Error(`Upload failed with status ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        this.reportProgress('error', 0, `Upload error: ${error.message}`);
        reject(error);
      });

      // 上传进度跟踪
      const totalSize = this.getDirectorySize(backupDir);
      let uploadedSize = 0;

      formData.on('data', (chunk) => {
        uploadedSize += chunk.length;
        const progress = Math.min(95, Math.floor((uploadedSize / totalSize) * 95));
        this.reportProgress('uploading', progress, `Uploading... ${Math.floor(progress)}%`);
      });

      formData.pipe(req);
    });
  }

  /**
   * 创建FormData
   */
  private createFormData(backupDir: string): FormData {
    const formData = new FormData();

    // 添加数据库文件
    const dbPath = path.join(backupDir, 'database.json');
    if (fs.existsSync(dbPath)) {
      formData.append('database', fs.createReadStream(dbPath), {
        filename: 'database.json',
        contentType: 'application/json'
      });
    }

    // 添加清单文件
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      formData.append('manifest', fs.createReadStream(manifestPath), {
        filename: 'manifest.json',
        contentType: 'application/json'
      });
    }

    // 添加文件
    const filesDir = path.join(backupDir, 'files');
    if (fs.existsSync(filesDir)) {
      const files = fs.readdirSync(filesDir);
      for (const file of files) {
        const filePath = path.join(filesDir, file);
        formData.append('files', fs.createReadStream(filePath), {
          filename: file
        });
      }
    }

    // 添加元数据
    formData.append('activationId', this.activationId.toString());
    formData.append('version', app.getVersion());
    formData.append('timestamp', new Date().toISOString());

    return formData;
  }

  /**
   * 获取目录大小
   */
  private getDirectorySize(dir: string): number {
    let size = 0;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          size += stats.size;
        } else if (stats.isDirectory()) {
          size += this.getDirectorySize(filePath);
        }
      }
    } catch {
      // 忽略错误
    }
    return size;
  }

  /**
   * 执行完整备份
   */
  async performBackup(): Promise<BackupResult> {
    let backupDir: string | null = null;

    try {
      // 检查网络连接
      const isOnline = await this.checkNetworkConnection();
      if (!isOnline) {
        throw new Error('No network connection or backup server unavailable');
      }

      // 创建备份包
      backupDir = await this.createBackupPackage();

      // 上传备份
      const result = await this.uploadBackup(backupDir);

      // 清理临时文件
      if (backupDir && fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }

      return result;
    } catch (error) {
      // 清理临时文件
      if (backupDir && fs.existsSync(backupDir)) {
        try {
          fs.rmSync(backupDir, { recursive: true, force: true });
        } catch {
          // 忽略清理错误
        }
      }

      this.reportProgress('error', 0, error instanceof Error ? error.message : 'Backup failed');
      throw error;
    }
  }

  /**
   * 报告进度
   */
  private reportProgress(stage: BackupProgress['stage'], progress: number, message: string) {
    if (this.progressCallback) {
      this.progressCallback({ stage, progress, message });
    }
  }

  /**
   * 设置备份服务器URL
   */
  setBackupServerUrl(url: string | undefined) {
    this.backupServerUrl = url;
  }
}

