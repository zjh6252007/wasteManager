import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { repo } from '../db/connection';

export interface BiometricData {
  faceImagePath?: string;
  fingerprintTemplate?: Buffer;
  fingerprintImagePath?: string;
}

export class BiometricService {
  private activationId: number;
  private biometricDir: string;

  constructor(activationId: number) {
    this.activationId = activationId;
    this.biometricDir = path.join(app.getPath('userData'), 'biometric_data');
    this.ensureBiometricDir();
  }

  /**
   * 确保生物识别数据目录存在
   */
  private ensureBiometricDir() {
    if (!fs.existsSync(this.biometricDir)) {
      fs.mkdirSync(this.biometricDir, { recursive: true });
    }
  }

  /**
   * 保存面部照片
   */
  async saveFaceImage(customerId: number, imageData: Buffer): Promise<string> {
    const fileName = `face_${customerId}_${Date.now()}.jpg`;
    const filePath = path.join(this.biometricDir, fileName);
    
    fs.writeFileSync(filePath, imageData);
    
    // 更新数据库
    const existingData = repo.biometricData.getByCustomerId(this.activationId, customerId);
    if (existingData) {
      repo.biometricData.update(this.activationId, customerId, { face_image_path: filePath });
    } else {
      repo.biometricData.create(this.activationId, {
        customer_id: customerId,
        face_image_path: filePath
      });
    }
    
    return filePath;
  }

  /**
   * 保存签名图片
   */
  async saveSignatureImage(customerId: number, imageData: Buffer): Promise<string> {
    const fileName = `signature_${customerId}_${Date.now()}.jpg`;
    const filePath = path.join(this.biometricDir, fileName);
    
    fs.writeFileSync(filePath, imageData);
    
    // 更新数据库
    const existingData = repo.biometricData.getByCustomerId(this.activationId, customerId);
    if (existingData) {
      repo.biometricData.update(this.activationId, customerId, { signature_image_path: filePath });
    } else {
      repo.biometricData.create(this.activationId, {
        customer_id: customerId,
        signature_image_path: filePath
      });
    }
    
    return filePath;
  }

  /**
   * 保存临时照片（用于驾照照片，在客户创建之前）
   * 只保存文件，不保存到数据库
   */
  async saveTemporaryPhoto(imageData: Buffer): Promise<string> {
    const fileName = `license_temp_${Date.now()}.jpg`;
    const filePath = path.join(this.biometricDir, fileName);
    
    fs.writeFileSync(filePath, imageData);
    
    // 不保存到数据库，只返回文件路径
    return filePath;
  }

  /**
   * 保存指纹数据
   */
  async saveFingerprintData(customerId: number, template: Buffer, imageData?: Buffer): Promise<string> {
    const templateFileName = `fingerprint_${customerId}_${Date.now()}.dat`;
    const templatePath = path.join(this.biometricDir, templateFileName);
    
    fs.writeFileSync(templatePath, template);
    
    let imagePath: string | undefined;
    if (imageData) {
      const imageFileName = `fingerprint_img_${customerId}_${Date.now()}.jpg`;
      imagePath = path.join(this.biometricDir, imageFileName);
      fs.writeFileSync(imagePath, imageData);
    }
    
    // 更新数据库
    const existingData = repo.biometricData.getByCustomerId(this.activationId, customerId);
    if (existingData) {
      repo.biometricData.update(this.activationId, customerId, {
        fingerprint_template: template,
        fingerprint_image_path: imagePath
      });
    } else {
      repo.biometricData.create(this.activationId, {
        customer_id: customerId,
        fingerprint_template: template,
        fingerprint_image_path: imagePath
      });
    }
    
    return templatePath;
  }

  /**
   * 获取客户的生物识别数据
   */
  getBiometricData(customerId: number): any {
    return repo.biometricData.getByCustomerId(this.activationId, customerId);
  }

  /**
   * 获取所有生物识别数据
   */
  getAllBiometricData(): any[] {
    return repo.biometricData.getAll(this.activationId);
  }

  /**
   * 删除生物识别数据
   */
  async deleteBiometricData(customerId: number): Promise<void> {
    const data = repo.biometricData.getByCustomerId(this.activationId, customerId);
    if (data) {
      // 删除文件
      if (data.face_image_path && fs.existsSync(data.face_image_path)) {
        fs.unlinkSync(data.face_image_path);
      }
      if (data.fingerprint_image_path && fs.existsSync(data.fingerprint_image_path)) {
        fs.unlinkSync(data.fingerprint_image_path);
      }
      
      // 删除数据库记录
      const db = repo['db'] || require('../db/connection').getDb();
      const stmt = db.prepare('DELETE FROM biometric_data WHERE activation_id = ? AND customer_id = ?');
      stmt.run(this.activationId, customerId);
    }
  }
}
