import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

// 动态加载 better-sqlite3，避免在构建时被打包
let Database: any;
function getDatabase() {
  if (!Database) {
    Database = require('better-sqlite3');
  }
  return Database;
}

let db: any = null;

export async function createDb() {
  if (db) return db;

  const userDataPath = app.getPath("userData");
  const dbDir = path.join(userDataPath, "database");
  
  // Ensure database directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, "garbage_recycle.db");
  const DatabaseClass = getDatabase();
  db = new DatabaseClass(dbPath);

  // Execute SQL statements directly
  const schema = `
    -- Activation code table
    CREATE TABLE IF NOT EXISTS activations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_code TEXT UNIQUE NOT NULL,
        company_name TEXT NOT NULL,
        contact_person TEXT,
        contact_phone TEXT,
        contact_email TEXT,
        activated_at DATETIME,
        expires_at DATETIME,
        is_active BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User table
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'operator',
        is_active BOOLEAN DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        UNIQUE(activation_id, username)
    );

    -- Customer table
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        license_number TEXT,
        license_photo_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activation_id) REFERENCES activations(id)
    );

    -- Waste type table
    CREATE TABLE IF NOT EXISTS waste_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activation_id) REFERENCES activations(id)
    );

    -- Metal type table
    CREATE TABLE IF NOT EXISTS metal_types (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        price_per_unit REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT 'lb',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_synced BOOLEAN DEFAULT 0,
        cloud_id INTEGER,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        UNIQUE(activation_id, symbol)
    );

    -- Metal price history table
    CREATE TABLE IF NOT EXISTS metal_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        metal_type_id INTEGER NOT NULL,
        old_price REAL NOT NULL,
        new_price REAL NOT NULL,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        FOREIGN KEY (metal_type_id) REFERENCES metal_types(id)
    );

    -- Vehicle information table
    CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        customer_id INTEGER,
        license_plate TEXT NOT NULL,
        year INTEGER,
        color TEXT,
        make TEXT,
        model TEXT,
        original_ref_no TEXT, -- RefNo from original system
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_synced BOOLEAN DEFAULT 0,
        cloud_id INTEGER,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- Biometric data table
    CREATE TABLE IF NOT EXISTS biometric_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        customer_id INTEGER,
        face_image_path TEXT, -- Face photo path
        fingerprint_template BLOB, -- Fingerprint template data
        fingerprint_image_path TEXT, -- Fingerprint image path
        signature_image_path TEXT, -- Signature image path
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_synced BOOLEAN DEFAULT 0,
        cloud_id INTEGER,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- Weighing session table
    CREATE TABLE IF NOT EXISTS weighing_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        customer_id INTEGER,
        session_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        total_amount DECIMAL(10,2) DEFAULT 0,
        is_synced BOOLEAN DEFAULT 0,
        cloud_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    -- Weighing record table
    CREATE TABLE IF NOT EXISTS weighings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        session_id INTEGER NOT NULL,
        waste_type_id INTEGER,
        weight DECIMAL(10,3) NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        weighing_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_synced BOOLEAN DEFAULT 0,
        cloud_id INTEGER,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        FOREIGN KEY (session_id) REFERENCES weighing_sessions(id),
        FOREIGN KEY (waste_type_id) REFERENCES metal_types(id)
    );

    -- System configuration table
    CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User settings table
    CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activation_id INTEGER NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activation_id) REFERENCES activations(id),
        UNIQUE(activation_id, setting_key)
    );

    -- 插入默认垃圾类型（需要先有授权）
    -- 这个会在创建授权后执行
  `;
  
  // 分割SQL语句并执行
  const statements = schema.split(";").filter(stmt => stmt.trim());
  for (const statement of statements) {
    if (statement.trim()) {
      db.exec(statement);
    }
  }

  // 数据库迁移：添加缺失的列
  const migrationSQL = [
    "ALTER TABLE customers ADD COLUMN license_number TEXT",
    "ALTER TABLE customers ADD COLUMN license_photo_path TEXT",
    "ALTER TABLE customers ADD COLUMN id_expiration TEXT",
    "ALTER TABLE customers ADD COLUMN height TEXT",
    "ALTER TABLE customers ADD COLUMN weight TEXT",
    "ALTER TABLE customers ADD COLUMN hair_color TEXT",
    "ALTER TABLE customers ADD COLUMN customer_number TEXT",
    "ALTER TABLE customers ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE customers ADD COLUMN is_synced BOOLEAN DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN cloud_id INTEGER",
    "ALTER TABLE weighings ADD COLUMN session_id INTEGER",
    "ALTER TABLE weighings ADD COLUMN product_photo_path TEXT",
    "ALTER TABLE weighings ADD COLUMN is_synced BOOLEAN DEFAULT 0",
    "ALTER TABLE weighings ADD COLUMN cloud_id INTEGER",
    "ALTER TABLE biometric_data ADD COLUMN signature_image_path TEXT",
    "ALTER TABLE biometric_data ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE biometric_data ADD COLUMN is_synced BOOLEAN DEFAULT 0",
    "ALTER TABLE biometric_data ADD COLUMN cloud_id INTEGER",
    "ALTER TABLE vehicles ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE vehicles ADD COLUMN is_synced BOOLEAN DEFAULT 0",
    "ALTER TABLE vehicles ADD COLUMN cloud_id INTEGER",
    "ALTER TABLE metal_types ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE metal_types ADD COLUMN is_synced BOOLEAN DEFAULT 0",
    "ALTER TABLE metal_types ADD COLUMN cloud_id INTEGER",
    "ALTER TABLE weighing_sessions ADD COLUMN status TEXT DEFAULT 'completed'",
    "ALTER TABLE weighing_sessions ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
    "ALTER TABLE users ADD COLUMN cloud_verified BOOLEAN DEFAULT 0"
  ];
  
  for (const sql of migrationSQL) {
    try {
      db.exec(sql);
      // 只在开发模式下输出迁移日志
      if (process.env.NODE_ENV === 'development') {
        console.log(`Migration executed: ${sql}`);
      }
    } catch (error: any) {
      // 如果列已存在，静默忽略（不输出日志）
      const errorMsg = error?.message || '';
      if (errorMsg.includes('duplicate column') || 
          errorMsg.includes('already exists') ||
          errorMsg.includes('duplicate column name')) {
        // 列已存在是正常情况，不需要输出日志
      } else {
        // 对于其他错误，只在开发模式下记录
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Migration warning: ${sql} - ${errorMsg}`);
        }
      }
    }
  }
  
  // 确保所有需要的表都有 updated_at 列（如果迁移失败，这里会再次尝试）
  const tablesNeedingUpdatedAt = ['customers', 'weighing_sessions', 'biometric_data', 'vehicles', 'metal_types'];
  
  for (const tableName of tablesNeedingUpdatedAt) {
    try {
      // 检查列是否存在
      const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
      const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
      
      if (!hasUpdatedAt) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`Adding updated_at column to ${tableName} table...`);
        }
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
        if (process.env.NODE_ENV === 'development') {
          console.log(`Successfully added updated_at column to ${tableName}`);
        }
      }
    } catch (error: any) {
      const errorMsg = error?.message || '';
      if (!errorMsg.includes('duplicate column') && !errorMsg.includes('already exists')) {
        // 只在开发模式下输出警告
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Failed to ensure updated_at column exists in ${tableName}:`, errorMsg);
        }
      }
    }
  }

  console.log("Database initialization completed:", dbPath);
  return db;
}

