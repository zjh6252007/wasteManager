import crypto from "crypto";
import bcrypt from "bcryptjs";
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

  // 创建新激活码（你用来为客户开通）
  async createActivationCode(data: {
    companyName: string;
    contactPerson?: string;
    contactPhone?: string;
    contactEmail?: string;
  }): Promise<{ success: boolean; activationCode?: string; message: string }> {
    try {
      const activationCode = this.generateActivationCode();

      const stmt = this.getDb().prepare(`
        INSERT INTO activations (activation_code, company_name, contact_person, contact_phone, contact_email)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        activationCode,
        data.companyName,
        data.contactPerson,
        data.contactPhone,
        data.contactEmail
      );

      return { success: true, activationCode, message: "Activation code created successfully" };
    } catch (error: any) {
      if (error.message.includes("UNIQUE constraint failed: activations.activation_code")) {
        return { success: false, message: "Activation code already exists, please try again" };
      }
      return { success: false, message: `Failed to create activation code: ${error.message}` };
    }
  }

  // 根据激活码获取激活信息
  async getActivationByCode(activationCode: string): Promise<Activation | undefined> {
    const stmt = this.getDb().prepare("SELECT * FROM activations WHERE activation_code = ?");
    return stmt.get(activationCode) as Activation | undefined;
  }

  // 激活账户
  async activateAccount(activationCode: string, username: string, password: string): Promise<{ success: boolean; message: string }> {
    try {
      const activation = await this.getActivationByCode(activationCode);
      if (!activation) {
        return { success: false, message: "Activation code does not exist" };
      }

      if (activation.is_active) {
        return { success: false, message: "This activation code has already been used" };
      }

      // 检查是否已过期（如果设置了过期时间）
      if (activation.expires_at) {
        const now = new Date();
        const expiresAt = new Date(activation.expires_at);
        if (now > expiresAt) {
          return { success: false, message: "Activation code has expired" };
        }
      }

      // 设置激活时间和过期时间（1年后）
      const activatedAt = new Date();
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      const updateStmt = this.getDb().prepare(`
        UPDATE activations 
        SET activated_at = ?, expires_at = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateStmt.run(activatedAt.toISOString(), expiresAt.toISOString(), activation.id);

      // 创建默认管理员用户
      const passwordHash = await bcrypt.hash(password, 10);
      const userStmt = this.getDb().prepare(`
        INSERT INTO users (activation_id, username, password_hash, role)
        VALUES (?, ?, ?, ?)
      `);
      userStmt.run(activation.id, username, passwordHash, 'admin');

      // 创建默认垃圾类型
      const defaultWasteTypes = [
        { name: '废纸', unit_price: 1.50 },
        { name: '废塑料', unit_price: 2.00 },
        { name: '废金属', unit_price: 3.50 },
        { name: '废玻璃', unit_price: 0.80 },
        { name: '其他', unit_price: 1.00 },
      ];
      const wasteTypeStmt = this.getDb().prepare(`
        INSERT INTO waste_types (activation_id, name, unit_price) VALUES (?, ?, ?)
      `);
      for (const type of defaultWasteTypes) {
        wasteTypeStmt.run(activation.id, type.name, type.unit_price);
      }

      return { success: true, message: "Account activated successfully! Valid for 1 year" };
    } catch (error: any) {
      if (error.message.includes("UNIQUE constraint failed: users.activation_id, users.username")) {
        return { success: false, message: "Username already exists under this activation code" };
      }
      return { success: false, message: `Activation failed: ${error.message}` };
    }
  }

  // 检查激活状态
  async checkActivationStatus(activationCode: string): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      const activation = await this.getActivationByCode(activationCode);
      if (!activation) {
        return { success: false, message: "Activation code does not exist" };
      }

      if (!activation.is_active) {
        return { success: false, message: "Account not activated" };
      }

      const now = new Date();
      const expiresAt = new Date(activation.expires_at!);
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (now > expiresAt) {
        return { success: false, message: "Account expired, reactivation required" };
      }

      return {
        success: true,
        message: "Account valid",
        data: {
          company_name: activation.company_name,
          activated_at: activation.activated_at,
          expires_at: activation.expires_at,
          daysLeft: Math.max(0, daysLeft)
        }
      };
    } catch (error: any) {
      return { success: false, message: `Failed to check activation status: ${error.message}` };
    }
  }

  // 用户登录
  async authenticateUser(activationCode: string, username: string, password: string): Promise<{ success: boolean; message: string; user?: User }> {
    try {
      const activation = await this.getActivationByCode(activationCode);
      if (!activation) {
        return { success: false, message: "Activation code does not exist" };
      }

      // Check activation status
      const statusCheck = await this.checkActivationStatus(activationCode);
      if (!statusCheck.success) {
        return { success: false, message: statusCheck.message };
      }

      const stmt = this.getDb().prepare("SELECT * FROM users WHERE activation_id = ? AND username = ?");
      const user = stmt.get(activation.id, username) as User | undefined;

      if (!user) {
        return { success: false, message: "Invalid username or password" };
      }

      if (!user.is_active) {
        return { success: false, message: "User has been disabled" };
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);
      if (!isPasswordValid) {
        return { success: false, message: "Invalid username or password" };
      }

      // Update last login time
      this.getDb().prepare("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);

      return { success: true, message: "Login successful", user };
    } catch (error: any) {
      return { success: false, message: `Login failed: ${error.message}` };
    }
  }

  // 续期激活（重新激活）
  async renewActivation(activationCode: string): Promise<{ success: boolean; message: string }> {
    try {
      const activation = await this.getActivationByCode(activationCode);
      if (!activation) {
        return { success: false, message: "Activation code does not exist" };
      }

      // Reset expiration time (1 year from now)
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      const stmt = this.getDb().prepare(`
        UPDATE activations 
        SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      const result = stmt.run(expiresAt.toISOString(), activation.id);

      if (result.changes > 0) {
        return { success: true, message: `Activation renewed successfully, new expiration date: ${expiresAt.toLocaleDateString()}` };
      }
      return { success: false, message: "Activation renewal failed" };
    } catch (error: any) {
      return { success: false, message: `Renewal failed: ${error.message}` };
    }
  }

  // 禁用激活
  async disableActivation(activationCode: string): Promise<{ success: boolean; message: string }> {
    try {
      const activation = await this.getActivationByCode(activationCode);
      if (!activation) {
        return { success: false, message: "Activation code does not exist" };
      }

      const stmt = this.getDb().prepare("UPDATE activations SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
      const result = stmt.run(activation.id);

      if (result.changes > 0) {
        return { success: true, message: "Activation disabled" };
      }
      return { success: false, message: "Failed to disable activation" };
    } catch (error: any) {
      return { success: false, message: `Disable failed: ${error.message}` };
    }
  }
}

export const activationManager = new ActivationManager();
