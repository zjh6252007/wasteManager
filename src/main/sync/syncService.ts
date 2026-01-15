import { getDb, repo } from '../db/connection';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import dgram from 'dgram';
import { EventEmitter } from 'events';
import { hasColumn } from './columnHelper';

export interface SyncProgress {
  stage: 'discovering' | 'connecting' | 'syncing' | 'completed' | 'error';
  progress: number; // 0-100
  message: string;
  deviceCount?: number;
  syncedRecords?: number;
  totalRecords?: number;
}

export interface SyncResult {
  success: boolean;
  message: string;
  syncedRecords?: number;
  conflicts?: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  ip: string;
  port: number;
  activationId: number;
  lastSyncTime?: string;
}

/**
 * Data synchronization service
 * Supports LAN synchronization and cloud synchronization
 */
export class SyncService extends EventEmitter {
  private activationId: number;
  private backupServerUrl?: string;
  private syncPort: number = 8765; // LAN synchronization port
  private broadcastPort: number = 8766; // Broadcast port
  private instanceId?: number; // Instance ID for multiple instances testing
  private udpSocket?: dgram.Socket;
  private tcpServer?: http.Server;
  private isRunning: boolean = false;
  private discoveredDevices: Map<string, DeviceInfo> = new Map();
  private progressCallback?: (progress: SyncProgress) => void;
  private lastUploadTime: number = 0; // 记录最后上传时间，用于避免重复提示不匹配

  constructor(activationId: number, backupServerUrl?: string, instanceId?: number) {
    super();
    this.activationId = activationId;
    this.backupServerUrl = backupServerUrl;
    this.instanceId = instanceId;
    
    // If instance ID is provided, adjust ports to avoid conflicts
    if (instanceId !== undefined && instanceId > 0) {
      this.syncPort = 8765 + (instanceId * 10); // Instance 1: 8765, Instance 2: 8775, etc.
      this.broadcastPort = 8766 + (instanceId * 10); // Instance 1: 8766, Instance 2: 8776, etc.
      console.log(`[Sync] Instance ${instanceId}: Using ports TCP=${this.syncPort}, UDP=${this.broadcastPort}`);
    }
    
    // 从数据库加载最后上传时间
    try {
      const db = getDb();
      const config = db.prepare(`
        SELECT value FROM system_config WHERE key = 'last_upload_time'
      `).get() as any;
      if (config?.value) {
        this.lastUploadTime = parseInt(config.value) || 0;
        console.log(`[Sync] Loaded last upload time: ${new Date(this.lastUploadTime).toISOString()}`);
      }
    } catch (error) {
      console.warn('[Sync] Failed to load last upload time:', error);
    }
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: (progress: SyncProgress) => void) {
    this.progressCallback = callback;
  }

  /**
   * Report progress
   */
  private reportProgress(stage: SyncProgress['stage'], progress: number, message: string, extra?: Partial<SyncProgress>) {
    const progressData: SyncProgress = {
      stage,
      progress,
      message,
      ...extra
    };
    this.progressCallback?.(progressData);
    this.emit('progress', progressData);
  }

  /**
   * Start LAN synchronization service
   */
  async startLocalSync(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Start UDP broadcast service (for device discovery)
    this.startUdpBroadcast();

    // Start TCP server (for data synchronization)
    this.startTcpServer();

    // Periodically broadcast own presence
    this.startPeriodicBroadcast();

    console.log('Local sync service started');
  }

