import { repo } from '../db/connection';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

export interface CustomerImportData {
  refNo: string;
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zipCode: string;
  telephone?: string;
}

export interface VehicleImportData {
  refNo: string;
  license: string;
  idriver?: string;
  year?: number;
  color: string;
  make: string;
  model?: string;
}

export interface ImportResult {
  success: boolean;
  message: string;
  importedCustomers: number;
  importedVehicles: number;
  errors: string[];
}

export class ImportService {
  private activationId: number;

  constructor(activationId: number) {
    this.activationId = activationId;
  }

  /**
   * 导入用户信息
   */
  async importCustomers(filePath: string, onProgress?: (progress: { current: number; total: number; percent: number; message: string }) => void): Promise<ImportResult> {
    try {
      const data = this.parseFile(filePath);
      const customerData = this.parseCustomerData(data);
      
      const total = customerData.length;
      let importedCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < customerData.length; i++) {
        const customer = customerData[i];
        
        // 更新进度
        if (onProgress) {
          const percent = Math.round(((i + 1) / total) * 100);
          onProgress({
            current: i + 1,
            total: total,
            percent: percent,
            message: `Importing customer: ${customer.name}...`
          });
        }
        try {
          // 如果RefNo存在，检查是否已存在相同customer_number的客户
          if (customer.refNo && customer.refNo.trim()) {
            const allCustomers = repo.customers.getAll(this.activationId) as any[];
            const existingByNumber = allCustomers.find(
              (c: any) => c.customer_number === customer.refNo.toString().trim()
            );
            
            if (existingByNumber) {
              console.log(`客户编号 ${customer.refNo} 已存在（客户: ${existingByNumber.name}），跳过导入`);
              continue;
            }
          }
          
          // 检查是否已存在相同姓名和地址的客户
          const existingCustomer = repo.customers.findByNameAndAddress(
            this.activationId, 
            customer.name, 
            this.formatAddress(customer)
          );

          if (existingCustomer) {
            console.log(`客户 ${customer.name} 已存在，跳过导入`);
            continue;
          }

          // 创建新客户，使用RefNo作为customer_number
          const result = repo.customers.create(this.activationId, {
            name: customer.name,
            phone: customer.telephone,
            address: this.formatAddress(customer),
            customer_number: customer.refNo && customer.refNo.trim() ? customer.refNo.toString().trim() : undefined
          });

          if (result.changes > 0) {
            importedCount++;
          }
        } catch (error) {
          const errorMsg = `导入客户 ${customer.name} (RefNo: ${customer.refNo}) 失败: ${error}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      return {
        success: true,
        message: `成功导入 ${importedCount} 个客户`,
        importedCustomers: importedCount,
        importedVehicles: 0,
        errors
      };
    } catch (error) {
      return {
        success: false,
        message: `导入失败: ${error}`,
        importedCustomers: 0,
        importedVehicles: 0,
        errors: [String(error)]
      };
    }
  }

  /**
   * 导入车辆信息
   */
  async importVehicles(filePath: string, onProgress?: (progress: { current: number; total: number; percent: number; message: string }) => void): Promise<ImportResult> {
    try {
      const data = this.parseFile(filePath);
      const vehicleData = this.parseVehicleData(data);
      
      const total = vehicleData.length;
      let importedCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < vehicleData.length; i++) {
        const vehicle = vehicleData[i];
        
        // 更新进度
        if (onProgress) {
          const percent = Math.round(((i + 1) / total) * 100);
          onProgress({
            current: i + 1,
            total: total,
            percent: percent,
            message: `Importing vehicle: ${vehicle.license}...`
          });
        }
        try {
          // 检查车辆是否已存在
          const existingVehicle = repo.vehicles.findByLicensePlate(
            this.activationId, 
            vehicle.license
          );

          if (existingVehicle) {
            console.log(`车辆 ${vehicle.license} 已存在，跳过导入`);
            continue;
          }

          // 尝试匹配客户
          let customerId: number | undefined;
          
          // 如果有IDriver字段，尝试根据IDriver匹配客户
          if (vehicle.idriver && vehicle.idriver.trim()) {
            const customers = repo.customers.findByName(this.activationId, vehicle.idriver.trim()) as any[];
            if (customers && customers.length > 0) {
              customerId = customers[0].id;
              console.log(`车辆 ${vehicle.license} 匹配到客户: ${customers[0].name}`);
            }
          }
          
          // 创建车辆记录
          const result = repo.vehicles.create(this.activationId, {
            customer_id: customerId,
            license_plate: vehicle.license,
            year: vehicle.year,
            color: vehicle.color,
            make: vehicle.make,
            model: vehicle.model,
            original_ref_no: vehicle.refNo
          });

          if (result.changes > 0) {
            importedCount++;
          }
        } catch (error) {
          const errorMsg = `导入车辆 ${vehicle.license} 失败: ${error}`;
          errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      return {
        success: true,
        message: `成功导入 ${importedCount} 个车辆`,
        importedCustomers: 0,
        importedVehicles: importedCount,
        errors
      };
    } catch (error) {
      return {
        success: false,
        message: `导入失败: ${error}`,
        importedCustomers: 0,
        importedVehicles: 0,
        errors: [String(error)]
      };
    }
  }

  /**
   * 解析文件
   */
  private parseFile(filePath: string): any[] {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.csv') {
      return this.parseCSV(filePath);
    } else if (ext === '.xlsx' || ext === '.xls') {
      return this.parseExcel(filePath);
    } else {
      throw new Error('不支持的文件格式');
    }
  }

  /**
   * 解析CSV文件
   */
  private parseCSV(filePath: string): any[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      throw new Error('文件内容不足');
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data: any[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const row: any = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      data.push(row);
    }

    return data;
  }

  /**
   * 解析Excel文件
   */
  private parseExcel(filePath: string): any[] {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet);
  }

  /**
   * 解析客户数据
   */
  private parseCustomerData(data: any[]): CustomerImportData[] {
    return data.map(row => {
      // 处理电话号码：如果是科学计数法格式（如4.08E+09），转换为正常格式
      let telephone = row['Telephone'] || row['telephone'] || '';
      if (telephone && typeof telephone === 'number') {
        // 如果是数字，直接转换为字符串
        telephone = telephone.toString();
      } else if (telephone && typeof telephone === 'string' && telephone.includes('E+')) {
        // 如果是科学计数法格式，转换为正常数字
        const num = parseFloat(telephone);
        if (!isNaN(num)) {
          telephone = Math.floor(num).toString();
        }
      }
      
      return {
        refNo: (row['RefNo'] || row['refNo'] || '').toString().trim(),
        name: (row['Name'] || row['name'] || '').toString().trim(),
        address1: (row['Address1'] || row['address1'] || '').toString().trim(),
        address2: (row['Address2'] || row['address2'] || '').toString().trim(),
        city: (row['City'] || row['city'] || '').toString().trim(),
        state: (row['State'] || row['state'] || '').toString().trim(),
        zipCode: (row['ZIP Code'] || row['zipCode'] || row['ZIP'] || '').toString().trim(),
        telephone: telephone.trim()
      };
    }).filter(customer => customer.name && customer.name.length > 0); // 过滤掉空行
  }

  /**
   * 解析车辆数据
   */
  private parseVehicleData(data: any[]): VehicleImportData[] {
    return data.map(row => ({
      refNo: row['Ref. No.'] || row['RefNo'] || row['refNo'] || '',
      license: row['License'] || row['license'] || '',
      idriver: row['IDriver'] || row['idriver'] || '',
      year: row['N'] ? parseInt(row['N']) : undefined,
      color: row['Color'] || row['color'] || '',
      make: row['Make'] || row['make'] || '',
      model: row['Model'] || row['model'] || ''
    }));
  }

  /**
   * 格式化地址
   */
  private formatAddress(customer: CustomerImportData): string {
    const parts = [
      customer.address1,
      customer.address2,
      customer.city,
      customer.state,
      customer.zipCode
    ].filter(part => part && part.trim());
    
    return parts.join(', ');
  }
}
