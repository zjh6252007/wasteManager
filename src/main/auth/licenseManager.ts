import crypto from "crypto";
import { getDb } from "../db/connection";

export interface Activation {
  id: number;
  activation_code: string;
  company_name: string;
  contact_person?: string;
  contact_phone?: string;
  contact_email?: string;
  activated_at?: string;
  expires_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  activation_id: number;
  username: string;
  password_hash: string;
  role: string;
  is_active: boolean;
  last_login?: string;
  created_at: string;
}

export class ActivationManager {
  private getDb() {
    return getDb();
  }

  // 生成激活码
  generateActivationCode(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `GRC-${timestamp}-${random}`.toUpperCase();
  }

  // 创建新授权（你用来为客户开通）
  async createLicense(data: {
    companyName: string;
    contactPerson?: string;
    contactPhone?: string;
    contactEmail?: string;
    durationMonths: number;
    maxUsers?: number;
  }): Promise<string> {
    const licenseKey = this.generateLicenseKey();
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + data.durationMonths);

    const stmt = this.getDb().prepare(`
      INSERT INTO licenses (license_key, company_name, contact_person, contact_phone, contact_email, start_date, end_date, max_users)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      licenseKey,
      data.companyName,
      data.contactPerson,
      data.contactPhone,
      data.contactEmail,
      startDate.toISOString(),
      endDate.toISOString(),
      data.maxUsers || 3
    );

    // 创建默认管理员用户
    await this.createDefaultAdmin(licenseKey);

    // 创建默认垃圾类型
    await this.createDefaultWasteTypes(licenseKey);

    return licenseKey;
  }

  // 创建默认管理员用户
  private async createDefaultAdmin(licenseKey: string): Promise<void> {
    const license = await this.getLicenseByKey(licenseKey);
    if (!license) throw new Error('授权不存在');

    const defaultPassword = 'admin123'; // 默认密码，用户首次登录后应修改
    const passwordHash = this.hashPassword(defaultPassword);

    const stmt = this.getDb().prepare(`
      INSERT INTO users (license_id, username, password_hash, role)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(license.id, 'admin', passwordHash, 'admin');
  }

  // 创建默认垃圾类型
  private async createDefaultWasteTypes(licenseKey: string): Promise<void> {
    const license = await this.getLicenseByKey(licenseKey);
    if (!license) throw new Error('授权不存在');

    const defaultTypes = [
      { name: '废纸', unit_price: 1.50 },
      { name: '废塑料', unit_price: 2.00 },
      { name: '废金属', unit_price: 3.50 },
      { name: '废玻璃', unit_price: 0.80 },
      { name: '其他', unit_price: 1.00 }
    ];

    const stmt = this.getDb().prepare(`
      INSERT INTO waste_types (license_id, name, unit_price)
      VALUES (?, ?, ?)
    `);

    for (const type of defaultTypes) {
      stmt.run(license.id, type.name, type.unit_price);
    }
  }

  // 验证授权
  async validateLicense(licenseKey: string): Promise<{ valid: boolean; message: string; license?: License }> {
    const license = await this.getLicenseByKey(licenseKey);
    
    if (!license) {
      return { valid: false, message: '授权码不存在' };
    }
    
    if (!license.is_active) {
      return { valid: false, message: '授权已被禁用，请联系供应商' };
    }
    
    const now = new Date();
    const endDate = new Date(license.end_date);
    
    if (now > endDate) {
      return { valid: false, message: '授权已过期，请联系供应商续费' };
    }
    
    return { valid: true, message: '授权有效', license };
  }

  // 检查授权状态
  async checkLicenseStatus(licenseKey: string): Promise<{
    expired: boolean;
    daysLeft: number;
    isActive: boolean;
    message: string;
  }> {
    const license = await this.getLicenseByKey(licenseKey);
    
    if (!license) {
      return { expired: true, daysLeft: 0, isActive: false, message: '授权不存在' };
    }
    
    const now = new Date();
    const endDate = new Date(license.end_date);
    const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    return {
      expired: now > endDate,
      daysLeft: Math.max(0, daysLeft),
      isActive: license.is_active,
      message: license.is_active ? 
        (daysLeft > 0 ? `授权有效，剩余 ${daysLeft} 天` : '授权已过期') :
        '授权已被禁用'
    };
  }