/**
 * 确保数据库结构正确（特别是 updated_at 列）
 * 在同步数据之前调用此函数可以避免列缺失错误
 */
export async function ensureDatabaseSchema(): Promise<void> {
  console.log('[Schema] Starting database schema check...');
  if (!db) {
    console.log('[Schema] Database not initialized, creating...');
    await createDb();
    return;
  }

  // 确保所有需要的表都有 updated_at 列
  const tablesNeedingUpdatedAt = ['customers', 'weighing_sessions', 'biometric_data', 'vehicles', 'metal_types'];
  
  for (const tableName of tablesNeedingUpdatedAt) {
    try {
      // 检查列是否存在
      const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
      const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
      
      console.log(`[Schema] Table ${tableName}: updated_at column ${hasUpdatedAt ? 'EXISTS' : 'MISSING'}`);
      
      if (!hasUpdatedAt) {
        console.log(`[Schema] Adding updated_at column to ${tableName} table...`);
        try {
          // SQLite 不支持在 ALTER TABLE 时使用 CURRENT_TIMESTAMP 作为默认值
          // 对于 weighing_sessions 表，需要特殊处理
          if (tableName === 'weighing_sessions') {
            // 先添加列，不设置默认值
            db.exec(`ALTER TABLE ${tableName} ADD COLUMN updated_at DATETIME`);
            // 然后更新现有记录，使用 created_at 的值
            db.exec(`UPDATE ${tableName} SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`);
          } else {
            // 其他表可以正常添加
            db.exec(`ALTER TABLE ${tableName} ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
          }
          console.log(`[Schema] Successfully added updated_at column to ${tableName}`);
        } catch (addError: any) {
          // 如果添加失败，尝试不使用默认值的方式
          if (addError.message?.includes('non-constant default')) {
            console.log(`[Schema] Retrying without default value for ${tableName}...`);
            db.exec(`ALTER TABLE ${tableName} ADD COLUMN updated_at DATETIME`);
            // 更新现有记录
            db.exec(`UPDATE ${tableName} SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL`);
            console.log(`[Schema] Successfully added updated_at column to ${tableName} (without default)`);
          } else {
            throw addError;
          }
        }
      }
    } catch (error: any) {
      const errorMsg = error?.message || '';
      if (!errorMsg.includes('duplicate column') && !errorMsg.includes('already exists')) {
        console.warn(`[Schema] Failed to ensure updated_at column exists in ${tableName}:`, errorMsg);
      }
    }
  }
  console.log('[Schema] Database schema check completed');
}

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

// 基础数据操作类
export class DataRepository {
  private db: any = null;

  constructor() {
    // 延迟初始化，在第一次使用时才获取数据库连接
  }

  private ensureDb() {
    if (!this.db) {
      this.db = getDb();
    }
    return this.db;
  }

  // 客户相关操作
  customers = {
    // 生成唯一的4位客户编号
    generateCustomerNumber: (activationId: number): string => {
      const db = this.ensureDb();
      let attempts = 0;
      const maxAttempts = 100;
      
      while (attempts < maxAttempts) {
        // 生成4位随机数字（1000-9999）
        const number = Math.floor(1000 + Math.random() * 9000).toString();
        
        // 检查是否已存在
        const stmt = db.prepare(`
          SELECT COUNT(*) as count 
          FROM customers 
          WHERE activation_id = ? AND customer_number = ?
        `);
        const result = stmt.get(activationId, number) as { count: number };
        
        if (result.count === 0) {
          return number;
        }
        
        attempts++;
      }
      
      // 如果100次尝试都失败，使用时间戳的后4位
      return Date.now().toString().slice(-4);
    },

    create: (activationId: number, data: { 
      name: string; 
      phone?: string; 
      address?: string;
      license_number?: string;
      license_photo_path?: string;
      id_expiration?: string;
      height?: string;
      weight?: string;
      hair_color?: string;
      customer_number?: string;
    }) => {
      // 如果没有提供编号，自动生成
      const customerNumber = data.customer_number || this.customers.generateCustomerNumber(activationId);
      
      const stmt = this.ensureDb().prepare(`
        INSERT INTO customers (activation_id, name, phone, address, license_number, license_photo_path, id_expiration, height, weight, hair_color, customer_number) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        activationId, 
        data.name, 
        data.phone || null, 
        data.address || null, 
        data.license_number || null, 
        data.license_photo_path || null,
        data.id_expiration || null,
        data.height || null,
        data.weight || null,
        data.hair_color || null,
        customerNumber
      );
    },

    getAll: (activationId: number) => {
      // 优先显示最近有成交记录的客户，然后显示最新添加的客户
      // 使用 session_time 而不是 updated_at，因为 session_time 在所有数据库中都存在
      const stmt = this.ensureDb().prepare(`
        SELECT 
          c.*,
          (SELECT MAX(ws.session_time)
           FROM weighing_sessions ws
           WHERE ws.customer_id = c.id AND ws.activation_id = ?
          ) as last_transaction_time
        FROM customers c
        WHERE c.activation_id = ?
        ORDER BY 
          CASE WHEN last_transaction_time IS NOT NULL THEN 0 ELSE 1 END,
          last_transaction_time DESC,
          c.created_at DESC
      `);
      return stmt.all(activationId, activationId);
    },

    getById: (activationId: number, id: number) => {
      const stmt = this.ensureDb().prepare("SELECT * FROM customers WHERE activation_id = ? AND id = ?");
      return stmt.get(activationId, id);
    },

    findByNameAndAddress: (activationId: number, name: string, address: string) => {
      const stmt = this.ensureDb().prepare(`
        SELECT * FROM customers 
        WHERE activation_id = ? 
        AND LOWER(name) = LOWER(?) 
        AND LOWER(address) = LOWER(?)
      `);
      return stmt.get(activationId, name, address);
    },

    findByName: (activationId: number, name: string) => {
      const stmt = this.ensureDb().prepare(`
        SELECT * FROM customers 
        WHERE activation_id = ? 
        AND LOWER(name) = LOWER(?)
      `);
      return stmt.all(activationId, name);
    },

    // 搜索客户（支持编号、姓名和地址）
    search: (activationId: number, query: string) => {
      const searchTerm = `%${query}%`;
      const stmt = this.ensureDb().prepare(`
        SELECT * FROM customers 
        WHERE activation_id = ? 
        AND (
          customer_number LIKE ? 
          OR LOWER(name) LIKE LOWER(?)
          OR LOWER(address) LIKE LOWER(?)
        )
        ORDER BY customer_number ASC
        LIMIT 50
      `);
      return stmt.all(activationId, searchTerm, searchTerm, searchTerm);
    },

    // 分页获取客户列表（支持搜索）
    getPaginated: (activationId: number, options: {
      page: number;
      pageSize: number;
      searchQuery?: string;
    }) => {
      const { page, pageSize, searchQuery } = options;
      const offset = (page - 1) * pageSize;
      
      let whereClause = 'WHERE activation_id = ?';
      const params: any[] = [activationId];
      
      if (searchQuery && searchQuery.trim()) {
        const searchTerm = `%${searchQuery.trim()}%`;
        whereClause += ` AND (
          customer_number LIKE ? 
          OR LOWER(name) LIKE LOWER(?)
          OR LOWER(address) LIKE LOWER(?)
        )`;
        params.push(searchTerm, searchTerm, searchTerm);
      }
      
      // 获取总数
      const countStmt = this.ensureDb().prepare(`
        SELECT COUNT(*) as total FROM customers ${whereClause}
      `);
      const totalResult = countStmt.get(...params) as { total: number };
      const total = totalResult.total;
      
      // 获取分页数据
      // 优先显示最近有成交记录的客户，然后显示最新添加的客户
      let dataStmt;
      let dataParams;
      
      if (searchQuery && searchQuery.trim()) {
        // 有搜索条件时
        const searchTerm = `%${searchQuery.trim()}%`;
        dataStmt = this.ensureDb().prepare(`
          SELECT 
            c.*,
            (SELECT MAX(ws.session_time)
             FROM weighing_sessions ws
             WHERE ws.customer_id = c.id AND ws.activation_id = ?
            ) as last_transaction_time
          FROM customers c
          WHERE c.activation_id = ? AND (
            c.customer_number LIKE ? 
            OR LOWER(c.name) LIKE LOWER(?)
            OR LOWER(c.address) LIKE LOWER(?)
          )
          ORDER BY 
            CASE WHEN last_transaction_time IS NOT NULL THEN 0 ELSE 1 END,
            last_transaction_time DESC,
            c.created_at DESC
          LIMIT ? OFFSET ?
        `);
        dataParams = [activationId, activationId, searchTerm, searchTerm, searchTerm, pageSize, offset];
      } else {
        // 无搜索条件时
        dataStmt = this.ensureDb().prepare(`
          SELECT 
            c.*,
            (SELECT MAX(ws.session_time)
             FROM weighing_sessions ws
             WHERE ws.customer_id = c.id AND ws.activation_id = ?
            ) as last_transaction_time
          FROM customers c
          WHERE c.activation_id = ?
          ORDER BY 
            CASE WHEN last_transaction_time IS NOT NULL THEN 0 ELSE 1 END,
            last_transaction_time DESC,
            c.created_at DESC
          LIMIT ? OFFSET ?
        `);
        dataParams = [activationId, activationId, pageSize, offset];
      }
      
      const data = dataStmt.all(...dataParams);
      
      return {
        data,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      };
    },

    // 更新客户信息
    update: (activationId: number, customerId: number, data: {
      name?: string;
      phone?: string;
      address?: string;
      license_number?: string;
      license_photo_path?: string;
      id_expiration?: string;
      height?: string;
      weight?: string;
      hair_color?: string;
      customer_number?: string;
    }) => {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (data.name !== undefined) {
        updates.push('name = ?');
        values.push(data.name);
      }
      if (data.phone !== undefined) {
        updates.push('phone = ?');
        values.push(data.phone);
      }
      if (data.address !== undefined) {
        updates.push('address = ?');
        values.push(data.address);
      }
      if (data.license_number !== undefined) {
        updates.push('license_number = ?');
        values.push(data.license_number);
      }
      if (data.license_photo_path !== undefined) {
        updates.push('license_photo_path = ?');
        values.push(data.license_photo_path);
      }
      if (data.id_expiration !== undefined) {
        updates.push('id_expiration = ?');
        values.push(data.id_expiration);
      }
      if (data.height !== undefined) {
        updates.push('height = ?');
        values.push(data.height);
      }
      if (data.weight !== undefined) {
        updates.push('weight = ?');
        values.push(data.weight);
      }
      if (data.hair_color !== undefined) {
        updates.push('hair_color = ?');
        values.push(data.hair_color);
      }
      if (data.customer_number !== undefined) {
        updates.push('customer_number = ?');
        values.push(data.customer_number);
      }
      
      if (updates.length === 0) {
        return { changes: 0 };
      }
      
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(activationId, customerId);
      
      const stmt = this.ensureDb().prepare(`
        UPDATE customers 
        SET ${updates.join(', ')}
        WHERE activation_id = ? AND id = ?
      `);
      return stmt.run(...values);
    }
  };

  // 垃圾类型相关操作
  wasteTypes = {
    getAll: (activationId: number) => {
      const stmt = this.ensureDb().prepare("SELECT * FROM waste_types WHERE activation_id = ? ORDER BY name");
      return stmt.all(activationId);
    },

    getById: (activationId: number, id: number) => {
      const stmt = this.ensureDb().prepare("SELECT * FROM waste_types WHERE activation_id = ? AND id = ?");
      return stmt.get(activationId, id);
    }
  };

  // 车辆相关操作
  vehicles = {
    create: (activationId: number, data: {
      customer_id?: number;
      license_plate: string;
      year?: number;
      color?: string;
      make?: string;
      model?: string;
      original_ref_no?: string;
    }) => {
      const stmt = this.ensureDb().prepare(`
        INSERT INTO vehicles (activation_id, customer_id, license_plate, year, color, make, model, original_ref_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        activationId,
        data.customer_id,
        data.license_plate,
        data.year,
        data.color,
        data.make,
        data.model,
        data.original_ref_no
      );
    },

    getAll: (activationId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT v.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM vehicles v
        LEFT JOIN customers c ON v.customer_id = c.id AND c.activation_id = v.activation_id
        WHERE v.activation_id = ?
        ORDER BY v.created_at DESC
      `);
      return stmt.all(activationId);
    },

    getById: (activationId: number, id: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT v.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM vehicles v
        LEFT JOIN customers c ON v.customer_id = c.id AND c.activation_id = v.activation_id
        WHERE v.activation_id = ? AND v.id = ?
      `);
      return stmt.get(activationId, id);
    },

    findByLicensePlate: (activationId: number, licensePlate: string) => {
      const stmt = this.ensureDb().prepare("SELECT * FROM vehicles WHERE activation_id = ? AND license_plate = ?");
      return stmt.get(activationId, licensePlate);
    },

    getByCustomerId: (activationId: number, customerId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT v.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM vehicles v
        LEFT JOIN customers c ON v.customer_id = c.id AND c.activation_id = v.activation_id
        WHERE v.activation_id = ? AND v.customer_id = ?
        ORDER BY v.created_at DESC
      `);
      return stmt.all(activationId, customerId);
    }
  };

  // 生物识别数据相关操作
  biometricData = {
    create: (activationId: number, data: {
      customer_id?: number;
      face_image_path?: string;
      fingerprint_template?: Buffer;
      fingerprint_image_path?: string;
      signature_image_path?: string;
    }) => {
      const stmt = this.ensureDb().prepare(`
        INSERT INTO biometric_data (activation_id, customer_id, face_image_path, fingerprint_template, fingerprint_image_path, signature_image_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        activationId,
        data.customer_id,
        data.face_image_path,
        data.fingerprint_template,
        data.fingerprint_image_path,
        data.signature_image_path
      );
    },

    getByCustomerId: (activationId: number, customerId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT * FROM biometric_data 
        WHERE activation_id = ? AND customer_id = ?
      `);
      return stmt.get(activationId, customerId);
    },

    getAll: (activationId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT bd.*, c.name as customer_name, c.phone as customer_phone
        FROM biometric_data bd
        LEFT JOIN customers c ON bd.customer_id = c.id AND c.activation_id = bd.activation_id
        WHERE bd.activation_id = ?
        ORDER BY bd.created_at DESC
      `);
      return stmt.all(activationId);
    },

    update: (activationId: number, customerId: number, data: {
      face_image_path?: string;
      fingerprint_template?: Buffer;
      fingerprint_image_path?: string;
      signature_image_path?: string;
    }) => {
      const stmt = this.ensureDb().prepare(`
        UPDATE biometric_data 
        SET face_image_path = COALESCE(?, face_image_path),
            fingerprint_template = COALESCE(?, fingerprint_template),
            fingerprint_image_path = COALESCE(?, fingerprint_image_path),
            signature_image_path = COALESCE(?, signature_image_path),
            updated_at = CURRENT_TIMESTAMP
        WHERE activation_id = ? AND customer_id = ?
      `);
      return stmt.run(
        data.face_image_path,
        data.fingerprint_template,
        data.fingerprint_image_path,
        data.signature_image_path,
        activationId,
        customerId
      );
    }
  };

  // 用户设置相关操作
  userSettings = {
    get: (activationId: number, key: string) => {
      const stmt = this.ensureDb().prepare(`
        SELECT setting_value FROM user_settings 
        WHERE activation_id = ? AND setting_key = ?
      `);
      const result = stmt.get(activationId, key) as any;
      return result ? result.setting_value : null;
    },

    set: (activationId: number, key: string, value: string) => {
      const stmt = this.ensureDb().prepare(`
        INSERT OR REPLACE INTO user_settings (activation_id, setting_key, setting_value, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);
      return stmt.run(activationId, key, value);
    },

    getAll: (activationId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT setting_key, setting_value FROM user_settings 
        WHERE activation_id = ?
      `);
      const results = stmt.all(activationId);
      const settings: { [key: string]: string } = {};
      results.forEach((row: any) => {
        settings[row.setting_key] = row.setting_value;
      });
      return settings;
    },

    delete: (activationId: number, key: string) => {
      const stmt = this.ensureDb().prepare(`
        DELETE FROM user_settings 
        WHERE activation_id = ? AND setting_key = ?
      `);
      return stmt.run(activationId, key);
    }
  };

  // 称重会话相关操作
  weighingSessions = {
    create: (activationId: number, data: {
      customer_id?: number;
      notes?: string;
      status?: string;
    }) => {
      // 使用本地时间而不是 UTC 时间
      // 格式化为 'YYYY-MM-DD HH:MM:SS' 格式
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const localTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      
      const stmt = this.ensureDb().prepare(`
        INSERT INTO weighing_sessions (activation_id, customer_id, session_time, notes, status)
        VALUES (?, ?, ?, ?, ?)
      `);
      return stmt.run(activationId, data.customer_id, localTime, data.notes, data.status || 'completed');
    },

    updateTotal: (activationId: number, sessionId: number, totalAmount: number) => {
      const stmt = this.ensureDb().prepare(`
        UPDATE weighing_sessions 
        SET total_amount = ?
        WHERE activation_id = ? AND id = ?
      `);
      return stmt.run(totalAmount, activationId, sessionId);
    },

    update: (activationId: number, sessionId: number, data: {
      notes?: string;
      status?: string;
    }) => {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (data.notes !== undefined) {
        updates.push('notes = ?');
        values.push(data.notes);
      }
      if (data.status !== undefined) {
        updates.push('status = ?');
        values.push(data.status);
      }
      
      if (updates.length === 0) {
        return { changes: 0 };
      }
      
      // 尝试包含 updated_at，如果列不存在会失败，则重试不包含它
      const updatesWithTimestamp = [...updates, 'updated_at = CURRENT_TIMESTAMP'];
      const whereValues = [activationId, sessionId];
      
      try {
        const stmt = this.ensureDb().prepare(`
          UPDATE weighing_sessions 
          SET ${updatesWithTimestamp.join(', ')}
          WHERE activation_id = ? AND id = ?
        `);
        return stmt.run(...values, ...whereValues);
      } catch (error: any) {
        // 如果 updated_at 列不存在，重试不包含它的更新
        if (error?.message?.includes('no such column: updated_at')) {
          console.log('updated_at column not found, updating without it');
          const stmt = this.ensureDb().prepare(`
            UPDATE weighing_sessions 
            SET ${updates.join(', ')}
            WHERE activation_id = ? AND id = ?
          `);
          return stmt.run(...values, ...whereValues);
        }
        // 其他错误直接抛出
        throw error;
      }
    },

    getById: (activationId: number, id: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT ws.*, c.name as customer_name
        FROM weighing_sessions ws
        LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = ws.activation_id
        WHERE ws.activation_id = ? AND ws.id = ?
      `);
      return stmt.get(activationId, id);
    },

    getUnfinishedCount: (activationId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT COUNT(*) as count
        FROM weighing_sessions
        WHERE activation_id = ? AND status = 'unfinished'
      `);
      const result = stmt.get(activationId) as { count: number };
      return result.count;
    },

    delete: (activationId: number, sessionId: number) => {
      // 先删除该session的所有weighings（因为有外键约束）
      const deleteWeighingsStmt = this.ensureDb().prepare(`
        DELETE FROM weighings
        WHERE activation_id = ? AND session_id = ?
      `);
      deleteWeighingsStmt.run(activationId, sessionId);
      
      // 然后删除session
      const deleteSessionStmt = this.ensureDb().prepare(`
        DELETE FROM weighing_sessions
        WHERE activation_id = ? AND id = ?
      `);
      return deleteSessionStmt.run(activationId, sessionId);
    },

    deleteAll: (activationId: number) => {
      // 先删除所有weighings（因为有外键约束）
      const deleteWeighingsStmt = this.ensureDb().prepare(`
        DELETE FROM weighings
        WHERE activation_id = ?
      `);
      deleteWeighingsStmt.run(activationId);
      
      // 然后删除所有weighing_sessions
      const deleteSessionsStmt = this.ensureDb().prepare(`
        DELETE FROM weighing_sessions
        WHERE activation_id = ?
      `);
      return deleteSessionsStmt.run(activationId);
    }
  };

  // 称重记录相关操作
  weighings = {
    create: (activationId: number, data: {
      session_id: number;
      waste_type_id: number;
      weight: number;
      unit_price: number;
      total_amount: number;
      product_photo_path?: string;
    }) => {
      const stmt = this.ensureDb().prepare(`
        INSERT INTO weighings (activation_id, session_id, waste_type_id, weight, unit_price, total_amount, product_photo_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        activationId,
        data.session_id,
        data.waste_type_id,
        data.weight,
        data.unit_price,
        data.total_amount,
        data.product_photo_path || null
      );
    },

    getBySession: (activationId: number, sessionId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT w.*, mt.name as waste_type_name, mt.symbol as metal_symbol
        FROM weighings w
        LEFT JOIN metal_types mt ON w.waste_type_id = mt.id AND mt.activation_id = w.activation_id
        WHERE w.activation_id = ? AND w.session_id = ?
        ORDER BY w.created_at ASC
      `);
      return stmt.all(activationId, sessionId);
    },

    deleteBySession: (activationId: number, sessionId: number) => {
      const stmt = this.ensureDb().prepare(`
        DELETE FROM weighings
        WHERE activation_id = ? AND session_id = ?
      `);
      return stmt.run(activationId, sessionId);
    },

    getAll: (activationId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT ws.*, c.name as customer_name
        FROM weighing_sessions ws
        LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = ws.activation_id
        WHERE ws.activation_id = ?
        ORDER BY ws.session_time DESC
      `);
      return stmt.all(activationId);
    },

    getById: (activationId: number, id: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT ws.*, c.name as customer_name
        FROM weighing_sessions ws
        LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = ws.activation_id
        WHERE ws.activation_id = ? AND ws.id = ?
      `);
      return stmt.get(activationId, id);
    },

    // 分页查询称重会话
    getPaginated: (activationId: number, options: {
      page?: number;
      limit?: number;
      startDate?: string;
      endDate?: string;
      customerName?: string;
    }) => {
      const page = options.page || 1;
      const limit = options.limit || 10;
      const offset = (page - 1) * limit;

      let whereConditions = ['ws.activation_id = ?'];
      let params: any[] = [activationId];

      if (options.startDate) {
        whereConditions.push('DATE(ws.session_time) >= ?');
        params.push(options.startDate);
      }

      if (options.endDate) {
        whereConditions.push('DATE(ws.session_time) <= ?');
        params.push(options.endDate);
      }

      if (options.customerName) {
        whereConditions.push('c.name LIKE ?');
        params.push(`%${options.customerName}%`);
      }

      const whereClause = whereConditions.join(' AND ');

      // 获取总数
      const countStmt = this.ensureDb().prepare(`
        SELECT COUNT(*) as total
        FROM weighing_sessions ws
        LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = ws.activation_id
        WHERE ${whereClause}
      `);
      const totalResult = countStmt.get(...params) as { total: number };
      const total = totalResult.total;

      // 获取分页数据（使用 ws.* 获取所有列，避免列不存在的问题）
      const dataStmt = this.ensureDb().prepare(`
        SELECT ws.*, c.name as customer_name
        FROM weighing_sessions ws
        LEFT JOIN customers c ON ws.customer_id = c.id AND c.activation_id = ws.activation_id
        WHERE ${whereClause}
        ORDER BY ws.session_time DESC
        LIMIT ? OFFSET ?
      `);
      const data = dataStmt.all(...params, limit, offset);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      };
    }
  };

  // 金属种类相关操作
  metalTypes = {
    create: (activationId: number, data: {
      symbol: string;
      name: string;
      price_per_unit: number;
      unit: string;
    }) => {
      const stmt = this.ensureDb().prepare(`
        INSERT INTO metal_types (activation_id, symbol, name, price_per_unit, unit)
        VALUES (?, ?, ?, ?, ?)
      `);
      return stmt.run(activationId, data.symbol, data.name, data.price_per_unit, data.unit);
    },

    getAll: (activationId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT * FROM metal_types 
        WHERE activation_id = ? AND is_active = 1
        ORDER BY symbol ASC
      `);
      return stmt.all(activationId);
    },

    getById: (activationId: number, id: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT * FROM metal_types 
        WHERE activation_id = ? AND id = ?
      `);
      return stmt.get(activationId, id);
    },

    update: (activationId: number, id: number, data: {
      name?: string;
      price_per_unit?: number;
      unit?: string;
    }) => {
      const fields: string[] = [];
      const values: any[] = [];
      
      if (data.name !== undefined) {
        fields.push('name = ?');
        values.push(data.name);
      }
      if (data.price_per_unit !== undefined) {
        fields.push('price_per_unit = ?');
        values.push(data.price_per_unit);
      }
      if (data.unit !== undefined) {
        fields.push('unit = ?');
        values.push(data.unit);
      }
      
      if (fields.length === 0) return { changes: 0 };
      
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(activationId, id);
      
      const stmt = this.ensureDb().prepare(`
        UPDATE metal_types 
        SET ${fields.join(', ')}
        WHERE activation_id = ? AND id = ?
      `);
      return stmt.run(...values);
    },

    delete: (activationId: number, id: number) => {
      const stmt = this.ensureDb().prepare(`
        UPDATE metal_types 
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE activation_id = ? AND id = ?
      `);
      return stmt.run(activationId, id);
    },

    findBySymbol: (activationId: number, symbol: string) => {
      const stmt = this.ensureDb().prepare(`
        SELECT * FROM metal_types 
        WHERE activation_id = ? AND symbol = ? AND is_active = 1
      `);
      return stmt.get(activationId, symbol);
    }
  };

  // 金属价格历史相关操作
  metalPriceHistory = {
    create: (activationId: number, data: {
      metal_type_id: number;
      old_price: number;
      new_price: number;
    }) => {
      const stmt = this.ensureDb().prepare(`
        INSERT INTO metal_price_history (activation_id, metal_type_id, old_price, new_price)
        VALUES (?, ?, ?, ?)
      `);
      return stmt.run(activationId, data.metal_type_id, data.old_price, data.new_price);
    },

    getByMetalType: (activationId: number, metalTypeId: number) => {
      const stmt = this.ensureDb().prepare(`
        SELECT mph.*, mt.symbol, mt.name
        FROM metal_price_history mph
        JOIN metal_types mt ON mph.metal_type_id = mt.id
        WHERE mph.activation_id = ? AND mph.metal_type_id = ?
        ORDER BY mph.changed_at DESC
      `);
      return stmt.all(activationId, metalTypeId);
    }
  };
}

export const repo = new DataRepository();

/**
 * 检查数据库是否为空（新电脑检测）
 * 如果没有任何业务数据（客户、称重会话等），则认为数据库为空
 */
export function isDatabaseEmpty(activationId: number): boolean {
  const db = getDb();
  
  // 检查是否有客户
  const customerCount = db.prepare(`
    SELECT COUNT(*) as count FROM customers WHERE activation_id = ?
  `).get(activationId) as { count: number };
  
  // 检查是否有称重会话
  const sessionCount = db.prepare(`
    SELECT COUNT(*) as count FROM weighing_sessions WHERE activation_id = ?
  `).get(activationId) as { count: number };
  
  // 检查其他数据
  const weighingCount = db.prepare(`
    SELECT COUNT(*) as count FROM weighings w
    JOIN weighing_sessions ws ON w.session_id = ws.id
    WHERE ws.activation_id = ?
  `).get(activationId) as { count: number };
  
  const metalTypeCount = db.prepare(`
    SELECT COUNT(*) as count FROM metal_types WHERE activation_id = ?
  `).get(activationId) as { count: number };
  
  console.log(`[Database Check] ActivationId ${activationId} data counts:`, {
    customers: customerCount.count,
    sessions: sessionCount.count,
    weighings: weighingCount.count,
    metalTypes: metalTypeCount.count
  });
  
  // 如果既没有客户也没有称重会话，认为是新电脑
  const isEmpty = customerCount.count === 0 && sessionCount.count === 0;
  console.log(`[Database Check] Database is ${isEmpty ? 'EMPTY' : 'NOT EMPTY'} for activationId ${activationId}`);
  
  return isEmpty;
}