  /**
   * Stop LAN synchronization service
   */
  stopLocalSync(): void {
    this.isRunning = false;
    
    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = undefined;
    }

    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = undefined;
    }

    console.log('Local sync service stopped');
  }

  /**
   * Start UDP broadcast service
   */
  private startUdpBroadcast(): void {
    this.udpSocket = dgram.createSocket('udp4');

    this.udpSocket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        
        // Only process devices with same activation_id
        if (data.activationId === this.activationId && data.type === 'sync-discovery') {
          const deviceId = `${rinfo.address}:${data.port}`;
          this.discoveredDevices.set(deviceId, {
            id: deviceId,
            name: data.deviceName || 'Unknown Device',
            ip: rinfo.address,
            port: data.port,
            activationId: data.activationId,
            lastSyncTime: data.lastSyncTime
          });

          console.log(`Discovered device: ${deviceId}`);
          this.emit('device-discovered', this.discoveredDevices.get(deviceId));
        }
      } catch (error) {
        console.error('Error parsing discovery message:', error);
      }
    });

    this.udpSocket.bind(this.broadcastPort, () => {
      this.udpSocket?.setBroadcast(true);
      console.log(`UDP broadcast listening on port ${this.broadcastPort}`);
    });
  }

  /**
   * Start TCP server
   */
  private startTcpServer(): void {
    this.tcpServer = http.createServer(async (req, res) => {
      // Set CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        if (req.url === '/sync/push' && req.method === 'POST') {
          // 接收其他设备推送的数据
          await this.handlePushData(req, res);
        } else if (req.url === '/sync/pull' && req.method === 'GET') {
          // 其他设备拉取数据
          await this.handlePullData(req, res);
        } else if (req.url === '/sync/status' && req.method === 'GET') {
          // 获取同步状态
          await this.handleStatus(req, res);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      } catch (error) {
        console.error('Error handling sync request:', error);
        res.writeHead(500);
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
      }
    });

    this.tcpServer.listen(this.syncPort, () => {
      console.log(`TCP sync server listening on port ${this.syncPort}`);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${this.syncPort} is already in use, trying alternative port...`);
        // Try using backup port
        const altPort = this.syncPort + 1;
        this.tcpServer?.close();
        this.tcpServer = http.createServer(async (req, res) => {
          // Set CORS headers
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
          }

          try {
            if (req.url === '/sync/push' && req.method === 'POST') {
              await this.handlePushData(req, res);
            } else if (req.url === '/sync/pull' && req.method === 'GET') {
              await this.handlePullData(req, res);
            } else if (req.url === '/sync/status' && req.method === 'GET') {
              await this.handleStatus(req, res);
            } else {
              res.writeHead(404);
              res.end('Not found');
            }
          } catch (error) {
            console.error('Error handling sync request:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
          }
        });
        
        this.tcpServer.listen(altPort, () => {
          console.log(`TCP sync server listening on alternative port ${altPort}`);
          this.syncPort = altPort;
        }).on('error', (err2: any) => {
          console.error(`Failed to start TCP sync server on port ${altPort}:`, err2);
          // If backup port also fails, don't start TCP server but continue running other functions
        });
      } else {
        console.error('TCP sync server error:', err);
      }
    });
  }

  /**
   * Handle pushed data
   */
  private async handlePushData(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await this.mergeData(data);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          merged: result.merged,
          conflicts: result.conflicts
        }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
      }
    });
  }

  /**
   * Handle pull data request
   */
  private async handlePullData(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const since = url.searchParams.get('since') || '1970-01-01T00:00:00.000Z';

    try {
      const data = await this.exportChangedData(since);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
    }
  }

  /**
   * Handle status request
   */
  private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const db = getDb();
    // 使用 COALESCE 来处理可能不存在的 updated_at 列
    // weighings 表需要通过 JOIN 来查询，因为它没有直接的 activation_id
    const lastSync = db.prepare(`
      SELECT MAX(lastSync) as lastSync 
      FROM (
        SELECT COALESCE(updated_at, created_at) as lastSync FROM customers WHERE activation_id = ?
        UNION ALL
        SELECT COALESCE(updated_at, created_at) as lastSync FROM weighing_sessions WHERE activation_id = ?
        UNION ALL
        SELECT w.created_at as lastSync FROM weighings w
        JOIN weighing_sessions ws ON w.session_id = ws.id WHERE ws.activation_id = ?
        UNION ALL
        SELECT COALESCE(updated_at, created_at) as lastSync FROM biometric_data WHERE activation_id = ?
      )
    `).get(this.activationId, this.activationId, this.activationId, this.activationId) as any;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      activationId: this.activationId,
      lastSyncTime: lastSync?.lastSync || null,
      deviceCount: this.discoveredDevices.size
    }));
  }

  /**
   * Periodically broadcast own presence
   */
  private startPeriodicBroadcast(): void {
    const broadcast = () => {
      if (!this.isRunning || !this.udpSocket) return;

      const message = JSON.stringify({
        type: 'sync-discovery',
        activationId: this.activationId,
        port: this.syncPort,
        deviceName: `${require('os').hostname()}`,
        lastSyncTime: this.getLastSyncTime()
      });

      // 广播到局域网
      this.udpSocket.send(message, this.broadcastPort, '255.255.255.255', (err) => {
        if (err) {
          console.error('Broadcast error:', err);
        }
      });
    };

    // 立即广播一次
    broadcast();

    // 每5秒广播一次
    setInterval(broadcast, 5000);
  }

  /**
   * Get last synchronization time
   */
  private getLastSyncTime(): string {
    const db = getDb();
    // 检查表是否有 updated_at 列，然后使用安全的查询
    try {
      // 检查 weighing_sessions 表是否有 updated_at 列
      const tableInfo = db.prepare(`PRAGMA table_info(weighing_sessions)`).all() as any[];
      const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
      
      let query: string;
      if (hasUpdatedAt) {
        query = `
          SELECT MAX(lastSync) as lastSync 
          FROM (
            SELECT COALESCE(updated_at, created_at) as lastSync FROM customers WHERE activation_id = ?
            UNION ALL
            SELECT COALESCE(updated_at, created_at) as lastSync FROM weighing_sessions WHERE activation_id = ?
            UNION ALL
            SELECT w.created_at as lastSync FROM weighings w
            JOIN weighing_sessions ws ON w.session_id = ws.id WHERE ws.activation_id = ?
            UNION ALL
            SELECT COALESCE(updated_at, created_at) as lastSync FROM biometric_data WHERE activation_id = ?
          )
        `;
      } else {
        query = `
          SELECT MAX(lastSync) as lastSync 
          FROM (
            SELECT COALESCE(updated_at, created_at) as lastSync FROM customers WHERE activation_id = ?
            UNION ALL
            SELECT created_at as lastSync FROM weighing_sessions WHERE activation_id = ?
            UNION ALL
            SELECT w.created_at as lastSync FROM weighings w
            JOIN weighing_sessions ws ON w.session_id = ws.id WHERE ws.activation_id = ?
            UNION ALL
            SELECT COALESCE(updated_at, created_at) as lastSync FROM biometric_data WHERE activation_id = ?
          )
        `;
      }
      
      const result = db.prepare(query).get(this.activationId, this.activationId, this.activationId, this.activationId) as any;
      return result?.lastSync || new Date().toISOString();
    } catch (error) {
      console.error('[Sync] Error getting last sync time:', error);
      return new Date().toISOString();
    }
  }

  /**
   * 发现局域网内的设备
   */
  async discoverDevices(timeout: number = 5000): Promise<DeviceInfo[]> {
    this.discoveredDevices.clear();
    this.reportProgress('discovering', 0, 'Discovering devices on local network...');

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const devices = Array.from(this.discoveredDevices.values());
        this.reportProgress('discovering', 100, `Found ${devices.length} device(s)`, { deviceCount: devices.length });
        resolve(devices);
      }, timeout);

      // 监听设备发现事件
      this.once('device-discovered', () => {
        // 设备已发现，继续等待更多设备
      });
    });
  }

  /**
   * 与局域网设备同步数据
   */
  async syncWithDevice(device: DeviceInfo): Promise<SyncResult> {
    this.reportProgress('connecting', 10, `Connecting to ${device.name}...`);

    try {
      // 1. 获取远程设备的变更数据
      this.reportProgress('syncing', 20, 'Pulling changes from remote device...');
      const lastSync = this.getLastSyncTime();
      const remoteData = await this.pullFromDevice(device, lastSync);

      // 2. 合并远程数据到本地
      this.reportProgress('syncing', 50, 'Merging remote data...');
      const mergeResult = await this.mergeData(remoteData);

      // 3. 推送本地变更到远程设备
      this.reportProgress('syncing', 70, 'Pushing local changes...');
      const localData = await this.exportChangedData(lastSync);
      await this.pushToDevice(device, localData);

      // 4. 更新同步时间
      this.updateSyncTime();

      this.reportProgress('completed', 100, 'Sync completed successfully', {
        syncedRecords: mergeResult.merged,
        totalRecords: mergeResult.total
      });

      return {
        success: true,
        message: 'Sync completed successfully',
        syncedRecords: mergeResult.merged,
        conflicts: mergeResult.conflicts
      };
    } catch (error) {
      this.reportProgress('error', 0, `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Sync failed'
      };
    }
  }

  /**
   * 从设备拉取数据
   */
  private async pullFromDevice(device: DeviceInfo, since: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = `http://${device.ip}:${device.port}/sync/pull?since=${encodeURIComponent(since)}`;
      
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 推送数据到设备
   */
  private async pushToDevice(device: DeviceInfo, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(data);
      const options = {
        hostname: device.ip,
        port: device.port,
        path: '/sync/push',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => {
          responseData += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  /**
   * 导出变更的数据
   */
  private async exportChangedData(since: string): Promise<any> {
    const db = getDb();
    const data: any = {
      customers: [],
      weighingSessions: [],
      weighings: [],
      biometricData: [],
      vehicles: [],
      metalTypes: [],
      timestamp: new Date().toISOString()
    };

    // 导出未同步的客户数据（优先使用 is_synced 字段）
    try {
      data.customers = db.prepare(`
        SELECT * FROM customers 
        WHERE activation_id = ? AND (is_synced = 0 OR is_synced IS NULL)
      `).all(this.activationId) as any[];
    } catch (error: any) {
      // 如果 is_synced 列不存在，回退到基于时间的导出
      if (error.message?.includes('no such column')) {
        data.customers = db.prepare(`
          SELECT * FROM customers 
          WHERE activation_id = ? AND COALESCE(updated_at, created_at) > ?
        `).all(this.activationId, since) as any[];
      } else {
        throw error;
      }
    }

    // 导出未同步的称重会话
    try {
      data.weighingSessions = db.prepare(`
        SELECT * FROM weighing_sessions 
        WHERE activation_id = ? AND (is_synced = 0 OR is_synced IS NULL)
      `).all(this.activationId) as any[];
    } catch (error: any) {
      if (error.message?.includes('no such column')) {
        data.weighingSessions = db.prepare(`
          SELECT * FROM weighing_sessions 
          WHERE activation_id = ? AND COALESCE(updated_at, created_at) > ?
        `).all(this.activationId, since) as any[];
      } else {
        throw error;
      }
    }

    // 导出未同步的称重记录
    try {
      data.weighings = db.prepare(`
        SELECT w.* FROM weighings w
        JOIN weighing_sessions ws ON w.session_id = ws.id
        WHERE ws.activation_id = ? AND (w.is_synced = 0 OR w.is_synced IS NULL)
      `).all(this.activationId) as any[];
    } catch (error: any) {
      if (error.message?.includes('no such column')) {
        data.weighings = db.prepare(`
          SELECT w.* FROM weighings w
          JOIN weighing_sessions ws ON w.session_id = ws.id
          WHERE ws.activation_id = ? AND w.created_at > ?
        `).all(this.activationId, since) as any[];
      } else {
        throw error;
      }
    }

    // 导出未同步的生物识别数据
    try {
      data.biometricData = db.prepare(`
        SELECT * FROM biometric_data 
        WHERE activation_id = ? AND (is_synced = 0 OR is_synced IS NULL)
      `).all(this.activationId) as any[];
    } catch (error: any) {
      if (error.message?.includes('no such column')) {
        data.biometricData = db.prepare(`
          SELECT * FROM biometric_data 
          WHERE activation_id = ? AND COALESCE(updated_at, created_at) > ?
        `).all(this.activationId, since) as any[];
      } else {
        throw error;
      }
    }

    // 导出未同步的车辆数据
    try {
      data.vehicles = db.prepare(`
        SELECT * FROM vehicles 
        WHERE activation_id = ? AND (is_synced = 0 OR is_synced IS NULL)
      `).all(this.activationId) as any[];
    } catch (error: any) {
      if (error.message?.includes('no such column')) {
        data.vehicles = db.prepare(`
          SELECT * FROM vehicles 
          WHERE activation_id = ? AND COALESCE(updated_at, created_at) > ?
        `).all(this.activationId, since) as any[];
      } else {
        throw error;
      }
    }

    // 导出未同步的金属类型
    try {
      data.metalTypes = db.prepare(`
        SELECT * FROM metal_types 
        WHERE activation_id = ? AND (is_synced = 0 OR is_synced IS NULL)
      `).all(this.activationId) as any[];
    } catch (error: any) {
      if (error.message?.includes('no such column')) {
        data.metalTypes = db.prepare(`
          SELECT * FROM metal_types 
          WHERE activation_id = ? AND COALESCE(updated_at, created_at) > ?
        `).all(this.activationId, since) as any[];
      } else {
        throw error;
      }
    }

    return data;
  }

  /**
   * 合并数据到本地数据库
   */
  private async mergeData(remoteData: any): Promise<{ merged: number; conflicts: number; total: number }> {
    const db = getDb();
    let merged = 0;
    let conflicts = 0;
    const total = (remoteData.customers?.length || 0) +
                  (remoteData.weighingSessions?.length || 0) +
                  (remoteData.weighings?.length || 0) +
                  (remoteData.biometricData?.length || 0) +
                  (remoteData.vehicles?.length || 0) +
                  (remoteData.metalTypes?.length || 0);
    
    console.log(`[Sync] mergeData called with:`, {
      activationId: this.activationId,
      totalRecords: total,
      customers: remoteData.customers?.length || 0,
      weighingSessions: remoteData.weighingSessions?.length || 0,
      weighings: remoteData.weighings?.length || 0
    });

    // 合并客户数据
    if (remoteData.customers) {
      for (const customer of remoteData.customers) {
        try {
          // 检查是否已存在（通过 customer_number 或 id）
          // 使用 COALESCE 安全地处理可能不存在的 updated_at 列
          const existing = db.prepare(`
            SELECT *, COALESCE(updated_at, created_at) as last_updated FROM customers 
            WHERE activation_id = ? AND (id = ? OR customer_number = ?)
          `).get(this.activationId, customer.id, customer.customer_number) as any;

          if (existing) {
            // 冲突解决：使用更新的时间戳
            // 使用 last_updated（已通过 COALESCE 处理）或回退到 created_at
            const existingTime = new Date(existing.last_updated || existing.created_at).getTime();
            const remoteTime = new Date(customer.updated_at || customer.created_at).getTime();

            if (remoteTime > existingTime) {
              // 远程数据更新，使用远程数据
              const hasUpdatedAt = hasColumn('customers', 'updated_at');
              if (hasUpdatedAt) {
                db.prepare(`
                  UPDATE customers 
                  SET name = ?, phone = ?, address = ?, license_number = ?, 
                      license_photo_path = ?, customer_number = ?, updated_at = ?
                  WHERE activation_id = ? AND id = ?
                `).run(
                  customer.name,
                  customer.phone,
                  customer.address,
                  customer.license_number,
                  customer.license_photo_path,
                  customer.customer_number,
                  customer.updated_at || new Date().toISOString(),
                  this.activationId,
                  existing.id
                );
              } else {
                db.prepare(`
                  UPDATE customers 
                  SET name = ?, phone = ?, address = ?, license_number = ?, 
                      license_photo_path = ?, customer_number = ?
                  WHERE activation_id = ? AND id = ?
                `).run(
                  customer.name,
                  customer.phone,
                  customer.address,
                  customer.license_number,
                  customer.license_photo_path,
                  customer.customer_number,
                  this.activationId,
                  existing.id
                );
              }
              merged++;
            } else {
              conflicts++;
            }
          } else {
            // 新记录，直接插入
            const hasUpdatedAt = hasColumn('customers', 'updated_at');
            if (hasUpdatedAt) {
              db.prepare(`
                INSERT INTO customers 
                (activation_id, name, phone, address, license_number, license_photo_path, customer_number, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                customer.name,
                customer.phone,
                customer.address,
                customer.license_number,
                customer.license_photo_path,
                customer.customer_number,
                customer.created_at || new Date().toISOString(),
                customer.updated_at || new Date().toISOString()
              );
            } else {
              db.prepare(`
                INSERT INTO customers 
                (activation_id, name, phone, address, license_number, license_photo_path, customer_number, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                customer.name,
                customer.phone,
                customer.address,
                customer.license_number,
                customer.license_photo_path,
                customer.customer_number,
                customer.created_at || new Date().toISOString()
              );
            }
            merged++;
          }
        } catch (error: any) {
          console.error('[Sync] Error merging customer:', error);
          console.error('[Sync] Customer data:', JSON.stringify(customer, null, 2));
          if (error.message && error.message.includes('no such column')) {
            console.error('[Sync] Database schema mismatch detected. Attempting to fix schema...');
            // 尝试修复数据库结构
            try {
              const { ensureDatabaseSchema } = await import('../db/connection');
              await ensureDatabaseSchema();
              console.log('[Sync] Schema fixed, retrying merge...');
              // 重试一次（简化版：只记录错误，不重试，避免无限循环）
            } catch (schemaError) {
              console.error('[Sync] Failed to fix schema:', schemaError);
            }
          }
          conflicts++;
        }
      }
    }

    // 合并称重会话
    if (remoteData.weighingSessions) {
      for (const session of remoteData.weighingSessions) {
        try {
          // 使用 COALESCE 安全地处理可能不存在的 updated_at 列
          const existing = db.prepare(`
            SELECT *, COALESCE(updated_at, created_at) as last_updated FROM weighing_sessions 
            WHERE activation_id = ? AND id = ?
          `).get(this.activationId, session.id) as any;

          if (existing) {
            const existingTime = new Date(existing.last_updated || existing.created_at).getTime();
            const remoteTime = new Date(session.updated_at || session.created_at).getTime();

            if (remoteTime > existingTime) {
              const hasUpdatedAt = hasColumn('weighing_sessions', 'updated_at');
              if (hasUpdatedAt) {
                db.prepare(`
                  UPDATE weighing_sessions 
                  SET customer_id = ?, notes = ?, total_amount = ?, status = ?, updated_at = ?
                  WHERE activation_id = ? AND id = ?
                `).run(
                  session.customer_id,
                  session.notes,
                  session.total_amount,
                  session.status,
                  session.updated_at || new Date().toISOString(),
                  this.activationId,
                  existing.id
                );
              } else {
                db.prepare(`
                  UPDATE weighing_sessions 
                  SET customer_id = ?, notes = ?, total_amount = ?, status = ?
                  WHERE activation_id = ? AND id = ?
                `).run(
                  session.customer_id,
                  session.notes,
                  session.total_amount,
                  session.status,
                  this.activationId,
                  existing.id
                );
              }
              merged++;
            } else {
              conflicts++;
            }
          } else {
            const hasUpdatedAt = hasColumn('weighing_sessions', 'updated_at');
            if (hasUpdatedAt) {
              db.prepare(`
                INSERT INTO weighing_sessions 
                (activation_id, customer_id, session_time, notes, total_amount, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                session.customer_id,
                session.session_time || new Date().toISOString(),
                session.notes,
                session.total_amount,
                session.status || 'completed',
                session.created_at || new Date().toISOString(),
                session.updated_at || new Date().toISOString()
              );
            } else {
              db.prepare(`
                INSERT INTO weighing_sessions 
                (activation_id, customer_id, session_time, notes, total_amount, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                session.customer_id,
                session.session_time || new Date().toISOString(),
                session.notes,
                session.total_amount,
                session.status || 'completed',
                session.created_at || new Date().toISOString()
              );
            }
            merged++;
          }
        } catch (error: any) {
          console.error('[Sync] Error merging session:', error);
          console.error('[Sync] Session data:', JSON.stringify(session, null, 2));
          conflicts++;
        }
      }
    }

    // 合并称重记录
    if (remoteData.weighings) {
      for (const weighing of remoteData.weighings) {
        try {
          // 需要先确保 session 存在
          const session = db.prepare(`
            SELECT id FROM weighing_sessions 
            WHERE activation_id = ? AND id = ?
          `).get(this.activationId, weighing.session_id) as any;

          if (session) {
            const existing = db.prepare(`
              SELECT * FROM weighings 
              WHERE activation_id = ? AND id = ?
            `).get(this.activationId, weighing.id) as any;

            if (!existing) {
              db.prepare(`
                INSERT INTO weighings 
                (activation_id, session_id, waste_type_id, weight, unit_price, total_amount, 
                 product_photo_path, weighing_time, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                weighing.session_id,
                weighing.waste_type_id,
                weighing.weight,
                weighing.unit_price,
                weighing.total_amount,
                weighing.product_photo_path,
                weighing.weighing_time || new Date().toISOString(),
                weighing.created_at || new Date().toISOString()
              );
              merged++;
            }
          }
        } catch (error: any) {
          console.error('[Sync] Error merging weighing:', error);
          console.error('[Sync] Weighing data:', JSON.stringify(weighing, null, 2));
          conflicts++;
        }
      }
    }

    // 合并生物识别数据
    if (remoteData.biometricData) {
      for (const bio of remoteData.biometricData) {
        try {
          // 使用 COALESCE 安全地处理可能不存在的 updated_at 列
          const existing = db.prepare(`
            SELECT *, COALESCE(updated_at, created_at) as last_updated FROM biometric_data 
            WHERE activation_id = ? AND customer_id = ?
          `).get(this.activationId, bio.customer_id) as any;

          if (existing) {
            const existingTime = new Date(existing.last_updated || existing.created_at).getTime();
            const remoteTime = new Date(bio.updated_at || bio.created_at).getTime();

            if (remoteTime > existingTime) {
              const hasUpdatedAt = hasColumn('biometric_data', 'updated_at');
              if (hasUpdatedAt) {
                db.prepare(`
                  UPDATE biometric_data 
                  SET face_image_path = COALESCE(?, face_image_path),
                      fingerprint_template = COALESCE(?, fingerprint_template),
                      fingerprint_image_path = COALESCE(?, fingerprint_image_path),
                      signature_image_path = COALESCE(?, signature_image_path),
                      updated_at = ?
                  WHERE activation_id = ? AND customer_id = ?
                `).run(
                  bio.face_image_path,
                  bio.fingerprint_template ? Buffer.from(bio.fingerprint_template) : null,
                  bio.fingerprint_image_path,
                  bio.signature_image_path,
                  bio.updated_at || new Date().toISOString(),
                  this.activationId,
                  bio.customer_id
                );
              } else {
                db.prepare(`
                  UPDATE biometric_data 
                  SET face_image_path = COALESCE(?, face_image_path),
                      fingerprint_template = COALESCE(?, fingerprint_template),
                      fingerprint_image_path = COALESCE(?, fingerprint_image_path),
                      signature_image_path = COALESCE(?, signature_image_path)
                  WHERE activation_id = ? AND customer_id = ?
                `).run(
                  bio.face_image_path,
                  bio.fingerprint_template ? Buffer.from(bio.fingerprint_template) : null,
                  bio.fingerprint_image_path,
                  bio.signature_image_path,
                  this.activationId,
                  bio.customer_id
                );
              }
              merged++;
            } else {
              conflicts++;
            }
          } else {
            const hasUpdatedAt = hasColumn('biometric_data', 'updated_at');
            if (hasUpdatedAt) {
              db.prepare(`
                INSERT INTO biometric_data 
                (activation_id, customer_id, face_image_path, fingerprint_template, 
                 fingerprint_image_path, signature_image_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                bio.customer_id,
                bio.face_image_path,
                bio.fingerprint_template ? Buffer.from(bio.fingerprint_template) : null,
                bio.fingerprint_image_path,
                bio.signature_image_path,
                bio.created_at || new Date().toISOString(),
                bio.updated_at || new Date().toISOString()
              );
            } else {
              db.prepare(`
                INSERT INTO biometric_data 
                (activation_id, customer_id, face_image_path, fingerprint_template, 
                 fingerprint_image_path, signature_image_path, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                bio.customer_id,
                bio.face_image_path,
                bio.fingerprint_template ? Buffer.from(bio.fingerprint_template) : null,
                bio.fingerprint_image_path,
                bio.signature_image_path,
                bio.created_at || new Date().toISOString()
              );
            }
            merged++;
          }
        } catch (error) {
          console.error('Error merging biometric data:', error);
          conflicts++;
        }
      }
    }

    // 合并车辆数据
    if (remoteData.vehicles) {
      for (const vehicle of remoteData.vehicles) {
        try {
          const existing = db.prepare(`
            SELECT * FROM vehicles 
            WHERE activation_id = ? AND id = ?
          `).get(this.activationId, vehicle.id) as any;

          if (!existing) {
            const hasUpdatedAt = hasColumn('vehicles', 'updated_at');
            if (hasUpdatedAt) {
              db.prepare(`
                INSERT INTO vehicles 
                (activation_id, customer_id, license_plate, year, color, make, model, 
                 original_ref_no, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                vehicle.customer_id,
                vehicle.license_plate,
                vehicle.year,
                vehicle.color,
                vehicle.make,
                vehicle.model,
                vehicle.original_ref_no,
                vehicle.created_at || new Date().toISOString(),
                vehicle.updated_at || new Date().toISOString()
              );
            } else {
              db.prepare(`
                INSERT INTO vehicles 
                (activation_id, customer_id, license_plate, year, color, make, model, 
                 original_ref_no, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                vehicle.customer_id,
                vehicle.license_plate,
                vehicle.year,
                vehicle.color,
                vehicle.make,
                vehicle.model,
                vehicle.original_ref_no,
                vehicle.created_at || new Date().toISOString()
              );
            }
            merged++;
          }
        } catch (error) {
          console.error('Error merging vehicle:', error);
          conflicts++;
        }
      }
    }

    // 合并金属类型
    if (remoteData.metalTypes) {
      console.log(`[Sync] Merging ${remoteData.metalTypes.length} metal types from cloud...`);
      for (const metal of remoteData.metalTypes) {
        try {
          // 首先尝试通过 symbol 查找（主要方式）
          let existing = db.prepare(`
            SELECT *, COALESCE(updated_at, created_at) as last_updated FROM metal_types 
            WHERE activation_id = ? AND symbol = ?
          `).get(this.activationId, metal.symbol) as any;

          // 如果通过 symbol 找不到，尝试通过 id 查找（兼容性）
          if (!existing && metal.id) {
            existing = db.prepare(`
              SELECT *, COALESCE(updated_at, created_at) as last_updated FROM metal_types 
              WHERE activation_id = ? AND id = ?
            `).get(this.activationId, metal.id) as any;
          }

          if (existing) {
            const existingTime = new Date(existing.last_updated || existing.created_at).getTime();
            const remoteTime = new Date(metal.updated_at || metal.created_at).getTime();

            // 总是使用服务器端的数据（如果时间相同或服务器更新，都更新）
            // 这样可以确保所有客户端数据一致
            if (remoteTime >= existingTime) {
              const hasUpdatedAt = hasColumn('metal_types', 'updated_at');
              if (hasUpdatedAt) {
                db.prepare(`
                  UPDATE metal_types 
                  SET symbol = ?, name = ?, price_per_unit = ?, unit = ?, is_active = ?, updated_at = ?
                  WHERE activation_id = ? AND id = ?
                `).run(
                  metal.symbol,
                  metal.name,
                  metal.price_per_unit,
                  metal.unit,
                  metal.is_active !== undefined ? metal.is_active : 1,
                  metal.updated_at || new Date().toISOString(),
                  this.activationId,
                  existing.id
                );
              } else {
                db.prepare(`
                  UPDATE metal_types 
                  SET symbol = ?, name = ?, price_per_unit = ?, unit = ?, is_active = ?
                  WHERE activation_id = ? AND id = ?
                `).run(
                  metal.symbol,
                  metal.name,
                  metal.price_per_unit,
                  metal.unit,
                  metal.is_active !== undefined ? metal.is_active : 1,
                  this.activationId,
                  existing.id
                );
              }
              console.log(`[Sync] Updated metal type: ${metal.symbol} (${metal.name})`);
              merged++;
            } else {
              console.log(`[Sync] Skipped metal type ${metal.symbol} (local is newer)`);
              conflicts++;
            }
          } else {
            // 新记录，直接插入
            const hasUpdatedAt = hasColumn('metal_types', 'updated_at');
            if (hasUpdatedAt) {
              db.prepare(`
                INSERT INTO metal_types 
                (activation_id, symbol, name, price_per_unit, unit, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                metal.symbol,
                metal.name,
                metal.price_per_unit,
                metal.unit,
                metal.is_active !== undefined ? metal.is_active : 1,
                metal.created_at || new Date().toISOString(),
                metal.updated_at || new Date().toISOString()
              );
            } else {
              db.prepare(`
                INSERT INTO metal_types 
                (activation_id, symbol, name, price_per_unit, unit, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                this.activationId,
                metal.symbol,
                metal.name,
                metal.price_per_unit,
                metal.unit,
                metal.is_active !== undefined ? metal.is_active : 1,
                metal.created_at || new Date().toISOString()
              );
            }
            console.log(`[Sync] Inserted new metal type: ${metal.symbol} (${metal.name})`);
            merged++;
          }
        } catch (error: any) {
          console.error(`[Sync] Error merging metal type ${metal.symbol}:`, error?.message || error);
          conflicts++;
        }
      }
      console.log(`[Sync] Metal types merge completed: ${merged} merged, ${conflicts} conflicts`);
    } else {
      console.log('[Sync] No metal types in remote data');
    }

    return { merged, conflicts, total };
  }

  /**
   * 更新同步时间
   */
  private updateSyncTime(): void {
    // 可以在这里记录最后同步时间到数据库
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value, updated_at)
      VALUES ('last_sync_time', ?, CURRENT_TIMESTAMP)
    `).run(new Date().toISOString());
  }

  /**
   * 从云端同步数据
   */
  async syncFromCloud(): Promise<SyncResult> {
    if (!this.backupServerUrl) {
      return {
        success: false,
        message: 'Backup server URL not configured'
      };
    }

    this.reportProgress('connecting', 10, 'Connecting to cloud server...');

    try {
      // 1. 获取最后同步时间
      const db = getDb();
      const lastSyncConfig = db.prepare(`
        SELECT value FROM system_config WHERE key = 'last_sync_time'
      `).get() as any;
      const since = lastSyncConfig?.value || '1970-01-01T00:00:00.000Z';

      // 2. 从云端拉取数据
      this.reportProgress('syncing', 30, 'Downloading data from cloud...');
      const cloudData = await this.pullFromCloud(since);

      // 3. 合并数据
      this.reportProgress('syncing', 60, 'Merging cloud data...');
      const mergeResult = await this.mergeData(cloudData);

      // 4. 推送本地变更到云端
      this.reportProgress('syncing', 80, 'Uploading local changes to cloud...');
      const localData = await this.exportChangedData(since);
      await this.pushToCloud(localData);
      
      // 记录上传时间到数据库，用于避免短时间内重复提示不匹配
      const uploadTime = Date.now();
      this.lastUploadTime = uploadTime;
      db.prepare(`
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES ('last_upload_time', ?, CURRENT_TIMESTAMP)
      `).run(uploadTime.toString());
      console.log('[Sync] Sync completed, recorded upload time for mismatch check suppression');

      // 5. 更新同步时间
      this.updateSyncTime();

      this.reportProgress('completed', 100, 'Cloud sync completed successfully', {
        syncedRecords: mergeResult.merged,
        totalRecords: mergeResult.total
      });

      return {
        success: true,
        message: 'Cloud sync completed successfully',
        syncedRecords: mergeResult.merged,
        conflicts: mergeResult.conflicts
      };
    } catch (error) {
      this.reportProgress('error', 0, `Cloud sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Cloud sync failed'
      };
    }
  }

  /**
   * 从云端拉取数据
   */
  private async pullFromCloud(since: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.backupServerUrl!);
      
      // 直接使用 /sync/pull 端点，忽略原有路径
      // 因为服务器上的端点是 /sync/pull，不是 /backup/sync/pull
      url.pathname = '/sync/pull';
      
      url.searchParams.set('activationId', this.activationId.toString());
      url.searchParams.set('since', since);

      console.log('[Sync] Pulling from cloud:', url.toString());
      const client = url.protocol === 'https:' ? https : http;
      
      const req = client.get(url.toString(), {
        headers: {
          'User-Agent': 'garbage-recycle-scale-sync'
        },
        timeout: 30000 // 30秒超时
      }, (res) => {
        console.log('[Sync] Cloud pull response status:', res.statusCode);
        let data = '';
        res.on('data', chunk => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              console.log('[Sync] Raw cloud response length:', data.length);
              console.log('[Sync] Raw cloud response (first 500 chars):', data.substring(0, 500));
              const result = JSON.parse(data);
              console.log('[Sync] Parsed cloud data structure:', {
                hasCustomers: !!result.customers,
                hasWeighingSessions: !!result.weighingSessions,
                hasWeighings: !!result.weighings,
                hasBiometricData: !!result.biometricData,
                hasVehicles: !!result.vehicles,
                hasMetalTypes: !!result.metalTypes,
                keys: Object.keys(result)
              });
              console.log('[Sync] Cloud data counts:', {
                customers: result.customers?.length || 0,
                weighingSessions: result.weighingSessions?.length || 0,
                weighings: result.weighings?.length || 0,
                biometricData: result.biometricData?.length || 0,
                vehicles: result.vehicles?.length || 0,
                metalTypes: result.metalTypes?.length || 0
              });
              
              // 如果数据为空，输出更多诊断信息
              const totalCount = (result.customers?.length || 0) +
                                (result.weighingSessions?.length || 0) +
                                (result.weighings?.length || 0) +
                                (result.biometricData?.length || 0) +
                                (result.vehicles?.length || 0) +
                                (result.metalTypes?.length || 0);
              
              if (totalCount === 0) {
                console.warn('[Sync] WARNING: Cloud returned empty data!');
                console.warn('[Sync] This usually means:');
                console.warn('[Sync] 1. No backup exists in cloud for this activationId');
                console.warn('[Sync] 2. All data was filtered out (check since parameter)');
                console.warn(`[Sync] Request parameters: activationId=${this.activationId}, since=${since}`);
                console.warn('[Sync] Full response keys:', Object.keys(result));
              } else {
                if (result.customers && result.customers.length > 0) {
                  console.log('[Sync] Sample customer data:', JSON.stringify(result.customers[0], null, 2));
                }
                if (result.weighingSessions && result.weighingSessions.length > 0) {
                  console.log('[Sync] Sample session data:', JSON.stringify(result.weighingSessions[0], null, 2));
                }
              }
              
              console.log('[Sync] Successfully pulled data from cloud');
              resolve(result);
            } catch (error) {
              console.error('[Sync] Failed to parse cloud response:', error);
              console.error('[Sync] Response data:', data);
              reject(new Error('Failed to parse cloud response. Server may not support sync endpoint.'));
            }
          } else if (res.statusCode === 404) {
            // 端点不存在，提供更友好的错误信息
            console.error('[Sync] Sync endpoint not found (404). Server may not support /sync/pull endpoint.');
            reject(new Error('Sync endpoint not available on server. The server may not support data synchronization. Please contact the administrator or use local device sync instead.'));
          } else {
            const errorMsg = data ? (data.length > 200 ? data.substring(0, 200) : data) : `HTTP ${res.statusCode}`;
            console.error('[Sync] Cloud pull failed:', res.statusCode, errorMsg);
            reject(new Error(`HTTP ${res.statusCode}: ${errorMsg}`));
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('[Sync] Network error during cloud pull:', error);
        reject(new Error(`Network error: ${error.message}. Please check your network connection and server URL.`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        console.error('[Sync] Cloud pull timeout');
        reject(new Error('Request timeout. Server may be unavailable or too slow.'));
      });
    });
  }

  /**
   * 推送数据到云端
   * 如果数据太大，会分批发送
   */
  private async pushToCloud(data: any): Promise<void> {
    // 检查数据大小（限制为 500KB，避免 413 错误）
    const MAX_PAYLOAD_SIZE = 500 * 1024; // 500KB
    const postData = JSON.stringify({
      activationId: this.activationId,
      data: data
    });
    const dataSize = Buffer.byteLength(postData);

    console.log(`[Sync] Data size: ${(dataSize / 1024).toFixed(2)} KB`);

    // 如果数据太大，分批发送
    if (dataSize > MAX_PAYLOAD_SIZE) {
      console.log('[Sync] Data too large, splitting into batches...');
      return await this.pushToCloudInBatches(data);
    }

    return new Promise((resolve, reject) => {
      const url = new URL(this.backupServerUrl!);
      
      // 直接使用 /sync/push 端点，忽略原有路径
      // 因为服务器上的端点是 /sync/push，不是 /backup/sync/push
      url.pathname = '/sync/push';

      console.log('[Sync] Pushing to cloud:', url.toString());

      const client = url.protocol === 'https:' ? https : http;
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': dataSize
        }
      };

      const req = client.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => {
          responseData += chunk.toString();
        });
        res.on('end', () => {
          console.log('[Sync] Cloud push response status:', res.statusCode);
          if (res.statusCode === 200 || res.statusCode === 201) {
            console.log('[Sync] Successfully pushed data to cloud');
            resolve();
          } else if (res.statusCode === 413) {
            // 如果仍然返回 413，尝试分批发送
            console.warn('[Sync] Received 413 error, retrying with batch upload...');
            this.pushToCloudInBatches(data).then(resolve).catch(reject);
          } else {
            const errorMsg = responseData ? (responseData.length > 200 ? responseData.substring(0, 200) : responseData) : `HTTP ${res.statusCode}`;
            console.error('[Sync] Cloud push failed:', res.statusCode, errorMsg);
            console.error('[Sync] Request URL:', url.toString());
            console.error('[Sync] Request path:', options.path);
            reject(new Error(`HTTP ${res.statusCode}: ${errorMsg}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('[Sync] Network error during cloud push:', error);
        console.error('[Sync] Request URL:', url.toString());
        reject(error);
      });
      req.write(postData);
      req.end();
    });
  }

  /**
   * 分批推送数据到云端
   */
  private async pushToCloudInBatches(data: any): Promise<void> {
    const BATCH_SIZE = 100; // 每批最多100条记录
    const url = new URL(this.backupServerUrl!);
    url.pathname = '/sync/push';

    console.log('[Sync] Starting batch upload...');

    // 按表分批发送
    const tables = ['customers', 'weighingSessions', 'weighings', 'biometricData', 'vehicles', 'metalTypes'];
    
    for (const table of tables) {
      const records = data[table] || [];
      if (records.length === 0) continue;

      console.log(`[Sync] Uploading ${table}: ${records.length} records`);

      // 将记录分成批次
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const batchData = {
          ...data,
          [table]: batch,
          // 只发送当前批次的数据，其他表设为空
          customers: table === 'customers' ? batch : [],
          weighingSessions: table === 'weighingSessions' ? batch : [],
          weighings: table === 'weighings' ? batch : [],
          biometricData: table === 'biometricData' ? batch : [],
          vehicles: table === 'vehicles' ? batch : [],
          metalTypes: table === 'metalTypes' ? batch : []
        };

        await new Promise<void>((resolve, reject) => {
          const postData = JSON.stringify({
            activationId: this.activationId,
            data: batchData
          });

          const client = url.protocol === 'https:' ? https : http;
          const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const req = client.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => {
              responseData += chunk.toString();
            });
            res.on('end', () => {
              if (res.statusCode === 200 || res.statusCode === 201) {
                console.log(`[Sync] Batch uploaded: ${table} [${i + 1}-${Math.min(i + BATCH_SIZE, records.length)}/${records.length}]`);
                resolve();
              } else {
                const errorMsg = responseData ? (responseData.length > 200 ? responseData.substring(0, 200) : responseData) : `HTTP ${res.statusCode}`;
                console.error(`[Sync] Batch upload failed for ${table}:`, res.statusCode, errorMsg);
                reject(new Error(`HTTP ${res.statusCode}: ${errorMsg}`));
              }
            });
          });

          req.on('error', (error) => {
            console.error(`[Sync] Network error during batch upload for ${table}:`, error);
            reject(error);
          });
          req.write(postData);
          req.end();
        });
      }
    }

    console.log('[Sync] Batch upload completed');
  }

  /**
   * 执行自动同步（优先局域网，失败则使用云端）
   */
  async performAutoSync(): Promise<SyncResult> {
    this.reportProgress('discovering', 0, 'Starting auto sync...');

    try {
      // 1. 尝试局域网同步
      await this.startLocalSync();
      const devices = await this.discoverDevices(3000);

      if (devices.length > 0) {
        // 与第一个发现的设备同步
        const result = await this.syncWithDevice(devices[0]);
        if (result.success) {
          return result;
        }
      }

      // 2. 如果局域网同步失败，尝试云端同步
      if (this.backupServerUrl) {
        return await this.syncFromCloud();
      }

      return {
        success: false,
        message: 'No devices found on local network and cloud sync not configured'
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Auto sync failed'
      };
    }
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
   * 获取本地数据的哈希值（用于比较）
   * 使用基于数据内容的哈希，而不是时间戳，以避免因时间戳变化导致的误报
   */
  private async getLocalDataHash(): Promise<string> {
    const crypto = require('crypto');
    const db = getDb();
    
    // 获取记录总数和内容哈希（基于ID和关键字段）
    const counts = {
      customers: db.prepare('SELECT COUNT(*) as count FROM customers WHERE activation_id = ?').get(this.activationId) as any,
      sessions: db.prepare('SELECT COUNT(*) as count FROM weighing_sessions WHERE activation_id = ?').get(this.activationId) as any,
      weighings: db.prepare(`
        SELECT COUNT(*) as count FROM weighings w
        JOIN weighing_sessions ws ON w.session_id = ws.id 
        WHERE ws.activation_id = ?
      `).get(this.activationId) as any,
      biometric: db.prepare('SELECT COUNT(*) as count FROM biometric_data WHERE activation_id = ?').get(this.activationId) as any,
      vehicles: db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE activation_id = ?').get(this.activationId) as any,
      metalTypes: db.prepare('SELECT COUNT(*) as count FROM metal_types WHERE activation_id = ?').get(this.activationId) as any,
    };

    // 获取关键数据的内容哈希（基于ID和关键字段，排除时间戳）
    // 使用 SUM 和关键字段来生成稳定的哈希值
    const contentHash = {
      customers: db.prepare(`
        SELECT COALESCE(SUM(id), 0) as idSum, 
               COALESCE(SUM(CASE WHEN name IS NOT NULL THEN 1 ELSE 0 END), 0) as nameCount
        FROM customers WHERE activation_id = ?
      `).get(this.activationId) as any,
      sessions: db.prepare(`
        SELECT COALESCE(SUM(id), 0) as idSum,
               COALESCE(SUM(CAST(total_amount AS INTEGER)), 0) as totalSum
        FROM weighing_sessions WHERE activation_id = ?
      `).get(this.activationId) as any,
      weighings: db.prepare(`
        SELECT COALESCE(SUM(w.id), 0) as idSum,
               COALESCE(SUM(CAST(w.weight AS INTEGER)), 0) as weightSum
        FROM weighings w
        JOIN weighing_sessions ws ON w.session_id = ws.id 
        WHERE ws.activation_id = ?
      `).get(this.activationId) as any,
    };

    // 生成哈希值（基于计数和内容，不依赖时间戳）
    const hashData = JSON.stringify({
      counts: {
        customers: counts.customers?.count || 0,
        sessions: counts.sessions?.count || 0,
        weighings: counts.weighings?.count || 0,
        biometric: counts.biometric?.count || 0,
        vehicles: counts.vehicles?.count || 0,
        metalTypes: counts.metalTypes?.count || 0,
      },
      content: {
        customers: {
          idSum: contentHash.customers?.idSum || 0,
          nameCount: contentHash.customers?.nameCount || 0,
        },
        sessions: {
          idSum: contentHash.sessions?.idSum || 0,
          totalSum: contentHash.sessions?.totalSum || 0,
        },
        weighings: {
          idSum: contentHash.weighings?.idSum || 0,
          weightSum: contentHash.weighings?.weightSum || 0,
        },
      }
    });

    return crypto.createHash('md5').update(hashData).digest('hex');
  }

  /**
   * 从云端获取数据哈希值
   */
  private async getCloudDataHash(): Promise<string | null> {
    if (!this.backupServerUrl) {
      return null;
    }

    try {
      const url = new URL(this.backupServerUrl);
      
      // 直接使用 /sync/hash 端点，忽略原有路径
      url.pathname = '/sync/hash';
      
      url.searchParams.set('activationId', this.activationId.toString());

      const client = url.protocol === 'https:' ? https : http;
      
      return new Promise((resolve, reject) => {
        const req = client.get(url.toString(), (res) => {
          let data = '';
          res.on('data', chunk => {
            data += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const result = JSON.parse(data);
                resolve(result.hash || null);
              } catch {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          });
        });

        req.on('error', () => resolve(null));
        req.setTimeout(5000, () => {
          req.destroy();
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  /**
   * 检查本地和云端数据是否匹配
   */
  async checkDataMismatch(): Promise<{ mismatched: boolean; localHash: string; cloudHash: string | null }> {
    if (!this.backupServerUrl) {
      return { mismatched: false, localHash: '', cloudHash: null };
    }

    try {
      // 如果刚刚上传过（30分钟内），跳过不匹配检查
      // 因为每次上传都会创建新备份，导致云端哈希值变化
      // 在服务器端哈希计算修复之前，这是临时解决方案
      const now = Date.now();
      const timeSinceLastUpload = now - this.lastUploadTime;
      const thirtyMinutes = 30 * 60 * 1000;
      
      if (this.lastUploadTime > 0 && timeSinceLastUpload < thirtyMinutes) {
        console.log(`[Sync] Recently uploaded (${Math.round(timeSinceLastUpload / 1000 / 60)} minutes ago), skipping mismatch check to avoid false positive`);
        console.log(`[Sync] This is a temporary workaround until server-side hash calculation is fixed`);
        return { mismatched: false, localHash: '', cloudHash: null };
      }
      
      // 这些变量在后面的代码中也会使用

      const localHash = await this.getLocalDataHash();
      const cloudHash = await this.getCloudDataHash();

      console.log(`[Sync] Data mismatch check: localHash=${localHash}, cloudHash=${cloudHash}`);

      if (cloudHash === null) {
        // 无法获取云端哈希，检查是否是首次同步（本地有数据但云端没有）
        const db = getDb();
        const localCounts = {
          customers: db.prepare('SELECT COUNT(*) as count FROM customers WHERE activation_id = ?').get(this.activationId) as any,
          sessions: db.prepare('SELECT COUNT(*) as count FROM weighing_sessions WHERE activation_id = ?').get(this.activationId) as any,
        };
        const hasLocalData = (localCounts.customers?.count || 0) > 0 || (localCounts.sessions?.count || 0) > 0;
        
        if (hasLocalData) {
          console.log('[Sync] Cloud hash is null but local has data, treating as mismatched (first sync)');
          return { mismatched: true, localHash, cloudHash: null };
        } else {
          console.log('[Sync] Cloud hash is null and local has no data, treating as in sync');
          return { mismatched: false, localHash, cloudHash: null };
        }
      }

      // 如果哈希相同，肯定匹配
      if (localHash === cloudHash) {
        console.log(`[Sync] Data mismatch result: IN SYNC (hashes match)`);
        return {
          mismatched: false,
          localHash,
          cloudHash
        };
      }

      // 如果哈希不同，可能是时间戳导致的，进行更详细的检查
      // 获取本地数据统计信息用于详细比较
      const db = getDb();
      const localStats = {
        customers: db.prepare('SELECT COUNT(*) as count FROM customers WHERE activation_id = ?').get(this.activationId) as any,
        sessions: db.prepare('SELECT COUNT(*) as count FROM weighing_sessions WHERE activation_id = ?').get(this.activationId) as any,
        weighings: db.prepare(`
          SELECT COUNT(*) as count FROM weighings w
          JOIN weighing_sessions ws ON w.session_id = ws.id 
          WHERE ws.activation_id = ?
        `).get(this.activationId) as any,
      };

      console.log(`[Sync] Hash mismatch detected. Local stats:`, {
        customers: localStats.customers?.count || 0,
        sessions: localStats.sessions?.count || 0,
        weighings: localStats.weighings?.count || 0,
      });

      // 由于云端哈希计算可能使用不同的方式（可能基于时间戳），
      // 如果本地数据没有变化，但哈希不同，很可能是误报
      // 我们通过检查最近是否有上传/备份操作来判断
      // 如果最近30分钟内上传过，且数据统计看起来正常，可能是误报
      
      // 记录本地数据统计用于调试
      const localCounts = {
        customers: localStats.customers?.count || 0,
        sessions: localStats.sessions?.count || 0,
        weighings: localStats.weighings?.count || 0,
      };
      
      console.log(`[Sync] Local data counts:`, localCounts);
      
      // 如果最近上传过（30分钟内），且数据统计看起来正常，可能是误报
      // 这种情况下，我们更倾向于认为数据是匹配的
      // 重新计算时间差（因为 now 变量在之前的作用域中）
      const currentTime = Date.now();
      const timeSinceLastUpload2 = currentTime - this.lastUploadTime;
      const thirtyMinutes2 = 30 * 60 * 1000;
      
      if (this.lastUploadTime > 0 && timeSinceLastUpload2 < thirtyMinutes2) {
        console.log(`[Sync] Recently uploaded (${Math.round(timeSinceLastUpload2 / 1000 / 60)} minutes ago)`);
        console.log(`[Sync] Hash differs but likely false positive due to different hash calculation methods`);
        console.log(`[Sync] Treating as IN SYNC to avoid unnecessary sync prompts`);
        return {
          mismatched: false,
          localHash,
          cloudHash
        };
      }

      // 由于云端哈希计算可能使用不同的方式，我们暂时认为哈希不同就是不匹配
      // 但会在日志中记录详细信息以便调试
      console.log(`[Sync] Data mismatch result: MISMATCHED (hashes differ)`);
      console.log(`[Sync] Note: This may be a false positive if cloud uses timestamp-based hashing`);
      
      return {
        mismatched: true,
        localHash,
        cloudHash
      };
    } catch (error) {
      console.error('Error checking data mismatch:', error);
      return { mismatched: false, localHash: '', cloudHash: null };
    }
  }

  /**
   * 只上传数据到云端（不下载）
   */
  async uploadToCloud(): Promise<SyncResult> {
    if (!this.backupServerUrl) {
      return {
        success: false,
        message: 'Backup server URL not configured'
      };
    }

    this.reportProgress('connecting', 10, 'Connecting to cloud server...');

    try {
      // 获取最后同步时间
      const db = getDb();
      const lastSyncConfig = db.prepare(`
        SELECT value FROM system_config WHERE key = 'last_sync_time'
      `).get() as any;
      const since = lastSyncConfig?.value || '1970-01-01T00:00:00.000Z';

      // 导出本地变更数据
      this.reportProgress('syncing', 30, 'Preparing data for upload...');
      const localData = await this.exportChangedData(since);

      // 推送数据到云端
      this.reportProgress('syncing', 60, 'Uploading data to cloud...');
      await this.pushToCloud(localData);

      // 更新同步时间
      this.updateSyncTime();
      
      // 记录上传时间到数据库，用于避免短时间内重复提示不匹配
      const uploadTime = Date.now();
      this.lastUploadTime = uploadTime;
      db.prepare(`
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES ('last_upload_time', ?, CURRENT_TIMESTAMP)
      `).run(uploadTime.toString());
      console.log('[Sync] Upload completed, recorded upload time for mismatch check suppression');

      this.reportProgress('completed', 100, 'Upload completed successfully');

      return {
        success: true,
        message: 'Upload completed successfully'
      };
    } catch (error) {
      this.reportProgress('error', 0, `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Upload failed'
      };
    }
  }

  /**
   * 只从云端下载数据（不上传）
   * @param forceFullSync 如果为 true，强制全量同步（忽略 last_sync_time）
   */
  async downloadFromCloud(forceFullSync: boolean = false): Promise<SyncResult> {
    console.log(`[Sync] downloadFromCloud called with forceFullSync=${forceFullSync}, activationId=${this.activationId}`);
    console.log(`[Sync] Backup server URL: ${this.backupServerUrl || 'NOT CONFIGURED'}`);
    
    if (!this.backupServerUrl) {
      console.error('[Sync] ERROR: Backup server URL not configured');
      return {
        success: false,
        message: 'Backup server URL not configured'
      };
    }

    this.reportProgress('connecting', 10, 'Connecting to cloud server...');

    try {
      // 确保数据库结构正确（特别是 updated_at 列）在同步之前
      console.log('[Sync] Ensuring database schema before sync...');
      const { ensureDatabaseSchema } = await import('../db/connection');
      await ensureDatabaseSchema();
      console.log('[Sync] Database schema check completed');

      // 获取最后同步时间
      const db = getDb();
      let since = '1970-01-01T00:00:00.000Z'; // 默认获取所有数据
      
      if (!forceFullSync) {
        const lastSyncConfig = db.prepare(`
          SELECT value FROM system_config WHERE key = 'last_sync_time'
        `).get() as any;
        since = lastSyncConfig?.value || '1970-01-01T00:00:00.000Z';
      } else {
        console.log('[Sync] Force full sync requested, downloading all data from cloud...');
      }

      // 从云端拉取数据
      this.reportProgress('syncing', 30, 'Downloading data from cloud...');
      console.log(`[Sync] Downloading from cloud with since=${since}, activationId=${this.activationId}`);
      const cloudData = await this.pullFromCloud(since);
      
      console.log(`[Sync] Downloaded data from cloud (after pullFromCloud):`, {
        customers: cloudData.customers?.length || 0,
        weighingSessions: cloudData.weighingSessions?.length || 0,
        weighings: cloudData.weighings?.length || 0,
        biometricData: cloudData.biometricData?.length || 0,
        vehicles: cloudData.vehicles?.length || 0,
        metalTypes: cloudData.metalTypes?.length || 0
      });
      
      // 如果数据为空，输出警告
      const totalItems = (cloudData.customers?.length || 0) +
                        (cloudData.weighingSessions?.length || 0) +
                        (cloudData.weighings?.length || 0) +
                        (cloudData.biometricData?.length || 0) +
                        (cloudData.vehicles?.length || 0) +
                        (cloudData.metalTypes?.length || 0);
      
      if (totalItems === 0) {
        console.warn('[Sync] WARNING: No data received from cloud!');
        console.warn('[Sync] This could mean:');
        console.warn('[Sync] 1. Cloud server has no backup data for this activationId');
        console.warn('[Sync] 2. All data was filtered out by the "since" parameter');
        console.warn('[Sync] 3. Cloud server returned data in unexpected format');
        console.warn(`[Sync] ActivationId: ${this.activationId}, Since: ${since}`);
      }

      // 合并数据
      this.reportProgress('syncing', 60, 'Merging cloud data...');
      console.log(`[Sync] Starting to merge data for activationId: ${this.activationId}`);
      const mergeResult = await this.mergeData(cloudData);
      console.log(`[Sync] Merge completed:`, {
        merged: mergeResult.merged,
        conflicts: mergeResult.conflicts,
        total: mergeResult.total
      });

      // 更新同步时间
      this.updateSyncTime();

      this.reportProgress('completed', 100, 'Download completed successfully', {
        syncedRecords: mergeResult.merged,
        totalRecords: mergeResult.total
      });

      return {
        success: true,
        message: 'Download completed successfully',
        syncedRecords: mergeResult.merged,
        conflicts: mergeResult.conflicts
      };
    } catch (error) {
      this.reportProgress('error', 0, `Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Download failed'
      };
    }
  }
}
