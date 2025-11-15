import { getDb, repo } from '../db/connection';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import dgram from 'dgram';
import { EventEmitter } from 'events';

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
 * 数据同步服务
 * 支持局域网同步和云端同步
 */
export class SyncService extends EventEmitter {
  private activationId: number;
  private backupServerUrl?: string;
  private syncPort: number = 8765; // 局域网同步端口
  private broadcastPort: number = 8766; // 广播端口
  private udpSocket?: dgram.Socket;
  private tcpServer?: http.Server;
  private isRunning: boolean = false;
  private discoveredDevices: Map<string, DeviceInfo> = new Map();
  private progressCallback?: (progress: SyncProgress) => void;

  constructor(activationId: number, backupServerUrl?: string) {
    super();
    this.activationId = activationId;
    this.backupServerUrl = backupServerUrl;
  }

  /**
   * 设置进度回调
   */
  setProgressCallback(callback: (progress: SyncProgress) => void) {
    this.progressCallback = callback;
  }

  /**
   * 报告进度
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
   * 启动局域网同步服务
   */
  async startLocalSync(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // 启动 UDP 广播服务（用于设备发现）
    this.startUdpBroadcast();

    // 启动 TCP 服务器（用于数据同步）
    this.startTcpServer();

    // 定期广播自己的存在
    this.startPeriodicBroadcast();

    console.log('Local sync service started');
  }

  /**
   * 停止局域网同步服务
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
   * 启动 UDP 广播服务
   */
  private startUdpBroadcast(): void {
    this.udpSocket = dgram.createSocket('udp4');

    this.udpSocket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        
        // 只处理相同 activation_id 的设备
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
   * 启动 TCP 服务器
   */
  private startTcpServer(): void {
    this.tcpServer = http.createServer(async (req, res) => {
      // 设置 CORS 头
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
        // 尝试使用备用端口
        const altPort = this.syncPort + 1;
        this.tcpServer?.close();
        this.tcpServer = http.createServer(async (req, res) => {
          // 设置 CORS 头
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
          // 如果备用端口也失败，就不启动TCP服务器，但继续运行其他功能
        });
      } else {
        console.error('TCP sync server error:', err);
      }
    });
  }

