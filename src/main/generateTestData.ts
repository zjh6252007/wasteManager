import { getDb } from './db/connection';

// 生成随机测试数据
export async function generateTestData() {
  const db = getDb();
  
  // 获取激活ID
  const activation = db.prepare("SELECT id FROM activations LIMIT 1").get() as { id: number };
  if (!activation) {
    console.log('No activation found, skipping test data generation');
    return;
  }
  
  const activationId = activation.id;
  
  // 获取现有的客户和金属类型
  const customers = db.prepare("SELECT id FROM customers WHERE activation_id = ?").all(activationId) as { id: number }[];
  const metalTypes = db.prepare("SELECT id, price_per_unit FROM metal_types WHERE activation_id = ?").all(activationId) as { id: number; price_per_unit: number }[];
  
  if (customers.length === 0 || metalTypes.length === 0) {
    console.log('No customers or metal types found, skipping test data generation');
    return;
  }
  
  // 生成100条随机称重记录
  const insertStmt = db.prepare(`
    INSERT INTO weighings (activation_id, customer_id, waste_type_id, weight, unit_price, total_amount, notes, weighing_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const startDate = new Date('2024-01-01');
  const endDate = new Date();
  
  for (let i = 0; i < 100; i++) {
    // 随机选择客户（30%概率为null）
    const customerId = Math.random() < 0.3 ? null : customers[Math.floor(Math.random() * customers.length)].id;
    
    // 随机选择金属类型
    const metalType = metalTypes[Math.floor(Math.random() * metalTypes.length)];
    
    // 随机重量（0.1到100磅）
    const weight = Math.random() * 99.9 + 0.1;
    
    // 计算总金额
    const totalAmount = weight * metalType.price_per_unit;
    
    // 随机备注
    const notes = Math.random() < 0.3 ? null : `Test note ${i + 1}`;
    
    // 随机时间
    const randomTime = new Date(startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime()));
    
    insertStmt.run(
      activationId,
      customerId,
      metalType.id,
      weight,
      metalType.price_per_unit,
      totalAmount,
      notes,
      randomTime.toISOString()
    );
  }
  
  console.log('Generated 100 random weighing records');
}

// 如果直接运行此文件，则生成测试数据
if (require.main === module) {
  generateTestData().then(() => {
    console.log('Test data generation completed');
    process.exit(0);
  }).catch(error => {
    console.error('Error generating test data:', error);
    process.exit(1);
  });
}
