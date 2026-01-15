import http from 'http';
import https from 'https';

/**
 * 云端数据库服务
 * 所有数据库操作都通过 HTTP 请求到服务器
 */
export class CloudDbService {
  private serverUrl: string;
  private activationId: number;

  constructor(serverUrl: string, activationId: number) {
    // 移除末尾的斜杠，并移除可能的路径（如 /backup/upload）
    let cleanUrl = serverUrl.replace(/\/+$/, '');
    // 如果 URL 包含路径，只保留协议、主机和端口
    try {
      const url = new URL(cleanUrl);
      this.serverUrl = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}`;
    } catch {
      // 如果不是有效的 URL，直接使用清理后的 URL
      this.serverUrl = cleanUrl;
    }
    this.activationId = activationId;
  }

  /**
   * 发送 HTTP 请求
   */
  private async request(method: string, path: string, data?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // 确保 path 以 / 开头
      const cleanPath = path.startsWith('/') ? path : '/' + path;
      // 构建完整 URL
      const fullUrl = this.serverUrl + cleanPath;
      let url: URL;
      try {
        url = new URL(fullUrl);
      } catch (error) {
        reject(new Error(`Invalid URL: ${fullUrl}`));
        return;
      }
      const client = url.protocol === 'https:' ? https : http;

      const postData = data ? JSON.stringify(data) : undefined;
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
        },
        timeout: 30000
      };

      const req = client.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => {
          responseData += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            try {
              const result = JSON.parse(responseData);
              resolve(result);
            } catch (error) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            try {
              const error = JSON.parse(responseData);
              reject(new Error(error.message || `HTTP ${res.statusCode}`));
            } catch {
              reject(new Error(`HTTP ${res.statusCode}: ${responseData.substring(0, 200)}`));
            }
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  // ==================== 客户相关操作 ====================

  async getCustomers(): Promise<any[]> {
    const result = await this.request('GET', `/api/customers?activationId=${this.activationId}`);
    return result.success ? result.data : [];
  }

  async getCustomerById(id: number): Promise<any | null> {
    const customers = await this.getCustomers();
    return customers.find(c => c.id === id) || null;
  }

  async createCustomer(data: {
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
  }): Promise<any> {
    const result = await this.request('POST', '/api/customers', {
      activationId: this.activationId,
      ...data
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to create customer');
    }
    return result.data;
  }

  async updateCustomer(id: number, data: {
    name?: string;
    phone?: string;
    address?: string;
    license_number?: string;
    license_photo_path?: string;
    id_expiration?: string;
    height?: string;
    weight?: string;
    hair_color?: string;
  }): Promise<any> {
    const result = await this.request('PUT', `/api/customers/${id}`, {
      activationId: this.activationId,
      ...data
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to update customer');
    }
    return result.data;
  }

  async searchCustomers(query: string): Promise<any[]> {
    const customers = await this.getCustomers();
    const lowerQuery = query.toLowerCase();
    return customers.filter(c => 
      c.name?.toLowerCase().includes(lowerQuery) ||
      c.phone?.toLowerCase().includes(lowerQuery) ||
      c.customer_number?.toLowerCase().includes(lowerQuery)
    );
  }

  async createCustomersBatch(customers: Array<{
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
  }>): Promise<{ success: boolean; created: number; errors: string[] }> {
    const result = await this.request('POST', '/api/customers/batch', {
      activationId: this.activationId,
      customers
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to create customers batch');
    }
    return result;
  }

  // ==================== 称重会话相关操作 ====================

  async getSessions(options: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    customerName?: string;
  } = {}): Promise<{
    data: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const params = new URLSearchParams({
      activationId: this.activationId.toString(),
      page: (options.page || 1).toString(),
      limit: (options.limit || 20).toString(),
      ...(options.startDate ? { startDate: options.startDate } : {}),
      ...(options.endDate ? { endDate: options.endDate } : {}),
      ...(options.customerName ? { customerName: options.customerName } : {})
    });

    const result = await this.request('GET', `/api/sessions?${params.toString()}`);
    if (!result.success) {
      throw new Error(result.message || 'Failed to get sessions');
    }
    return {
      data: result.data || [],
      pagination: result.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 }
    };
  }

  async getSessionById(id: number): Promise<any | null> {
    const sessions = await this.getSessions({ page: 1, limit: 1000 });
    return sessions.data.find(s => s.id === id) || null;
  }

  async createSession(data: {
    customer_id?: number;
    session_time?: string;
    notes?: string;
    total_amount?: number;
  }): Promise<any> {
    const result = await this.request('POST', '/api/sessions', {
      activationId: this.activationId,
      ...data
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to create session');
    }
    return result.data;
  }

  async updateSession(id: number, data: {
    notes?: string;
    total_amount?: number;
    status?: string;
  }): Promise<any> {
    const result = await this.request('PUT', `/api/sessions/${id}`, {
      activationId: this.activationId,
      ...data
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to update session');
    }
    return result.data;
  }

  async getUnfinishedSessionsCount(): Promise<number> {
    const sessions = await this.getSessions({ page: 1, limit: 1000 });
    // 检查状态为 'unfinished' 或 'pending' 的会话
    return sessions.data.filter(s => !s.status || s.status === 'pending' || s.status === 'unfinished').length;
  }

  async deleteSession(sessionId: number): Promise<void> {
    // 先删除该session的所有weighings
    await this.deleteWeighingsBySession(sessionId);
    // 然后删除session
    const result = await this.request('DELETE', `/api/sessions/${sessionId}?activationId=${this.activationId}`);
    if (!result.success) {
      throw new Error(result.message || 'Failed to delete session');
    }
  }

  // ==================== 称重记录相关操作 ====================

  async createWeighing(data: {
    session_id: number;
    waste_type_id?: number;
    weight: number;
    unit_price: number;
    total_amount: number;
    weighing_time?: string;
  }): Promise<any> {
    const result = await this.request('POST', '/api/weighings', {
      activationId: this.activationId,
      ...data
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to create weighing');
    }
    return result.data;
  }

  async getWeighingsBySession(sessionId: number): Promise<any[]> {
    const result = await this.request('GET', `/api/weighings?activationId=${this.activationId}&sessionId=${sessionId}`);
    return result.success ? result.data : [];
  }

  async getAllWeighings(): Promise<any[]> {
    const result = await this.request('GET', `/api/weighings?activationId=${this.activationId}`);
    return result.success ? result.data : [];
  }

  async deleteWeighingsBySession(sessionId: number): Promise<void> {
    const result = await this.request('DELETE', `/api/weighings?activationId=${this.activationId}&sessionId=${sessionId}`);
    if (!result.success) {
      throw new Error(result.message || 'Failed to delete weighings by session');
    }
  }

  // ==================== 金属类型相关操作 ====================

  async getMetalTypes(): Promise<any[]> {
    const result = await this.request('GET', `/api/metalTypes?activationId=${this.activationId}`);
    return result.success ? result.data : [];
  }

  async getMetalTypeById(id: number): Promise<any | null> {
    const metalTypes = await this.getMetalTypes();
    return metalTypes.find(m => m.id === id) || null;
  }

  async createMetalType(data: {
    symbol: string;
    name: string;
    price_per_unit: number;
    unit?: string;
  }): Promise<any> {
    const result = await this.request('POST', '/api/metalTypes', {
      activationId: this.activationId,
      ...data
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to create metal type');
    }
    return result.data;
  }

  async updateMetalType(id: number, data: {
    name?: string;
    price_per_unit?: number;
    unit?: string;
  }): Promise<any> {
    const result = await this.request('PUT', `/api/metalTypes/${id}`, {
      activationId: this.activationId,
      ...data
    });
    if (!result.success) {
      throw new Error(result.message || 'Failed to update metal type');
    }
    return result.data;
  }

  async deleteMetalType(id: number): Promise<void> {
    const result = await this.request('DELETE', `/api/metalTypes/${id}?activationId=${this.activationId}`);
    if (!result.success) {
      throw new Error(result.message || 'Failed to delete metal type');
    }
  }
}

