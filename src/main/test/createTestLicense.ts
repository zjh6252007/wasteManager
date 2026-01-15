import { licenseManager } from '../auth/licenseManager';
import { createDb } from '../db/connection';

// 创建测试授权
async function createTestLicense() {
  try {
    // 初始化数据库
    await createDb();
    
    // 创建测试授权
    const licenseKey = await licenseManager.createLicense({
      companyName: 'test',
      contactPerson: '张三',
      contactPhone: '13800138000',
      contactEmail: 'test@example.com',
      durationMonths: 12, // 1年
      maxUsers: 5
    });
    
    console.log('Test license created successfully!');
    console.log('License key:', licenseKey);
    console.log('Default admin account: admin');
    console.log('Default password: admin123');
    console.log('Please use this information to log in to the system');
    
  } catch (error) {
    console.error('Failed to create test license:', error);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  createTestLicense();
}

export { createTestLicense };

