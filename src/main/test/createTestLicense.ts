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
    
    console.log('测试授权创建成功！');
    console.log('授权码:', licenseKey);
    console.log('默认管理员账号: admin');
    console.log('默认密码: admin123');
    console.log('请使用这些信息登录系统');
    
  } catch (error) {
    console.error('创建测试授权失败:', error);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  createTestLicense();
}

export { createTestLicense };

