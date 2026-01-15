import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * License validation service
 * Used to verify account expiration time with server
 */
export class LicenseValidationService {
  private backupServerUrl: string;

  constructor(backupServerUrl?: string) {
    // Extract base URL (remove path part)
    const url = backupServerUrl || 'https://backup-server-1378.azurewebsites.net';
    try {
      const urlObj = new URL(url);
      // Only keep protocol, hostname and port, remove path
      this.backupServerUrl = `${urlObj.protocol}//${urlObj.host}`;
    } catch {
      // If URL parsing fails, use original value
      this.backupServerUrl = url.replace(/\/+$/, '').replace(/\/[^\/]+$/, '');
    }
  }

  /**
   * Validate activation code expiration time from server
   */
  async validateLicenseFromServer(activationCode: string): Promise<{
    success: boolean;
    expired?: boolean;
    expiresAt?: string;
    message?: string;
  }> {
    if (!this.backupServerUrl) {
      return {
        success: false,
        message: 'Backup server URL not configured'
      };
    }

    try {
      // Build API endpoint URL
      const baseUrl = this.backupServerUrl.replace(/\/+$/, ''); // Remove trailing slash
      const apiUrl = `${baseUrl}/license/validate`;
      const url = new URL(apiUrl);

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      };

      const requestData = JSON.stringify({
        activationCode: activationCode
      });

      return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(requestOptions, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                const response = JSON.parse(data);
                resolve({
                  success: true,
                  expired: response.expired || false,
                  expiresAt: response.expiresAt,
                  message: response.message
                });
              } else if (res.statusCode === 404) {
                // Server doesn't support this endpoint, return failure but don't block login
                console.warn('License validation endpoint not found on server, using local validation');
                resolve({
                  success: false,
                  message: 'License validation endpoint not available on server'
                });
              } else {
                const errorResponse = data ? JSON.parse(data) : {};
                resolve({
                  success: false,
                  message: errorResponse.message || `Server returned status ${res.statusCode}`
                });
              }
            } catch (error) {
              resolve({
                success: false,
                message: `Failed to parse server response: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          });
        });

        req.on('error', (error) => {
          // Network error, don't block login, but log warning
          console.warn('Failed to validate license from server:', error.message);
          resolve({
            success: false,
            message: `Network error: ${error.message}`
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: false,
            message: 'Request timeout'
          });
        });

        req.write(requestData);
        req.end();
      });
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Report renewal operation to server
   */
  async reportRenewalToServer(activationCode: string, newExpiresAt: string, username?: string): Promise<{
    success: boolean;
    message?: string;
  }> {
    if (!this.backupServerUrl) {
      return {
        success: false,
        message: 'Backup server URL not configured'
      };
    }

    try {
      const baseUrl = this.backupServerUrl.replace(/\/+$/, '');
      const apiUrl = `${baseUrl}/license/renew`;
      const url = new URL(apiUrl);

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      };

      const requestData = JSON.stringify({
        activationCode: activationCode,
        expiresAt: newExpiresAt,
        username: username || undefined
      });

      return new Promise((resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(requestOptions, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode === 200 || res.statusCode === 201) {
                const response = data ? JSON.parse(data) : {};
                resolve({
                  success: true,
                  message: response.message || 'Renewal reported to server successfully'
                });
              } else if (res.statusCode === 404) {
                // Server doesn't support this endpoint, but don't block renewal
                console.warn('License renewal endpoint not found on server, renewal completed locally only');
                resolve({
                  success: true,
                  message: 'Renewal completed locally (server endpoint not available)'
                });
              } else {
                const errorResponse = data ? JSON.parse(data) : {};
                resolve({
                  success: false,
                  message: errorResponse.message || `Server returned status ${res.statusCode}`
                });
              }
            } catch (error) {
              resolve({
                success: true, // Consider success even if parsing fails (local already updated)
                message: 'Renewal completed locally (server response parsing failed)'
              });
            }
          });
        });

        req.on('error', (error) => {
          // 网络错误，不阻止续费，但记录警告
          console.warn('Failed to report renewal to server:', error.message);
          resolve({
            success: true, // Local already updated, server update failure doesn't affect renewal
            message: 'Renewal completed locally (server update failed)'
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: true,
            message: 'Renewal completed locally (server update timeout)'
          });
        });

        req.write(requestData);
        req.end();
      });
    } catch (error) {
      return {
        success: true, // Local already updated, server update failure doesn't affect renewal
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Validate user login from server (username, password and activation code)
   * activationCode is optional, if not provided, server will find by username
   */
  async authenticateUserFromServer(username: string, password: string, activationCode?: string): Promise<{
    success: boolean;
    user?: {
      id: number;
      username: string;
      role: string;
      activation_id: number;
      activation_code: string;
      company_name: string;
      expires_at: string;
    };
    expired?: boolean;
    message?: string;
  }> {
    if (!this.backupServerUrl) {
      return {
        success: false,
        message: 'Backup server URL not configured'
      };
    }

    try {
      const baseUrl = this.backupServerUrl.replace(/\/+$/, '');
      const apiUrl = `${baseUrl}/license/authenticate`;
      const url = new URL(apiUrl);

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      };

      const requestBody: any = {
        username: username,
        password: password
      };
      if (activationCode) {
        requestBody.activationCode = activationCode;
      }
      const requestData = JSON.stringify(requestBody);

      return new Promise((resolve) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(requestOptions, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                const response = JSON.parse(data);
                if (response.success) {
                  resolve({
                    success: true,
                    user: response.user,
                    message: response.message
                  });
                } else {
                  resolve({
                    success: false,
                    expired: response.expired || false,
                    message: response.message || 'Authentication failed'
                  });
                }
              } else if (res.statusCode === 404) {
                resolve({
                  success: false,
                  message: 'Authentication endpoint not available on server'
                });
              } else {
                const errorResponse = data ? JSON.parse(data) : {};
                resolve({
                  success: false,
                  message: errorResponse.message || `Server returned status ${res.statusCode}`
                });
              }
            } catch (error) {
              resolve({
                success: false,
                message: `Failed to parse server response: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          });
        });

        req.on('error', (error) => {
          console.warn('Failed to authenticate user from server:', error.message);
          resolve({
            success: false,
            message: `Network error: ${error.message}`
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: false,
            message: 'Request timeout'
          });
        });

        req.write(requestData);
        req.end();
      });
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get user's associated activation code from server
   */
  async getUserActivationFromServer(username: string): Promise<{
    success: boolean;
    activationCode?: string;
    expiresAt?: string;
    message?: string;
  }> {
    if (!this.backupServerUrl) {
      return {
        success: false,
        message: 'Backup server URL not configured'
      };
    }

    try {
      const baseUrl = this.backupServerUrl.replace(/\/+$/, '');
      const apiUrl = `${baseUrl}/license/get-user-activation`;
      const url = new URL(apiUrl);

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      };

      const requestData = JSON.stringify({ username });

      return new Promise((resolve) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(requestOptions, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode === 200) {
                const response = JSON.parse(data);
                if (response.success) {
                  resolve({
                    success: true,
                    activationCode: response.activationCode,
                    expiresAt: response.expiresAt
                  });
                } else {
                  resolve({
                    success: false,
                    message: response.message || 'User not found'
                  });
                }
              } else if (res.statusCode === 404) {
                resolve({
                  success: false,
                  message: 'Endpoint not available on server'
                });
              } else {
                const errorResponse = data ? JSON.parse(data) : {};
                resolve({
                  success: false,
                  message: errorResponse.message || `Server returned status ${res.statusCode}`
                });
              }
            } catch (error) {
              resolve({
                success: false,
                message: `Failed to parse server response: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          });
        });

        req.on('error', (error) => {
          console.warn('Failed to get user activation from server:', error.message);
          resolve({
            success: false,
            message: `Network error: ${error.message}`
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: false,
            message: 'Request timeout'
          });
        });

        req.write(requestData);
        req.end();
      });
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Check network connection with retry mechanism
   * @param retries Number of retry attempts (default: 2)
   * @param timeoutMs Timeout in milliseconds (default: 10000 = 10 seconds)
   */
  async checkNetworkConnection(retries: number = 2, timeoutMs: number = 10000): Promise<boolean> {
    if (!this.backupServerUrl) {
      return false;
    }

    // Try multiple times if first attempt fails
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const baseUrl = this.backupServerUrl.replace(/\/+$/, '');
        const url = new URL(baseUrl);

        const result = await new Promise<boolean>((resolve) => {
          const client = url.protocol === 'https:' ? https : http;
          const req = client.request({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: '/',
            method: 'HEAD',
            timeout: timeoutMs,
          }, (res) => {
            // Any response (even error status) means network is available
            resolve(res.statusCode !== undefined);
          });

          req.on('error', (error) => {
            if (attempt < retries) {
              console.log(`[Network Check] Attempt ${attempt + 1}/${retries + 1} failed: ${error.message}, will retry...`);
            }
            resolve(false);
          });

          req.on('timeout', () => {
            req.destroy();
            if (attempt < retries) {
              console.log(`[Network Check] Attempt ${attempt + 1}/${retries + 1} timed out, will retry...`);
            }
            resolve(false);
          });

          req.end();
        });

        // If connection successful, return immediately
        if (result) {
          if (attempt > 0) {
            console.log(`[Network Check] Success on attempt ${attempt + 1}/${retries + 1}`);
          }
          return true;
        }

        // If this was not the last attempt, wait a bit before retrying
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      } catch (error) {
        if (attempt < retries) {
          console.log(`[Network Check] Attempt ${attempt + 1}/${retries + 1} error: ${error instanceof Error ? error.message : 'Unknown error'}, will retry...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }

    // All attempts failed
    console.log(`[Network Check] All ${retries + 1} attempts failed`);
    return false;
  }
}