  // 用户认证
  async authenticateUser(licenseKey: string, username: string, password: string): Promise<{
    success: boolean;
    message: string;
    user?: User;
  }> {
    // 先验证授权
    const licenseValidation = await this.validateLicense(licenseKey);
    if (!licenseValidation.valid) {
      return { success: false, message: licenseValidation.message };
    }

    const license = licenseValidation.license!;
    const user = await this.getUserByLicenseAndUsername(license.id, username);
    
    if (!user) {
      return { success: false, message: '用户名不存在' };
    }
    
    if (!user.is_active) {
      return { success: false, message: '用户已被禁用' };
    }
    
    if (!this.verifyPassword(password, user.password_hash)) {
      return { success: false, message: '密码错误' };
    }
    
    // 更新最后登录时间
    this.updateLastLogin(user.id);
    
    return { success: true, message: '登录成功', user };
  }

  // 创建用户
  async createUser(licenseKey: string, username: string, password: string, role: string = 'operator'): Promise<{
    success: boolean;
    message: string;
  }> {
    const license = await this.getLicenseByKey(licenseKey);
    if (!license) {
      return { success: false, message: '授权不存在' };
    }

    // 检查用户数量限制
    const userCount = await this.getUserCount(license.id);
    if (userCount >= license.max_users) {
      return { success: false, message: `用户数量已达上限 (${license.max_users})` };
    }

    // 检查用户名是否已存在
    const existingUser = await this.getUserByLicenseAndUsername(license.id, username);
    if (existingUser) {
      return { success: false, message: '用户名已存在' };
    }

    const passwordHash = this.hashPassword(password);
    const stmt = this.getDb().prepare(`
      INSERT INTO users (license_id, username, password_hash, role)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(license.id, username, passwordHash, role);
    
    return { success: true, message: '用户创建成功' };
  }

  // 获取授权信息
  async getLicenseByKey(licenseKey: string): Promise<License | null> {
    const stmt = this.getDb().prepare("SELECT * FROM licenses WHERE license_key = ?");
    return stmt.get(licenseKey) as License | null;
  }

  // 获取用户信息
  async getUserByLicenseAndUsername(licenseId: number, username: string): Promise<User | null> {
    const stmt = this.getDb().prepare("SELECT * FROM users WHERE license_id = ? AND username = ?");
    return stmt.get(licenseId, username) as User | null;
  }

  // 获取用户数量
  async getUserCount(licenseId: number): Promise<number> {
    const stmt = this.getDb().prepare("SELECT COUNT(*) as count FROM users WHERE license_id = ?");
    const result = stmt.get(licenseId) as { count: number };
    return result.count;
  }

  // 更新最后登录时间
  private updateLastLogin(userId: number): void {
    const stmt = this.getDb().prepare("UPDATE users SET last_login = ? WHERE id = ?");
    stmt.run(new Date().toISOString(), userId);
  }

  // 密码加密
  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  // 验证密码
  private verifyPassword(password: string, hash: string): boolean {
    const [salt, hashPart] = hash.split(':');
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return hashPart === verifyHash;
  }

  // 续费授权
  async renewLicense(licenseKey: string, months: number): Promise<{ success: boolean; message: string }> {
    const license = await this.getLicenseByKey(licenseKey);
    if (!license) {
      return { success: false, message: '授权不存在' };
    }

    const currentEndDate = new Date(license.end_date);
    const newEndDate = new Date(currentEndDate);
    newEndDate.setMonth(newEndDate.getMonth() + months);

    const stmt = this.getDb().prepare("UPDATE licenses SET end_date = ?, updated_at = ? WHERE license_key = ?");
    stmt.run(newEndDate.toISOString(), new Date().toISOString(), licenseKey);

    return { success: true, message: `授权已续费 ${months} 个月，新的到期时间：${newEndDate.toLocaleDateString()}` };
  }

  // 禁用授权
  async disableLicense(licenseKey: string): Promise<{ success: boolean; message: string }> {
    const stmt = this.getDb().prepare("UPDATE licenses SET is_active = 0, updated_at = ? WHERE license_key = ?");
    stmt.run(new Date().toISOString(), licenseKey);

    return { success: true, message: '授权已禁用' };
  }
}

export const licenseManager = new LicenseManager();
