/**
 * Fingerprint hardware abstraction layer
 * Supports multiple fingerprint scanner hardware
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

// 动态加载 usb 模块，避免在构建时被打包
let usb: any;
function getUsb() {
  if (!usb) {
    usb = require('usb');
  }
  return usb;
}

export interface FingerprintDevice {
  id: string;
  vendorId: number;
  productId: number;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
}

export interface FingerprintCaptureResult {
  success: boolean;
  template?: Buffer;
  imageData?: Buffer;
  quality?: number;
  error?: string;
}

/**
 * Fingerprint hardware interface
 */
export class FingerprintHardware {
  private device: any = null;
  private interface: any = null;
  private endpointIn: any = null;
  private endpointOut: any = null;
  private isInitialized: boolean = false;
  private deviceInfo: FingerprintDevice | null = null;

  // Common fingerprint scanner Vendor ID and Product ID
  // Supports most mainstream fingerprint devices on the market
  private static KNOWN_DEVICES = [
    // Synaptics series
    { vendorId: 0x0c45, productId: 0x0010, name: 'Synaptics Fingerprint Reader' },
    { vendorId: 0x0c45, productId: 0x0011, name: 'Synaptics USB WBDI' },
    { vendorId: 0x0c45, productId: 0x0012, name: 'Synaptics Fingerprint Sensor' },
    { vendorId: 0x0c45, productId: 0x0013, name: 'Synaptics WBDI Fingerprint' },
    
    // STMicroelectronics series
    { vendorId: 0x0483, productId: 0x2016, name: 'STMicroelectronics Fingerprint' },
    { vendorId: 0x0483, productId: 0x2015, name: 'STMicroelectronics Fingerprint Sensor' },
    
    // Goodix series (common in laptops)
    { vendorId: 0x27c6, productId: 0x639c, name: 'Goodix Fingerprint' },
    { vendorId: 0x27c6, productId: 0x5385, name: 'Goodix Fingerprint Sensor' },
    { vendorId: 0x27c6, productId: 0x55b4, name: 'Goodix Fingerprint Reader' },
    
    // Validity Sensors series
    { vendorId: 0x138a, productId: 0x0011, name: 'Validity Sensors Fingerprint' },
    { vendorId: 0x138a, productId: 0x0017, name: 'Validity Sensors VFS5011' },
    { vendorId: 0x138a, productId: 0x0018, name: 'Validity Sensors VFS471' },
    { vendorId: 0x138a, productId: 0x003f, name: 'Validity Sensors VFS495' },
    { vendorId: 0x138a, productId: 0x0050, name: 'Validity Sensors VFS7500' },
    
    // ZKTeco series (commonly used in attendance machines)
    { vendorId: 0x0acd, productId: 0x2010, name: 'ZKTeco Fingerprint Scanner' },
    { vendorId: 0x0acd, productId: 0x2011, name: 'ZKTeco Fingerprint Reader' },
    
    // Suprema series
    { vendorId: 0x1c7a, productId: 0x0600, name: 'Suprema Fingerprint Scanner' },
    { vendorId: 0x1c7a, productId: 0x0601, name: 'Suprema Fingerprint Reader' },
    
    // DigitalPersona series
    { vendorId: 0x05ba, productId: 0x0007, name: 'DigitalPersona Fingerprint Reader' },
    { vendorId: 0x05ba, productId: 0x000a, name: 'DigitalPersona U.are.U' },
    
    // Upek series
    { vendorId: 0x147e, productId: 0x1000, name: 'Upek Fingerprint Reader' },
    { vendorId: 0x147e, productId: 0x2016, name: 'Upek TouchChip' },
    
    // AuthenTec series
    { vendorId: 0x08ff, productId: 0x2580, name: 'AuthenTec Fingerprint Sensor' },
    { vendorId: 0x08ff, productId: 0x2660, name: 'AuthenTec AES2501' },
    
    // EgisTec series
    { vendorId: 0x1c7a, productId: 0x0801, name: 'EgisTec Fingerprint Sensor' },
    { vendorId: 0x1c7a, productId: 0x0802, name: 'EgisTec ES603' },
    
    // Generic HID fingerprint devices (communicate via HID protocol)
    { vendorId: 0x0c45, productId: 0x0001, name: 'Generic Fingerprint Scanner' },
  ];