  /**
   * 处理推送数据
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
   * 处理拉取数据请求
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
   * 处理状态请求
   */
  private async handleStatus(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const db = getDb();
    const lastSync = db.prepare(`
      SELECT MAX(lastSync) as lastSync 
      FROM (
        SELECT updated_at as lastSync FROM customers WHERE activation_id = ?
        UNION ALL
        SELECT updated_at as lastSync FROM weighing_sessions WHERE activation_id = ?
        UNION ALL
        SELECT created_at as lastSync FROM weighings WHERE activation_id = ?
        UNION ALL
        SELECT updated_at as lastSync FROM biometric_data WHERE activation_id = ?
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
   * 定期广播自己的存在
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
   * 获取最后同步时间
   */
  private getLastSyncTime(): string {
    const db = getDb();
    const result = db.prepare(`
      SELECT MAX(lastSync) as lastSync 
      FROM (
        SELECT updated_at as lastSync FROM customers WHERE activation_id = ?
        UNION ALL
        SELECT updated_at as lastSync FROM weighing_sessions WHERE activation_id = ?
        UNION ALL
        SELECT created_at as lastSync FROM weighings WHERE activation_id = ?
        UNION ALL
        SELECT updated_at as lastSync FROM biometric_data WHERE activation_id = ?
      )
    `).get(this.activationId, this.activationId, this.activationId, this.activationId) as any;

    return result?.lastSync || new Date().toISOString();
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

    // 导出客户数据
    data.customers = db.prepare(`
      SELECT * FROM customers 
      WHERE activation_id = ? AND updated_at > ?
    `).all(this.activationId, since) as any[];

    // 导出称重会话
    data.weighingSessions = db.prepare(`
      SELECT * FROM weighing_sessions 
      WHERE activation_id = ? AND updated_at > ?
    `).all(this.activationId, since) as any[];

    // 导出称重记录
    data.weighings = db.prepare(`
      SELECT w.* FROM weighings w
      JOIN weighing_sessions ws ON w.session_id = ws.id
      WHERE ws.activation_id = ? AND w.created_at > ?
    `).all(this.activationId, since) as any[];

    // 导出生物识别数据
    data.biometricData = db.prepare(`
      SELECT * FROM biometric_data 
      WHERE activation_id = ? AND updated_at > ?
    `).all(this.activationId, since) as any[];

    // 导出车辆数据
    data.vehicles = db.prepare(`
      SELECT * FROM vehicles 
      WHERE activation_id = ? AND updated_at > ?
    `).all(this.activationId, since) as any[];

    // 导出金属类型
    data.metalTypes = db.prepare(`
      SELECT * FROM metal_types 
      WHERE activation_id = ? AND updated_at > ?
    `).all(this.activationId, since) as any[];

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

    // 合并客户数据
    if (remoteData.customers) {
      for (const customer of remoteData.customers) {
        try {
          // 检查是否已存在（通过 customer_number 或 id）
          const existing = db.prepare(`
            SELECT * FROM customers 
            WHERE activation_id = ? AND (id = ? OR customer_number = ?)
          `).get(this.activationId, customer.id, customer.customer_number) as any;

          if (existing) {
            // 冲突解决：使用更新的时间戳
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
            const remoteTime = new Date(customer.updated_at || customer.created_at).getTime();

            if (remoteTime > existingTime) {
              // 远程数据更新，使用远程数据
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
              merged++;
            } else {
              conflicts++;
            }
          } else {
            // 新记录，直接插入
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
            merged++;
          }
        } catch (error) {
          console.error('Error merging customer:', error);
          conflicts++;
        }
      }
    }

    // 合并称重会话
    if (remoteData.weighingSessions) {
      for (const session of remoteData.weighingSessions) {
        try {
          const existing = db.prepare(`
            SELECT * FROM weighing_sessions 
            WHERE activation_id = ? AND id = ?
          `).get(this.activationId, session.id) as any;

          if (existing) {
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
            const remoteTime = new Date(session.updated_at || session.created_at).getTime();

            if (remoteTime > existingTime) {
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
              merged++;
            } else {
              conflicts++;
            }
          } else {
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
            merged++;
          }
        } catch (error) {
          console.error('Error merging session:', error);
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
        } catch (error) {
          console.error('Error merging weighing:', error);
          conflicts++;
        }
      }
    }

    // 合并生物识别数据
    if (remoteData.biometricData) {
      for (const bio of remoteData.biometricData) {
        try {
          const existing = db.prepare(`
            SELECT * FROM biometric_data 
            WHERE activation_id = ? AND customer_id = ?
          `).get(this.activationId, bio.customer_id) as any;

          if (existing) {
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
            const remoteTime = new Date(bio.updated_at || bio.created_at).getTime();

            if (remoteTime > existingTime) {
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
              merged++;
            } else {
              conflicts++;
            }
          } else {
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
      for (const metal of remoteData.metalTypes) {
        try {
          const existing = db.prepare(`
            SELECT * FROM metal_types 
            WHERE activation_id = ? AND symbol = ?
          `).get(this.activationId, metal.symbol) as any;

          if (existing) {
            const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
            const remoteTime = new Date(metal.updated_at || metal.created_at).getTime();

            if (remoteTime > existingTime) {
              db.prepare(`
                UPDATE metal_types 
                SET name = ?, price_per_unit = ?, unit = ?, is_active = ?, updated_at = ?
                WHERE activation_id = ? AND symbol = ?
              `).run(
                metal.name,
                metal.price_per_unit,
                metal.unit,
                metal.is_active,
                metal.updated_at || new Date().toISOString(),
                this.activationId,
                metal.symbol
              );
              merged++;
            } else {
              conflicts++;
            }
          } else {
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
              metal.is_active,
              metal.created_at || new Date().toISOString(),
              metal.updated_at || new Date().toISOString()
            );
            merged++;
          }
        } catch (error) {
          console.error('Error merging metal type:', error);
          conflicts++;
        }
      }
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
      url.pathname = '/sync/pull';
      url.searchParams.set('activationId', this.activationId.toString());
      url.searchParams.set('since', since);

      const client = url.protocol === 'https:' ? https : http;
      
      client.get(url.toString(), (res) => {
        let data = '';
        res.on('data', chunk => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(new Error('Failed to parse cloud response'));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * 推送数据到云端
   */
  private async pushToCloud(data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.backupServerUrl!);
      url.pathname = '/sync/push';

      const postData = JSON.stringify({
        activationId: this.activationId,
        data: data
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
}