  /**
   * List all USB devices (for debugging)
   */
  static async listAllUsbDevices(): Promise<Array<{vendorId: number, productId: number, vendorIdHex: string, productIdHex: string, manufacturer?: string, product?: string}>> {
    const allDevices: Array<{vendorId: number, productId: number, vendorIdHex: string, productIdHex: string, manufacturer?: string, product?: string}> = [];
    
    try {
      const usbModule = getUsb();
      const usbDevices = usbModule.getDeviceList();
      
      for (const usbDevice of usbDevices) {
        const descriptor = usbDevice.deviceDescriptor;
        const vendorId = descriptor.idVendor;
        const productId = descriptor.idProduct;
        
        let manufacturer = '';
        let product = '';
        
        try {
          usbDevice.open();
          
          const getString = (index: number): Promise<string> => {
            return new Promise((resolve) => {
              if (!index) {
                resolve('');
                return;
              }
              try {
                usbDevice.getStringDescriptor(index, (error, value) => {
                  resolve(error ? '' : (value || ''));
                });
              } catch (e) {
                resolve('');
              }
            });
          };
          
          if (descriptor.iManufacturer) {
            manufacturer = await getString(descriptor.iManufacturer);
          }
          if (descriptor.iProduct) {
            product = await getString(descriptor.iProduct);
          }
          
          usbDevice.close();
        } catch (e) {
          // Ignore errors
        }
        
        allDevices.push({
          vendorId,
          productId,
          vendorIdHex: `0x${vendorId.toString(16).padStart(4, '0')}`,
          productIdHex: `0x${productId.toString(16).padStart(4, '0')}`,
          manufacturer: manufacturer || undefined,
          product: product || undefined
        });
      }
    } catch (error) {
      console.error('Error listing USB devices:', error);
    }
    
    return allDevices;
  }

  /**
   * Detect available fingerprint devices
   */
  static async detectDevices(): Promise<FingerprintDevice[]> {
    const devices: FingerprintDevice[] = [];
    
    try {
      const usbModule = getUsb();
      const usbDevices = usbModule.getDeviceList();
      console.log(`[FingerprintHardware] Scanning ${usbDevices.length} USB devices...`);
      
      for (const usbDevice of usbDevices) {
        const descriptor = usbDevice.deviceDescriptor;
        const vendorId = descriptor.idVendor;
        const productId = descriptor.idProduct;
        
        // 检查是否是已知的指纹设备
        const knownDevice = this.KNOWN_DEVICES.find(
          d => d.vendorId === vendorId && d.productId === productId
        );
        
        // 也检查是否是HID设备（很多指纹设备使用HID协议）
        let isHidDevice = false;
        let hidInterfaceCount = 0;
        try {
          const interfaces = usbDevice.interfaces || [];
          for (const iface of interfaces) {
            if (iface.descriptor.bInterfaceClass === 0x03) { // HID class
              isHidDevice = true;
              hidInterfaceCount++;
            }
          }
        } catch (e) {
          // Ignore errors
        }
        
        // 检查设备名称是否包含指纹相关关键词（用于识别未在列表中的设备）
        let hasFingerprintKeywords = false;
        let manufacturer = '';
        let productName = '';
        
        try {
          usbDevice.open();
          const getString = (index: number): Promise<string> => {
            return new Promise((resolve) => {
              if (!index) {
                resolve('');
                return;
              }
              try {
                usbDevice.getStringDescriptor(index, (error, value) => {
                  resolve(error ? '' : (value || ''));
                });
              } catch (e) {
                resolve('');
              }
            });
          };
          
          if (descriptor.iProduct) {
            productName = await getString(descriptor.iProduct);
          }
          if (descriptor.iManufacturer) {
            manufacturer = await getString(descriptor.iManufacturer);
          }
          
          const combinedName = `${manufacturer} ${productName}`.toLowerCase();
          hasFingerprintKeywords = combinedName.includes('fingerprint') || 
                                   combinedName.includes('chip sailing') ||
                                   combinedName.includes('chipsailing') ||
                                   combinedName.includes('biometric');
          
          usbDevice.close();
        } catch (e) {
          // Ignore errors，继续处理
        }
        
        // 如果设备有HID接口但没有名称，也尝试识别（可能是指纹设备）
        // 但排除常见的非指纹HID设备（键盘、鼠标等）
        const isCommonHidDevice = (vendorId === 0x046d && productId >= 0xc000) || // Logitech鼠标
                                  (vendorId === 0x045e) || // Microsoft
                                  (vendorId === 0x258a && productId === 0x0150) || // SINOWEALTH键盘
                                  (vendorId === 0x30fa && productId === 0x2350); // INSTANT键盘
        
        const shouldInclude = knownDevice || 
                             (isHidDevice && !isCommonHidDevice && (hasFingerprintKeywords || hidInterfaceCount > 0)) ||
                             hasFingerprintKeywords;
        
        if (shouldInclude) {
          const vendorIdHex = `0x${vendorId.toString(16).padStart(4, '0')}`;
          const productIdHex = `0x${productId.toString(16).padStart(4, '0')}`;
          console.log(`[FingerprintHardware] Found potential fingerprint device: ${vendorIdHex}:${productIdHex} (${manufacturer} ${productName})`);
          try {
            usbDevice.open();
            // usb库的Device对象需要通过getStringDescriptor获取字符串（异步回调）
            let manufacturer = '';
            let product = knownDevice ? knownDevice.name : `USB Device ${vendorIdHex}:${productIdHex}`;
            let serialNumber = '';
            
            // 使用Promise包装异步调用
            const getString = (index: number): Promise<string> => {
              return new Promise((resolve) => {
                if (!index) {
                  resolve('');
                  return;
                }
                try {
                  usbDevice.getStringDescriptor(index, (error, value) => {
                    resolve(error ? '' : (value || ''));
                  });
                } catch (e) {
                  resolve('');
                }
              });
            };
            
            try {
              if (descriptor.iManufacturer) {
                manufacturer = await getString(descriptor.iManufacturer);
              }
            } catch (e) {
              // Ignore errors
            }
            
            try {
              if (descriptor.iProduct) {
                const fetchedProduct = await getString(descriptor.iProduct);
                product = fetchedProduct || (knownDevice ? knownDevice.name : `USB Device ${vendorIdHex}:${productIdHex}`);
              }
            } catch (e) {
              // Ignore errors
            }
            
            try {
              if (descriptor.iSerialNumber) {
                serialNumber = await getString(descriptor.iSerialNumber);
              }
            } catch (e) {
              // Ignore errors
            }
            
            usbDevice.close();
            
            devices.push({
              id: `${vendorId.toString(16)}:${productId.toString(16)}`,
              vendorId,
              productId,
              manufacturer,
              product,
              serialNumber
            });
          } catch (error) {
            console.error(`Error reading device info for ${vendorId}:${productId}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error detecting fingerprint devices:', error);
    }
    
    return devices;
  }

  /**
   * 初始化指纹设备
   */
  async initialize(deviceId?: string): Promise<boolean> {
    try {
      // 如果指定了设备ID，尝试打开该设备
      if (deviceId) {
        const [vendorIdStr, productIdStr] = deviceId.split(':');
        const vendorId = parseInt(vendorIdStr, 16);
        const productId = parseInt(productIdStr, 16);
        
        const usbDevices = usb.getDeviceList();
        const targetDevice = usbDevices.find(d => 
          d.deviceDescriptor.idVendor === vendorId &&
          d.deviceDescriptor.idProduct === productId
        );
        
        if (targetDevice) {
          return await this.openDevice(targetDevice);
        }
      }
      
      // 否则自动检测第一个可用设备
      const devices = await FingerprintHardware.detectDevices();
      if (devices.length === 0) {
        console.error('No fingerprint device found');
        return false;
      }
      
      const firstDevice = devices[0];
      const usbModule = getUsb();
      const usbDevices = usbModule.getDeviceList();
      const targetDevice = usbDevices.find(d => 
        d.deviceDescriptor.idVendor === firstDevice.vendorId &&
        d.deviceDescriptor.idProduct === firstDevice.productId
      );
      
      if (targetDevice) {
        this.deviceInfo = firstDevice;
        return await this.openDevice(targetDevice);
      }
      
      return false;
    } catch (error) {
      console.error('Error initializing fingerprint device:', error);
      return false;
    }
  }

  /**
   * 打开USB设备
   */
  private async openDevice(usbDevice: any): Promise<boolean> {
    try {
      this.device = usbDevice;
      
      // 尝试打开设备
      try {
        this.device.open();
      } catch (error: any) {
        // 如果设备被占用或不支持，可能是Windows Hello在使用
        if (error && (error.message?.includes('busy') || error.message?.includes('resource') || error.message?.includes('access') || error.message?.includes('LIBUSB_ERROR_BUSY') || error.message?.includes('LIBUSB_ERROR_ACCESS') || error.message?.includes('LIBUSB_ERROR_NOT_SUPPORTED'))) {
          console.error('Device is busy or does not support direct access, may be used by Windows Hello:', error.message);
          throw new Error('Device is exclusively used by Windows system or does not support direct USB access. Please disable Windows Hello fingerprint login and try again.');
        }
        throw error;
      }
      
      // 尝试找到HID接口
      const interfaces = this.device.interfaces || [];
      for (const iface of interfaces) {
        // 查找HID接口（通常接口类为0x03）
        if (iface.descriptor.bInterfaceClass === 0x03) {
          this.interface = iface;
          
          try {
            if (this.interface.isKernelDriverActive()) {
              try {
                this.interface.detachKernelDriver();
              } catch (error: any) {
                // 如果无法分离驱动，可能是被Windows占用
                if (error && (error.message?.includes('busy') || error.message?.includes('resource') || error.message?.includes('LIBUSB_ERROR_BUSY'))) {
                  console.error('Cannot detach kernel driver, device may be occupied by Windows');
                  this.device.close();
                  throw new Error('Device is exclusively used by Windows system. Please disable Windows Hello fingerprint login and try again.');
                }
                // 其他错误忽略
              }
            }
          } catch (error: any) {
            if (error.message?.includes('Windows system exclusive') || error.message?.includes('Windows系统独占')) {
              throw error;
            }
            // 忽略其他错误
          }
          
          try {
            this.interface.claim();
          } catch (error: any) {
            // 如果无法claim接口，可能是被占用或不支持
            if (error && (error.message?.includes('busy') || error.message?.includes('resource') || error.message?.includes('access') || error.message?.includes('LIBUSB_ERROR_BUSY') || error.message?.includes('LIBUSB_ERROR_ACCESS') || error.message?.includes('LIBUSB_ERROR_NOT_SUPPORTED'))) {
              console.error('Cannot claim interface, device may be busy or does not support direct access:', error.message);
              this.device.close();
              throw new Error('Device is exclusively used by Windows system or does not support direct USB access. Please disable Windows Hello fingerprint login and try again.');
            }
            throw error;
          }
          
          // 查找输入和输出端点
          for (const endpoint of this.interface.endpoints) {
            if (endpoint.direction === 'in' && !this.endpointIn) {
              this.endpointIn = endpoint as usb.InEndpoint;
            } else if (endpoint.direction === 'out' && !this.endpointOut) {
              this.endpointOut = endpoint as usb.OutEndpoint;
            }
          }
          
          this.isInitialized = true;
          return true;
        }
      }
      
      // 如果没有找到HID接口，尝试使用第一个接口
      if (interfaces.length > 0) {
        this.interface = interfaces[0];
        
        try {
          if (this.interface.isKernelDriverActive()) {
            try {
              this.interface.detachKernelDriver();
            } catch (error: any) {
              if (error && (error.message?.includes('busy') || error.message?.includes('resource') || error.message?.includes('LIBUSB_ERROR_BUSY'))) {
                console.error('Cannot detach kernel driver, device may be occupied by Windows');
                this.device.close();
                throw new Error('Device is exclusively used by Windows system. Please disable Windows Hello fingerprint login and try again.');
              }
            }
          }
        } catch (error: any) {
          if (error.message?.includes('Windows system exclusive') || error.message?.includes('Windows系统独占')) {
            throw error;
          }
        }
        
        try {
          this.interface.claim();
        } catch (error: any) {
          if (error && (error.message?.includes('busy') || error.message?.includes('resource') || error.message?.includes('access') || error.message?.includes('LIBUSB_ERROR_BUSY') || error.message?.includes('LIBUSB_ERROR_ACCESS') || error.message?.includes('LIBUSB_ERROR_NOT_SUPPORTED'))) {
            console.error('Cannot claim interface, device may be busy or does not support direct access:', error.message);
            this.device.close();
            throw new Error('Device is exclusively used by Windows system or does not support direct USB access. Please disable Windows Hello fingerprint login and try again.');
          }
          throw error;
        }
        
        for (const endpoint of this.interface.endpoints) {
          if (endpoint.direction === 'in' && !this.endpointIn) {
            this.endpointIn = endpoint as usb.InEndpoint;
          } else if (endpoint.direction === 'out' && !this.endpointOut) {
            this.endpointOut = endpoint as usb.OutEndpoint;
          }
        }
        
        this.isInitialized = true;
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error opening fingerprint device:', error);
      this.cleanup();
      
      // 如果是Windows独占错误，直接抛出
      if (error instanceof Error && (error.message.includes('Windows system exclusive') || error.message.includes('Windows系统独占'))) {
        throw error;
      }
      
      return false;
    }
  }

  /**
   * 开始指纹采集
   */
  async startCapture(): Promise<boolean> {
    if (!this.isInitialized || !this.device) {
      return false;
    }
    
    try {
      // 发送开始采集命令（具体命令取决于硬件）
      // 这里使用通用的HID命令
      const command = Buffer.from([0x01, 0x00]); // 示例命令
      
      if (this.endpointOut) {
        this.endpointOut.transfer(command, (error) => {
          if (error) {
            console.error('Error sending capture command:', error);
          }
        });
      }
      
      return true;
    } catch (error) {
      console.error('Error starting capture:', error);
      return false;
    }
  }

  /**
   * 采集指纹
   */
  async capture(): Promise<FingerprintCaptureResult> {
    if (!this.isInitialized || !this.endpointIn) {
      return {
        success: false,
        error: 'Device not initialized'
      };
    }
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          error: 'Capture timeout'
        });
      }, 10000);
      
      // 监听数据
      const dataBuffer: Buffer[] = [];
      
      const readData = () => {
        if (!this.endpointIn) {
          clearTimeout(timeout);
          resolve({
            success: false,
            error: 'Endpoint not available'
          });
          return;
        }
        
        this.endpointIn.transfer(64, (error, data) => {
          if (error) {
            clearTimeout(timeout);
            resolve({
              success: false,
              error: error.message
            });
            return;
          }
          
          if (data && data.length > 0) {
            dataBuffer.push(data);
            
            // 检查是否收到完整数据（具体逻辑取决于硬件协议）
            // 这里简化处理，假设收到一定长度的数据就完成
            if (dataBuffer.length >= 10 || (data[0] === 0x02 && data[1] === 0x00)) {
              clearTimeout(timeout);
              
              // 合并所有数据
              const fullData = Buffer.concat(dataBuffer);
              
              // 提取模板和图像数据（具体格式取决于硬件）
              // 这里使用简化处理
              const template = fullData.slice(0, Math.min(512, fullData.length));
              const imageData = fullData.length > 512 ? fullData.slice(512) : null;
              
              resolve({
                success: true,
                template: template,
                imageData: imageData || undefined,
                quality: 80 // 默认质量
              });
            } else {
              // 继续读取
              setTimeout(readData, 100);
            }
          } else {
            // 继续读取
            setTimeout(readData, 100);
          }
        });
      };
      
      // 开始读取
      readData();
    });
  }

  /**
   * 停止采集
   */
  async stopCapture(): Promise<void> {
    if (!this.isInitialized || !this.endpointOut) {
      return;
    }
    
    try {
      const command = Buffer.from([0x02, 0x00]); // 停止命令
      this.endpointOut.transfer(command, (error) => {
        if (error) {
          console.error('Error sending stop command:', error);
        }
      });
    } catch (error) {
      console.error('Error stopping capture:', error);
    }
  }

  /**
   * 获取设备信息
   */
  getDeviceInfo(): FingerprintDevice | null {
    return this.deviceInfo;
  }

  /**
   * 获取设备状态
   */
  getStatus(): string {
    if (!this.isInitialized) {
      return 'Not initialized';
    }
    
    if (!this.device) {
      return 'Device not connected';
    }
    
    return 'Ready';
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    try {
      if (this.interface) {
        try {
          this.interface.release(true);
        } catch (error) {
          // Ignore errors
        }
        this.interface = null;
      }
      
      if (this.device) {
        try {
          this.device.close();
        } catch (error) {
          // Ignore errors
        }
        this.device = null;
      }
      
      this.endpointIn = null;
      this.endpointOut = null;
      this.isInitialized = false;
    } catch (error) {
      console.error('Error cleaning up fingerprint device:', error);
    }
  }
}

