import React, { useState, useEffect } from 'react';
import './style.css';
import LoginForm from './components/LoginForm';
import CameraCapture from './components/CameraCapture';
import FingerprintCapture from './components/FingerprintCapture';
import SignatureCapture from './components/SignatureCapture';
import Settings from './components/Settings';
import MetalTypeManagement from './components/MetalTypeManagement';
import ImportProgress from './components/ImportProgress';

// 默认占位图片（SVG编码为base64 data URI）
const DEFAULT_PLACEHOLDER_IMAGE = `data:image/svg+xml;base64,${btoa(`
  <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <rect width="200" height="200" fill="#f0f0f0"/>
    <text x="50%" y="45%" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#999">No Image</text>
    <text x="50%" y="55%" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#999">Available</text>
    <circle cx="100" cy="100" r="30" fill="none" stroke="#ccc" stroke-width="2"/>
  </svg>
`)}`;

// 会话详情组件
const SessionDetails: React.FC<{ sessionId: number }> = ({ sessionId }) => {
  const [sessionWeighings, setSessionWeighings] = useState<any[]>([]);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [biometricData, setBiometricData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [imageCache, setImageCache] = useState<{ [key: string]: string }>({});
  const [imageErrors, setImageErrors] = useState<{ [key: string]: boolean }>({});
  const [generatingReport, setGeneratingReport] = useState(false);

  // 加载session数据和生物识别数据
  useEffect(() => {
    const loadSessionData = async () => {
      try {
        setLoading(true);
        // 加载称重记录
        const weighings = await window.electronAPI.weighings.getBySession(sessionId);
        setSessionWeighings(weighings);
        
        // 加载session信息
        const session = await window.electronAPI.weighingSessions.getById(sessionId);
        setSessionInfo(session);
        
        // 如果有customer_id，加载生物识别数据
        if (session?.customer_id) {
          try {
            const biometric = await window.electronAPI.biometric.getByCustomerId(session.customer_id);
            setBiometricData(biometric);
          } catch (error) {
            console.log('No biometric data found for customer:', error);
            setBiometricData(null);
          }
        } else {
          setBiometricData(null);
        }
      } catch (error) {
        console.error('Failed to load session data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSessionData();
  }, [sessionId]);

  // 加载图片到缓存 - 必须在所有hooks之后，return之前
  useEffect(() => {
    if (loading) return; // 如果还在加载中，不加载图片
    
    const imagePaths: string[] = [];
    
    // 收集需要加载的图片路径
    if (biometricData?.face_image_path) {
      imagePaths.push(biometricData.face_image_path);
    }
    if (biometricData?.fingerprint_image_path) {
      imagePaths.push(biometricData.fingerprint_image_path);
    }
    
    sessionWeighings.forEach(weighing => {
      if (weighing.product_photo_path) {
        imagePaths.push(weighing.product_photo_path);
      }
    });
    
    // 加载所有图片
    imagePaths.forEach(imagePath => {
      // 使用函数式更新检查缓存，避免依赖imageCache
      setImageCache(prev => {
        // 如果已经在缓存中，跳过
        if (prev[imagePath]) return prev;
        
        // 异步加载图片
        (window.electronAPI as any).image.readFile(imagePath)
          .then((dataUrl: string | null) => {
            if (dataUrl) {
              setImageCache(current => {
                if (current[imagePath]) return current; // 避免重复设置
                return { ...current, [imagePath]: dataUrl };
              });
            }
          })
          .catch((error: any) => {
            console.error(`Failed to load image ${imagePath}:`, error);
          });
        
        return prev; // 先返回原值，等异步加载完成后再更新
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricData, sessionWeighings, loading]); // imageCache通过函数式更新访问，不需要在依赖中

  const handleGenerateReport = async () => {
    try {
      setGeneratingReport(true);
      await (window.electronAPI as any).report.generatePoliceReport(sessionId);
      // PDF会在新窗口中自动打开，不需要弹窗提示
    } catch (error: any) {
      console.error('Failed to generate report:', error);
      alert(`生成报告失败: ${error.message || '未知错误'}`);
    } finally {
      setGeneratingReport(false);
    }
  };

  return (
    <div className="record-expanded">
      <div className="expanded-details">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h4 style={{ margin: 0 }}>Session Details</h4>
          <button
            onClick={handleGenerateReport}
            disabled={generatingReport || loading}
            className="generate-report-btn"
            style={{
              padding: '8px 16px',
              backgroundColor: generatingReport ? '#6c757d' : '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: generatingReport ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              transition: 'background-color 0.2s'
            }}
          >
            {generatingReport ? '生成中...' : '生成 Police Report'}
          </button>
        </div>
        
        {/* 生物识别信息部分 */}
        <div className="biometric-section">
          <h5>Biometric Information</h5>
          <div className="biometric-images">
            <div className="biometric-item">
              <label>Customer Photo:</label>
              {biometricData?.face_image_path && imageCache[biometricData.face_image_path] && !imageErrors[biometricData.face_image_path] ? (
                <img 
                  src={imageCache[biometricData.face_image_path]} 
                  alt="Customer Photo" 
                  className="biometric-image"
                  onError={(e) => {
                    setImageErrors(prev => ({ ...prev, [biometricData.face_image_path]: true }));
                  }}
                />
              ) : biometricData?.face_image_path && !imageErrors[biometricData.face_image_path] ? (
                <div className="image-loading">Loading...</div>
              ) : (
                <img 
                  src={DEFAULT_PLACEHOLDER_IMAGE} 
                  alt="No Customer Photo" 
                  className="biometric-image"
                />
              )}
            </div>
            <div className="biometric-item">
              <label>Fingerprint:</label>
              {biometricData?.fingerprint_image_path && imageCache[biometricData.fingerprint_image_path] && !imageErrors[biometricData.fingerprint_image_path] ? (
                <img 
                  src={imageCache[biometricData.fingerprint_image_path]} 
                  alt="Fingerprint" 
                  className="biometric-image"
                  onError={(e) => {
                    setImageErrors(prev => ({ ...prev, [biometricData.fingerprint_image_path]: true }));
                  }}
                />
              ) : biometricData?.fingerprint_image_path && !imageErrors[biometricData.fingerprint_image_path] ? (
                <div className="image-loading">Loading...</div>
              ) : (
                <img 
                  src={DEFAULT_PLACEHOLDER_IMAGE} 
                  alt="No Fingerprint" 
                  className="biometric-image"
                />
              )}
            </div>
          </div>
        </div>

        {/* 商品列表部分 */}
        <div className="session-weighings">
          <h5>Products Sold</h5>
          {sessionWeighings && sessionWeighings.length > 0 ? (
            sessionWeighings.map((weighing, index) => (
            <div key={weighing.id} className="weighing-item">
              <div className="weighing-header">
                <span className="weighing-number">#{index + 1}</span>
                <span className="metal-type">{weighing.waste_type_name}</span>
                <span className="weighing-total">${weighing.total_amount.toFixed(2)}</span>
              </div>
              <div className="weighing-details">
                <div className="detail-row">
                  <span>Weight:</span>
                  <span>{parseFloat(weighing.weight).toFixed(3)} lb</span>
                </div>
                <div className="detail-row">
                  <span>Unit Price:</span>
                  <span>${weighing.unit_price}/lb</span>
                </div>
                <div className="detail-row">
                  <span>Total:</span>
                  <span className="total-amount">${weighing.total_amount.toFixed(2)}</span>
                </div>
                <div className="product-photo-section">
                  <label>Product Photo:</label>
                  {weighing.product_photo_path && imageCache[weighing.product_photo_path] && !imageErrors[weighing.product_photo_path] ? (
                    <img 
                      src={imageCache[weighing.product_photo_path]} 
                      alt={`Product: ${weighing.waste_type_name}`} 
                      className="product-image"
                      onError={(e) => {
                        setImageErrors(prev => ({ ...prev, [weighing.product_photo_path]: true }));
                      }}
                    />
                  ) : weighing.product_photo_path && !imageErrors[weighing.product_photo_path] ? (
                    <div className="image-loading">Loading...</div>
                  ) : (
                    <img 
                      src={DEFAULT_PLACEHOLDER_IMAGE} 
                      alt={`No product photo: ${weighing.waste_type_name}`} 
                      className="product-image"
                    />
                  )}
                </div>
              </div>
            </div>
          ))
          ) : (
            <div className="no-items">No products found in this session.</div>
          )}
        </div>
      </div>
    </div>
  );
};

interface Customer {
  id: number;
  name: string;
  phone?: string;
  address?: string;
  customer_number?: string;
  license_number?: string;
  license_photo_path?: string;
  id_expiration?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
}

interface WasteType {
  id: number;
  name: string;
  unit_price: number;
}

interface Weighing {
  id: number;
  customer_id?: number;
  waste_type_id: number;
  weight: number;
  unit_price: number;
  total_amount: number;
  weighing_time: string;
  notes?: string;
  customer_name?: string;
  waste_type_name?: string;
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentActivation, setCurrentActivation] = useState<any>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  // 客户列表分页和搜索状态
  const [customerPage, setCustomerPage] = useState(1);
  const [customerPageSize] = useState(10);
  const [customerListSearchQuery, setCustomerListSearchQuery] = useState('');
  const [customerPagination, setCustomerPagination] = useState<{
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } | null>(null);
  const [customerListLoading, setCustomerListLoading] = useState(false);
  
  // 客户展开和编辑状态
  const [expandedCustomers, setExpandedCustomers] = useState<Set<number>>(new Set());
  const [editingCustomers, setEditingCustomers] = useState<Set<number>>(new Set());
  const [customerEditData, setCustomerEditData] = useState<{ [key: number]: any }>({});
  const [customerVehiclesData, setCustomerVehiclesData] = useState<{ [key: number]: any[] }>({});
  const [customerLicensePhotos, setCustomerLicensePhotos] = useState<{ [key: number]: string }>({});
  
  // 车辆添加模态框状态
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
  const [addVehicleCustomerId, setAddVehicleCustomerId] = useState<number | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    license_plate: '',
    year: '',
    color: '',
    make: '',
    model: ''
  });
  
  const [metalTypes, setMetalTypes] = useState<any[]>([]);
  const [weighings, setWeighings] = useState<Weighing[]>([]);
  const [unfinishedCount, setUnfinishedCount] = useState<number>(0);

  // 设置摄像头设备枚举监听器
  useEffect(() => {
    const electronAPI = window.electronAPI as any;
    if (!electronAPI || !electronAPI.ipc) {
      console.warn('electronAPI.ipc not available');
      return;
    }
    
    // 监听获取摄像头设备列表的请求
    const handleGetDevices = async () => {
      console.log('收到摄像头设备枚举请求');
      try {
        // 首先请求媒体权限（如果需要）
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        } catch (permError) {
          console.log('媒体权限请求失败，但继续枚举设备:', permError);
          // 权限被拒绝，但仍然可以枚举设备（只是没有label）
        }
        
        // 枚举设备
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameraDevices = devices.filter(device => device.kind === 'videoinput');
        
        console.log('找到摄像头设备:', cameraDevices.length, cameraDevices);
        
        // 将MediaDeviceInfo转换为可序列化的对象
        const serializableDevices = cameraDevices.map(device => ({
          deviceId: device.deviceId,
          kind: device.kind,
          label: device.label,
          groupId: device.groupId
        }));
        
        console.log('发送设备列表到主进程:', serializableDevices);
        
        // 发送设备列表回主进程
        electronAPI.ipc.send('camera:devices', serializableDevices);
      } catch (error) {
        console.error('Failed to enumerate camera devices:', error);
        electronAPI.ipc.send('camera:devices', []);
      }
    };

    // 监听主进程的请求
    electronAPI.ipc.on('camera:get-devices', handleGetDevices);
    console.log('已设置摄像头设备枚举监听器');

    // 清理监听器
    return () => {
      electronAPI.ipc.removeListener('camera:get-devices', handleGetDevices);
    };
  }, []);
  
  // Records筛选和分页状态
  const [recordsFilter, setRecordsFilter] = useState({
    startDate: '',
    endDate: '',
    customerName: '',
    page: 1
  });
  const [recordsData, setRecordsData] = useState<any>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'weighing' | 'customers' | 'records' | 'import'>('weighing');
  
  // 导入功能状态
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    message: string;
  } | null>(null);
  
  // 生物识别功能状态
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const [showFingerprintCapture, setShowFingerprintCapture] = useState(false);
  const [showSignatureCapture, setShowSignatureCapture] = useState(false);
  const [biometricData, setBiometricData] = useState<any>(null);
  const [biometricImageCache, setBiometricImageCache] = useState<{ [key: string]: string }>({});
  const [biometricImageErrors, setBiometricImageErrors] = useState<{ [key: string]: boolean }>({});
  
  // 设置功能状态
  const [showSettings, setShowSettings] = useState(false);
  const [showMetalManagement, setShowMetalManagement] = useState(false);

  // 称重表单状态
  const [weighingForm, setWeighingForm] = useState({
    customer_id: '',
    metal_type_id: '',
    grossWeight: '', // 总重量
    tareWeight: '', // 皮重
    netWeight: '', // 净重（自动计算）
    unitPrice: '', // 单价
    price: '', // 价格（自动计算）
    notes: ''
  });
  const [metalList, setMetalList] = useState<any[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null); // 正在编辑的session ID
  
  // Waste Photo状态（支持多张照片）
  const [showWasteCamera, setShowWasteCamera] = useState(false);
  const [wastePhotos, setWastePhotos] = useState<Array<{ id: number; path: string; preview: string }>>([]);
  
  // 车辆信息状态
  const [customerVehicles, setCustomerVehicles] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  
  // Customer搜索状态
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // 客户表单状态
  const [customerForm, setCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    license_number: '',
    id_expiration: '',
    height: '',
    weight: '',
    hair_color: ''
  });
  
  // 驾照照片状态
  const [licensePhotoPath, setLicensePhotoPath] = useState<string | null>(null);
  const [licensePhotoPreview, setLicensePhotoPreview] = useState<string | null>(null);

  // 检查登录状态
  useEffect(() => {
    checkLoginStatus();
  }, []);

  // 当切换到Records标签时加载数据
  useEffect(() => {
    if (activeTab === 'records' && isLoggedIn) {
      loadRecordsData(1);
    }
  }, [activeTab, isLoggedIn]);


  // 加载数据
  useEffect(() => {
    if (isLoggedIn) {
      loadData();
    }
  }, [isLoggedIn]);

  const checkLoginStatus = async () => {
    try {
      const [user, activation] = await Promise.all([
        window.electronAPI.auth.getCurrentUser(),
        window.electronAPI.auth.getCurrentActivation()
      ]);
      
      if (user && activation) {
        setCurrentUser(user);
        setCurrentActivation(activation);
        setIsLoggedIn(true);
      }
    } catch (error) {
      console.error('检查登录状态失败:', error);
    }
  };

  // 加载unfinished记录数量
  const loadUnfinishedCount = async () => {
    try {
      const count = await window.electronAPI.weighingSessions.getUnfinishedCount();
      setUnfinishedCount(count);
    } catch (error) {
      console.error('Failed to load unfinished count:', error);
    }
  };

  const loadData = async () => {
    try {
      const [customersData, metalTypesData, weighingsData] = await Promise.all([
        window.electronAPI.customers.getAll(),
        window.electronAPI.metalTypes.getAll(),
        window.electronAPI.weighings.getAll()
      ]);
      
      setCustomers(customersData);
      setMetalTypes(metalTypesData);
      setWeighings(weighingsData);
      
      // 加载unfinished数量
      await loadUnfinishedCount();
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  // 加载分页客户列表
  const loadCustomerList = async (page: number = customerPage, searchQuery: string = customerListSearchQuery) => {
    try {
      setCustomerListLoading(true);
      const result = await window.electronAPI.customers.getPaginated({
        page,
        pageSize: customerPageSize,
        searchQuery: searchQuery.trim() || undefined
      });
      
      setCustomers(result.data);
      setCustomerPagination({
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        totalPages: result.totalPages
      });
    } catch (error) {
      console.error('Failed to load customer list:', error);
    } finally {
      setCustomerListLoading(false);
    }
  };

  // Customer搜索逻辑（用于称重页面的快速搜索）
  useEffect(() => {
    const searchCustomers = async () => {
      if (!customerSearchQuery.trim()) {
        setCustomerSearchResults([]);
        return;
      }

      try {
        const results = await window.electronAPI.customers.search(customerSearchQuery);
        setCustomerSearchResults(results);
        setShowCustomerDropdown(true);
      } catch (error) {
        console.error('Failed to search customers:', error);
        setCustomerSearchResults([]);
      }
    };

    // 防抖：延迟300ms执行搜索
    const timeoutId = setTimeout(searchCustomers, 300);
    return () => clearTimeout(timeoutId);
  }, [customerSearchQuery]);

  // 搜索客户列表（防抖）
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (activeTab === 'customers') {
        setCustomerPage(1); // 搜索时重置到第一页
        loadCustomerList(1, customerListSearchQuery);
      }
    }, 300);
    
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerListSearchQuery]);

  // 加载客户车辆信息
  const loadCustomerVehicles = async (customerId: number) => {
    try {
      const vehicles = await window.electronAPI.vehicles.getByCustomerId(customerId);
      setCustomerVehiclesData(prev => ({
        ...prev,
        [customerId]: vehicles || []
      }));
    } catch (error) {
      console.error('Failed to load customer vehicles:', error);
      setCustomerVehiclesData(prev => ({
        ...prev,
        [customerId]: []
      }));
    }
  };

  // 加载客户驾照照片
  const loadCustomerLicensePhoto = async (customerId: number, photoPath: string | null) => {
    if (!photoPath) {
      setCustomerLicensePhotos(prev => ({
        ...prev,
        [customerId]: ''
      }));
      return;
    }
    
    try {
      const imageData = await window.electronAPI.image.readFile(photoPath);
      if (imageData) {
        setCustomerLicensePhotos(prev => ({
          ...prev,
          [customerId]: imageData
        }));
      }
    } catch (error) {
      console.error('Failed to load license photo:', error);
      setCustomerLicensePhotos(prev => ({
        ...prev,
        [customerId]: ''
      }));
    }
  };

  // 上传客户驾照照片
  const handleUploadCustomerLicensePhoto = async (customerId: number) => {
    try {
      const filePath = await window.electronAPI.file.selectImage();
      if (!filePath) {
        return; // 用户取消了选择
      }

      // 读取图片文件并显示预览
      const imageData = await window.electronAPI.image.readFile(filePath);
      if (imageData) {
        // 保存照片路径到数据库
        await window.electronAPI.customers.update(customerId, {
          license_photo_path: filePath
        });
        
        // 更新显示
        setCustomerLicensePhotos(prev => ({
          ...prev,
          [customerId]: imageData
        }));
        
        // 重新加载客户列表以更新数据
        loadCustomerList(customerPage, customerListSearchQuery);
      } else {
        alert('Failed to read image file');
      }
    } catch (error) {
      console.error('上传驾照照片失败:', error);
      alert('Failed to upload license photo');
    }
  };

  // 打开添加车辆模态框
  const handleOpenAddVehicleModal = (customerId: number) => {
    setAddVehicleCustomerId(customerId);
    setVehicleForm({
      license_plate: '',
      year: '',
      color: '',
      make: '',
      model: ''
    });
    setShowAddVehicleModal(true);
  };

  // 添加车辆
  const handleAddVehicle = async () => {
    if (!addVehicleCustomerId) return;
    
    if (!vehicleForm.license_plate.trim()) {
      alert('Please enter license plate');
      return;
    }

    try {
      await window.electronAPI.vehicles.create({
        customer_id: addVehicleCustomerId,
        license_plate: vehicleForm.license_plate.trim(),
        year: vehicleForm.year ? parseInt(vehicleForm.year) : undefined,
        color: vehicleForm.color.trim() || undefined,
        make: vehicleForm.make.trim() || undefined,
        model: vehicleForm.model.trim() || undefined
      });
      
      // 重新加载车辆信息
      await loadCustomerVehicles(addVehicleCustomerId);
      
      // 关闭模态框
      setShowAddVehicleModal(false);
      setAddVehicleCustomerId(null);
      setVehicleForm({
        license_plate: '',
        year: '',
        color: '',
        make: '',
        model: ''
      });
    } catch (error) {
      console.error('Failed to add vehicle:', error);
      alert('Failed to add vehicle');
    }
  };

  // 当切换到Customers标签时加载第一页
  useEffect(() => {
    if (activeTab === 'customers') {
      loadCustomerList(1, customerListSearchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 当切换到Records标签时更新unfinished数量
  useEffect(() => {
    if (activeTab === 'records') {
      loadUnfinishedCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // 加载Records数据（分页）
  const loadRecordsData = async (page = 1) => {
    try {
      setRecordsLoading(true);
      // 同时更新unfinished数量
      await loadUnfinishedCount();
      const options = {
        page,
        limit: 10,
        startDate: recordsFilter.startDate || undefined,
        endDate: recordsFilter.endDate || undefined,
        customerName: recordsFilter.customerName || undefined
      };
      
      const result = await window.electronAPI.weighings.getPaginated(options);
      setRecordsData(result);
      setRecordsFilter(prev => ({ ...prev, page }));
    } catch (error) {
      console.error('Failed to load records data:', error);
    } finally {
      setRecordsLoading(false);
    }
  };

  // 应用筛选
  const applyRecordsFilter = () => {
    setRecordsFilter(prev => ({ ...prev, page: 1 }));
    loadRecordsData(1);
  };

  // 重置筛选
  const resetRecordsFilter = () => {
    setRecordsFilter({
      startDate: '',
      endDate: '',
      customerName: '',
      page: 1
    });
    loadRecordsData(1);
  };

  const handleLoginSuccess = async () => {
    await checkLoginStatus();
  };

  const handleLogout = async () => {
    try {
      await window.electronAPI.auth.logout();
      setIsLoggedIn(false);
      setCurrentUser(null);
      setCurrentActivation(null);
      setCustomers([]);
      setMetalTypes([]);
      setWeighings([]);
    } catch (error) {
      console.error('退出登录失败:', error);
    }
  };

  // 添加金属到清单
  const handleAddToMetalList = () => {
    if (!weighingForm.metal_type_id || !weighingForm.netWeight || parseFloat(weighingForm.netWeight) <= 0) {
      alert('Please fill in metal type and ensure net weight is greater than 0');
      return;
    }

    if (!weighingForm.unitPrice || parseFloat(weighingForm.unitPrice) <= 0) {
      alert('Please fill in unit price');
      return;
    }

    const metalType = metalTypes.find(mt => mt.id === parseInt(weighingForm.metal_type_id));
    if (!metalType) {
      alert('Please select a valid metal type');
      return;
    }

    const netWeight = parseFloat(weighingForm.netWeight);
    const unitPrice = parseFloat(weighingForm.unitPrice);
    const price = parseFloat(weighingForm.price) || netWeight * unitPrice;

    const metalItem = {
      id: Date.now(), // 临时ID
      metal_type_id: parseInt(weighingForm.metal_type_id),
      metal_type_name: metalType.name,
      grossWeight: parseFloat(weighingForm.grossWeight) || 0,
      tareWeight: parseFloat(weighingForm.tareWeight) || 0,
      weight: netWeight, // 使用净重作为weight
      unit_price: unitPrice,
      total_amount: price
    };

    setMetalList([...metalList, metalItem]);
    
    // 重置金属类型、重量和价格相关字段，保留客户和备注
    setWeighingForm({
      ...weighingForm,
      metal_type_id: '',
      grossWeight: '',
      tareWeight: '',
      netWeight: '',
      unitPrice: '',
      price: ''
    });
  };

  // 从清单中删除金属
  const handleRemoveFromMetalList = (id: number) => {
    setMetalList(metalList.filter(item => item.id !== id));
  };

  // 处理Waste Photo捕获
  const handleWastePhotoCaptured = async (imageData: ArrayBuffer) => {
    try {
      const blob = new Blob([imageData], { type: 'image/jpeg' });
      const reader = new FileReader();
      
      reader.onloadend = async () => {
        try {
          const preview = reader.result as string;
          const photoId = Date.now();
          
          // 先立即显示预览（使用临时路径）
          setWastePhotos(prev => {
            const currentCount = prev.length;
            const tempWeighingId = Date.now() + currentCount;
            
            // 异步保存照片
            (async () => {
              try {
                const photoPath = await window.electronAPI.license.savePhoto(tempWeighingId, imageData);
                
                // 更新照片路径
                setWastePhotos(current => current.map(photo => 
                  photo.id === photoId ? { ...photo, path: photoPath } : photo
                ));
              } catch (error) {
                console.error('Failed to save waste photo:', error);
                // 如果保存失败，移除预览
                setWastePhotos(current => current.filter(photo => photo.id !== photoId));
                alert('Failed to save waste photo');
              }
            })();
            
            // 立即返回包含新照片的数组
            return [...prev, {
              id: photoId,
              path: '', // 临时为空，保存完成后更新
              preview: preview
            }];
          });
        } catch (error) {
          console.error('Failed to process waste photo:', error);
          alert('Failed to process waste photo');
        }
      };
      
      reader.readAsDataURL(blob);
      setShowWasteCamera(false);
    } catch (error) {
      console.error('Failed to process waste photo:', error);
      alert('Failed to process waste photo');
    }
  };

  // 删除Waste Photo
  const handleDeleteWastePhoto = (id: number) => {
    setWastePhotos(prev => prev.filter(photo => photo.id !== id));
  };

  // 自动计算净重（总重量 - 皮重）
  useEffect(() => {
    const gross = parseFloat(weighingForm.grossWeight) || 0;
    const tare = parseFloat(weighingForm.tareWeight) || 0;
    const net = gross - tare;
    
    if (gross > 0 || tare > 0) {
      setWeighingForm(prev => ({
        ...prev,
        netWeight: net > 0 ? net.toFixed(3) : ''
      }));
    } else {
      setWeighingForm(prev => ({
        ...prev,
        netWeight: ''
      }));
    }
  }, [weighingForm.grossWeight, weighingForm.tareWeight]);

  // 自动计算价格（净重 × 单价）
  useEffect(() => {
    const net = parseFloat(weighingForm.netWeight) || 0;
    const unitPrice = parseFloat(weighingForm.unitPrice) || 0;
    const price = net * unitPrice;
    
    if (net > 0 && unitPrice > 0) {
      setWeighingForm(prev => ({
        ...prev,
        price: price.toFixed(2)
      }));
    } else {
      setWeighingForm(prev => ({
        ...prev,
        price: ''
      }));
    }
  }, [weighingForm.netWeight, weighingForm.unitPrice]);

  // 选择Metal Type后自动填充Unit Price
  useEffect(() => {
    if (weighingForm.metal_type_id) {
      const metalType = metalTypes.find(mt => mt.id === parseInt(weighingForm.metal_type_id));
      if (metalType) {
        setWeighingForm(prev => ({
          ...prev,
          unitPrice: metalType.price_per_unit.toString()
        }));
      }
    }
  }, [weighingForm.metal_type_id, metalTypes]);

  // 处理Customer选择变化
  useEffect(() => {
    const loadCustomerData = async () => {
      if (weighingForm.customer_id) {
        const customerId = parseInt(weighingForm.customer_id);
        // 先从搜索结果中查找，如果找不到再从customers列表中查找
        let customer = customerSearchResults.find(c => c.id === customerId);
        if (!customer) {
          customer = customers.find(c => c.id === customerId);
        }
        // 如果还是找不到，从数据库获取
        if (!customer) {
          try {
            customer = await window.electronAPI.customers.getById(customerId);
          } catch (error) {
            console.error('Failed to load customer:', error);
          }
        }
        setSelectedCustomer(customer || null);
        
        try {
          const vehicles = await window.electronAPI.vehicles.getByCustomerId(customerId);
          setCustomerVehicles(vehicles || []);
        } catch (error) {
          console.error('Failed to load customer vehicles:', error);
          setCustomerVehicles([]);
        }
        
        // 不加载之前的生物识别数据，每次都需要重新采集
        // 清空biometric数据，让用户重新采集
        setBiometricData(null);
        setBiometricImageCache({});
        setBiometricImageErrors({});
      } else {
        setSelectedCustomer(null);
        setCustomerVehicles([]);
        setBiometricData(null);
        // 不清空搜索查询，让用户保留搜索历史
      }
    };
    
    loadCustomerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weighingForm.customer_id]);

  // 处理称重保存
  const handleWeighing = async () => {
    if (metalList.length === 0) {
      alert('Please add at least one metal item to the list');
      return;
    }

    // 检查是否选择了客户
    if (!weighingForm.customer_id) {
      alert('Please select a customer before submitting');
      return;
    }

    // 检查biometric数据是否完整
    let isBiometricComplete = false;
    if (biometricData) {
      const hasFace = !!biometricData.face_image_path;
      const hasFingerprint = !!biometricData.fingerprint_image_path;
      const hasSignature = !!biometricData.signature_image_path;
      isBiometricComplete = hasFace && hasFingerprint && hasSignature;
    }

    const status = isBiometricComplete ? 'completed' : 'unfinished';

    try {
      let sessionId: number;
      
      // 如果是继续编辑现有session，更新它；否则创建新的
      if (editingSessionId) {
        sessionId = editingSessionId;
        // 更新session的notes和status
        await window.electronAPI.weighingSessions.update(sessionId, {
          notes: weighingForm.notes,
          status: status
        });
        // 删除该session的所有现有weighings，然后重新添加
        await window.electronAPI.weighings.deleteBySession(sessionId);
      } else {
        // 创建新的称重会话
        const sessionResult = await window.electronAPI.weighingSessions.create({
          customer_id: parseInt(weighingForm.customer_id),
          notes: weighingForm.notes,
          status: status
        });
        sessionId = sessionResult.lastInsertRowid;
      }

      // 计算总金额
      let totalAmount = 0;

      // 为每个金属创建称重记录
      for (let i = 0; i < metalList.length; i++) {
        const metalItem = metalList[i];
        // 如果是第一个item且有waste photos，关联第一张已保存的照片
        const savedPhotos = wastePhotos.filter(photo => photo.path); // 只使用已保存的照片
        const productPhotoPath = (i === 0 && savedPhotos.length > 0) ? savedPhotos[0].path : null;
        
        await window.electronAPI.weighings.create({
          session_id: sessionId,
          waste_type_id: metalItem.metal_type_id,
          weight: metalItem.weight,
          unit_price: metalItem.unit_price,
          total_amount: metalItem.total_amount,
          product_photo_path: productPhotoPath
        });
        totalAmount += metalItem.total_amount;
      }

      // 更新会话总金额
      await window.electronAPI.weighingSessions.updateTotal(sessionId, totalAmount);
      
      // 重置表单和清单
      setWeighingForm({
        customer_id: '',
        metal_type_id: '',
        grossWeight: '',
        tareWeight: '',
        netWeight: '',
        unitPrice: '',
        price: '',
        notes: ''
      });
      setMetalList([]);
      setWastePhotos([]);
      setSelectedCustomer(null);
      setCustomerVehicles([]);
      setCustomerSearchQuery('');
      setEditingSessionId(null); // 清除编辑状态
      
      // 重新加载数据
      loadData();
      // 更新unfinished数量
      await loadUnfinishedCount();
      alert(`Successfully saved weighing session with ${metalList.length} metal item(s)!`);
    } catch (error) {
      console.error('Failed to save weighing session:', error);
      alert('Failed to save weighing session, please try again');
    }
  };

  // 添加客户
  const handleAddCustomer = async () => {
    if (!customerForm.name) {
      alert('Please enter customer name');
      return;
    }

    try {
      // 直接使用临时照片路径（如果存在）
      // 临时照片已经保存到文件系统，只需要将路径保存到数据库
      const customerData = {
        ...customerForm,
        license_photo_path: licensePhotoPath || null
      };
      
      await window.electronAPI.customers.create(customerData);
      
      setCustomerForm({ 
        name: '', 
        phone: '', 
        address: '', 
        license_number: '',
        id_expiration: '',
        height: '',
        weight: '',
        hair_color: ''
      });
      setLicensePhotoPath(null);
      setLicensePhotoPreview(null);
      loadData();
      // 重新加载客户列表（保持当前页和搜索条件）
      loadCustomerList(customerPage, customerListSearchQuery);
      alert('Customer added successfully!');
    } catch (error) {
      console.error('Failed to add customer:', error);
      alert('Failed to add customer, please try again');
    }
  };

  // 处理驾照照片上传
  const handleUploadLicensePhoto = async () => {
    try {
      // 打开文件选择对话框
      const filePath = await window.electronAPI.file.selectImage();
      if (!filePath) {
        return; // 用户取消了选择
      }

      // 读取图片文件并显示预览
      const imageData = await window.electronAPI.image.readFile(filePath);
      if (imageData) {
        setLicensePhotoPreview(imageData);
        setLicensePhotoPath(filePath);
      } else {
        alert('Failed to read image file');
      }
    } catch (error) {
      console.error('上传驾照照片失败:', error);
      alert('Failed to upload license photo');
    }
  };

  // 导入客户数据
  const handleImportCustomers = async () => {
    try {
      setIsImporting(true);
      setImportResult(null);
      setImportProgress({ current: 0, total: 0, percent: 0, message: 'Preparing to import...' });
      
      const filePath = await window.electronAPI.import.selectFile();
      if (!filePath) {
        setIsImporting(false);
        setImportProgress(null);
        return;
      }

      // 设置进度监听
      window.electronAPI.import.onProgress((progress) => {
        setImportProgress(progress);
      });

      const result = await window.electronAPI.import.importCustomers(filePath);
      
      // 移除进度监听
      window.electronAPI.import.removeProgressListener();
      
      setImportResult(result);
      
      // 显示完成消息
      setImportProgress({
        current: result.importedCustomers,
        total: result.importedCustomers,
        percent: 100,
        message: result.success ? `Successfully imported ${result.importedCustomers} customers` : 'Import failed'
      });
      
      if (result.success) {
        // 重新加载数据
        loadData();
        // 2秒后关闭进度窗口
        setTimeout(() => {
          setImportProgress(null);
        }, 2000);
      }
    } catch (error) {
      console.error('导入客户数据失败:', error);
      setImportResult({
        success: false,
        message: `导入失败: ${error}`,
        importedCustomers: 0,
        importedVehicles: 0,
        errors: [String(error)]
      });
      setImportProgress(null);
      window.electronAPI.import.removeProgressListener();
    } finally {
      setIsImporting(false);
    }
  };

  // 导入车辆数据
  const handleImportVehicles = async () => {
    try {
      setIsImporting(true);
      setImportResult(null);
      setImportProgress({ current: 0, total: 0, percent: 0, message: 'Preparing to import...' });
      
      const filePath = await window.electronAPI.import.selectFile();
      if (!filePath) {
        setIsImporting(false);
        setImportProgress(null);
        return;
      }

      // 设置进度监听
      window.electronAPI.import.onProgress((progress) => {
        setImportProgress(progress);
      });

      const result = await window.electronAPI.import.importVehicles(filePath);
      
      // 移除进度监听
      window.electronAPI.import.removeProgressListener();
      
      setImportResult(result);
      
      // 显示完成消息
      setImportProgress({
        current: result.importedVehicles,
        total: result.importedVehicles,
        percent: 100,
        message: result.success ? `Successfully imported ${result.importedVehicles} vehicles` : 'Import failed'
      });
      
      if (result.success) {
        // 重新加载数据
        loadData();
        // 2秒后关闭进度窗口
        setTimeout(() => {
          setImportProgress(null);
        }, 2000);
      }
    } catch (error) {
      console.error('导入车辆数据失败:', error);
      setImportResult({
        success: false,
        message: `导入失败: ${error}`,
        importedCustomers: 0,
        importedVehicles: 0,
        errors: [String(error)]
      });
      setImportProgress(null);
      window.electronAPI.import.removeProgressListener();
    } finally {
      setIsImporting(false);
    }
  };

  // 生物识别功能
  const handleCaptureFace = () => {
    setShowCameraCapture(true);
  };

  const handleCaptureFingerprint = () => {
    setShowFingerprintCapture(true);
  };

  const handleCaptureSignature = () => {
    setShowSignatureCapture(true);
  };

  const handleFaceCaptured = async (imageData: ArrayBuffer) => {
    if (weighingForm.customer_id) {
      try {
        await window.electronAPI.biometric.saveFaceImage(
          parseInt(weighingForm.customer_id), 
          imageData
        );
        loadBiometricData();
      } catch (error) {
        console.error('保存面部照片失败:', error);
        alert('保存面部照片失败');
      }
    }
  };

  const handleFingerprintCaptured = async (template: ArrayBuffer, imageData?: ArrayBuffer) => {
    if (weighingForm.customer_id) {
      try {
        await window.electronAPI.biometric.saveFingerprint(
          parseInt(weighingForm.customer_id), 
          template, 
          imageData
        );
        loadBiometricData();
      } catch (error) {
        console.error('保存指纹数据失败:', error);
        alert('保存指纹数据失败');
      }
    }
  };

  const handleSignatureCaptured = async (imageData: ArrayBuffer) => {
    if (weighingForm.customer_id) {
      try {
        // 保存签名图片到文件系统（使用专门的签名保存方法）
        const signaturePath = await window.electronAPI.biometric.saveSignatureImage(
          parseInt(weighingForm.customer_id),
          imageData
        );
        console.log('Signature saved to:', signaturePath);
        loadBiometricData();
      } catch (error) {
        console.error('Failed to save signature:', error);
        alert('Failed to save signature: ' + error);
      }
    }
  };

  const loadBiometricData = async () => {
    if (weighingForm.customer_id) {
      try {
        const data = await window.electronAPI.biometric.getByCustomerId(
          parseInt(weighingForm.customer_id)
        );
        setBiometricData(data);
        
        // Load biometric images
        const imagePaths: string[] = [];
        if (data?.face_image_path) imagePaths.push(data.face_image_path);
        if (data?.fingerprint_image_path) imagePaths.push(data.fingerprint_image_path);
        if (data?.signature_image_path) imagePaths.push(data.signature_image_path);
        
        // Asynchronously load all images
        const loadPromises = imagePaths.map(async (path) => {
          if (!biometricImageCache[path] && !biometricImageErrors[path]) {
            try {
              const imageData = await window.electronAPI.image.readFile(path);
              if (imageData) {
                setBiometricImageCache(prev => ({ ...prev, [path]: imageData }));
              } else {
                setBiometricImageErrors(prev => ({ ...prev, [path]: true }));
              }
            } catch (error) {
              console.error(`Failed to load image ${path}:`, error);
              setBiometricImageErrors(prev => ({ ...prev, [path]: true }));
            }
          }
        });
        
        // Wait for all images to load
        await Promise.all(loadPromises);
      } catch (error) {
        console.error('Failed to load biometric data:', error);
      }
    }
  };

  // 如果未登录，显示登录界面
  if (!isLoggedIn) {
    return <LoginForm onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Waste Recycling Scale System</h1>
          <div className="user-info">
            <span>Welcome, {currentUser?.username} - {currentActivation?.company_name}</span>
          </div>
        </div>
        <div className="header-right">
          <button 
            onClick={() => setShowSettings(true)} 
            className="settings-btn"
            title="Settings"
          >
            ⚙️
          </button>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
        <nav className="nav">
          <button 
            className={activeTab === 'weighing' ? 'active' : ''}
            onClick={() => setActiveTab('weighing')}
          >
            Weighing
          </button>
          <button 
            className={activeTab === 'customers' ? 'active' : ''}
            onClick={() => setActiveTab('customers')}
          >
            Customer Management
          </button>
          <button 
            className={activeTab === 'records' ? 'active' : ''}
            onClick={() => setActiveTab('records')}
            style={{ position: 'relative' }}
          >
            Records
            {unfinishedCount > 0 && (
              <span style={{
                position: 'absolute',
                top: '-5px',
                right: '-5px',
                backgroundColor: 'red',
                color: 'white',
                borderRadius: '50%',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                minWidth: '20px',
                padding: '0 2px'
              }}>
                {unfinishedCount > 99 ? '99+' : unfinishedCount}
              </span>
            )}
          </button>
          <button 
            className={activeTab === 'import' ? 'active' : ''}
            onClick={() => setActiveTab('import')}
          >
            Import Data
          </button>
          <button 
            onClick={() => setShowMetalManagement(true)}
            className="metal-management-btn"
            title="Metal Type Management"
          >
            🔧 Metal Types
          </button>
        </nav>
      </header>

      <main className="main">
        {activeTab === 'weighing' && (
          <div className="weighing-section" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
            {/* 左侧：称重部分 */}
            <div style={{ flex: 1, minWidth: '400px' }}>
              <h2>Weighing</h2>
              
              <div className="form-group">
                <label>Metal Type:</label>
                <select 
                  value={weighingForm.metal_type_id}
                  onChange={(e) => setWeighingForm({...weighingForm, metal_type_id: e.target.value})}
                  required
                >
                  <option value="">Select Metal Type</option>
                  {metalTypes.map(metalType => (
                    <option key={metalType.id} value={metalType.id}>
                      {metalType.symbol} - {metalType.name} - ${metalType.price_per_unit}/{metalType.unit}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Gross Weight:</label>
                <input 
                  type="number" 
                  step="0.001"
                  value={weighingForm.grossWeight}
                  onChange={(e) => setWeighingForm({...weighingForm, grossWeight: e.target.value})}
                  placeholder="Enter gross weight"
                  required
                />
              </div>

              <div className="form-group">
                <label>Tare Weight:</label>
                <input 
                  type="number" 
                  step="0.001"
                  value={weighingForm.tareWeight}
                  onChange={(e) => setWeighingForm({...weighingForm, tareWeight: e.target.value})}
                  placeholder="Enter tare weight"
                  required
                />
              </div>

              <div className="form-group">
                <label>Net Weight:</label>
                <input 
                  type="number" 
                  step="0.001"
                  value={weighingForm.netWeight}
                  placeholder="Auto calculated (Gross - Tare)"
                  readOnly
                  disabled
                  style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
                />
              </div>

              <div className="form-group">
                <label>Unit Price:</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={weighingForm.unitPrice}
                  onChange={(e) => setWeighingForm({...weighingForm, unitPrice: e.target.value})}
                  placeholder="Enter unit price"
                  required
                />
              </div>

              <div className="form-group">
                <label>Price:</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={weighingForm.price}
                  placeholder="Auto calculated (Net Weight × Unit Price)"
                  readOnly
                  disabled
                  style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
                />
              </div>

              <div className="form-group">
                <label>Notes:</label>
                <textarea 
                  value={weighingForm.notes}
                  onChange={(e) => setWeighingForm({...weighingForm, notes: e.target.value})}
                  placeholder="Notes"
                  rows={3}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                />
              </div>

              <div className="form-group">
                <label>Capture Waste Photo:</label>
                <button 
                  onClick={() => setShowWasteCamera(true)} 
                  className="btn-secondary"
                  type="button"
                  style={{ width: '100%' }}
                >
                  📷 {wastePhotos.length > 0 ? 'Take Another Photo' : 'Take Photo'}
                </button>
                {wastePhotos.length > 0 && (
                  <div style={{ 
                    marginTop: '10px', 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: '10px',
                    maxWidth: '100%'
                  }}>
                    {wastePhotos.map((photo) => {
                      // 根据照片数量动态调整缩略图大小
                      const photoCount = wastePhotos.length;
                      let thumbnailSize = '150px';
                      if (photoCount > 6) {
                        thumbnailSize = '100px';
                      } else if (photoCount > 4) {
                        thumbnailSize = '120px';
                      } else if (photoCount > 2) {
                        thumbnailSize = '140px';
                      }
                      
                      return (
                        <div 
                          key={photo.id} 
                          style={{ 
                            position: 'relative',
                            width: thumbnailSize,
                            height: thumbnailSize,
                            flexShrink: 0
                          }}
                        >
                          <img 
                            src={photo.preview} 
                            alt="Waste Photo Preview" 
                            style={{ 
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              borderRadius: '4px',
                              border: '1px solid #ddd'
                            }}
                          />
                          <button
                            onClick={() => handleDeleteWastePhoto(photo.id)}
                            style={{
                              position: 'absolute',
                              top: '4px',
                              right: '4px',
                              width: '24px',
                              height: '24px',
                              borderRadius: '50%',
                              backgroundColor: 'rgba(255, 0, 0, 0.8)',
                              color: 'white',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '14px',
                              fontWeight: 'bold',
                              lineHeight: '1',
                              padding: 0,
                              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                            }}
                            title="删除照片"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 添加到清单按钮 */}
              <div className="form-group">
                <button 
                  onClick={handleAddToMetalList} 
                  className="btn-secondary"
                  type="button"
                  style={{ width: '100%' }}
                >
                  Add to Metal List
                </button>
              </div>

              {/* 金属清单显示 */}
              {metalList.length > 0 && (
                <div className="metal-list-section" style={{ marginTop: '20px' }}>
                  <h3>Metal List ({metalList.length} items)</h3>
                  <div className="metal-list">
                    {metalList.map((item, index) => (
                      <div key={item.id} className="metal-list-item">
                        <div className="metal-item-info">
                          <span className="metal-type">{item.metal_type_name}</span>
                          <span className="metal-weight">{item.weight.toFixed(3)} lb</span>
                          <span className="metal-price">${item.unit_price}/lb</span>
                          <span className="metal-total">${item.total_amount.toFixed(2)}</span>
                        </div>
                        <button 
                          onClick={() => handleRemoveFromMetalList(item.id)}
                          className="remove-btn"
                          type="button"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="metal-list-total">
                    <strong>Total Amount: ${metalList.reduce((sum, item) => sum + item.total_amount, 0).toFixed(2)}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* 右侧：Customer部分 */}
            <div style={{ flex: 1, minWidth: '400px' }}>
              <h2>Customer</h2>
              
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Customer:</label>
                
                {/* 搜索输入框 */}
                <input
                  type="text"
                  value={customerSearchQuery}
                  onChange={(e) => {
                    setCustomerSearchQuery(e.target.value);
                    setShowCustomerDropdown(true);
                  }}
                  onFocus={() => {
                    if (customerSearchQuery.trim()) {
                      setShowCustomerDropdown(true);
                    }
                  }}
                  onBlur={() => {
                    // 延迟关闭，允许点击下拉项
                    setTimeout(() => setShowCustomerDropdown(false), 200);
                  }}
                  placeholder="Quick search by number or name..."
                  style={{ 
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #ddd',
                    backgroundColor: 'white',
                    cursor: 'text',
                    fontSize: '14px',
                    marginBottom: '8px'
                  }}
                />
                
                {/* 搜索结果下拉列表 */}
                {showCustomerDropdown && customerSearchResults.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    marginTop: '4px'
                  }}>
                    {customerSearchResults.map(customer => (
                      <div
                        key={customer.id}
                        onClick={() => {
                          setWeighingForm({...weighingForm, customer_id: customer.id.toString()});
                          setCustomerSearchQuery('');
                          setShowCustomerDropdown(false);
                        }}
                        style={{
                          padding: '10px 12px',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f0f0f0',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#f5f5f5';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'white';
                        }}
                      >
                        <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                          {customer.customer_number ? `[${customer.customer_number}] ` : ''}{customer.name}
                        </div>
                        {customer.phone && (
                          <div style={{ fontSize: '12px', color: '#666' }}>
                            Phone: {customer.phone}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {showCustomerDropdown && customerSearchQuery.trim() && customerSearchResults.length === 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    padding: '10px 12px',
                    zIndex: 1000,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    marginTop: '4px',
                    color: '#666',
                    fontSize: '14px'
                  }}>
                    No customers found
                  </div>
                )}
                
                {/* 原来的下拉选择框 */}
                <select 
                  value={weighingForm.customer_id}
                  onChange={(e) => {
                    setWeighingForm({...weighingForm, customer_id: e.target.value});
                    setCustomerSearchQuery('');
                  }}
                  style={{ 
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    border: '1px solid #ddd',
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    fontSize: '14px'
                  }}
                >
                  <option value="">Select Customer</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.customer_number ? `[${customer.customer_number}] ` : ''}{customer.name} {customer.phone && `(${customer.phone})`}
                    </option>
                  ))}
                </select>
              </div>

              {/* 显示Customer信息 */}
              {selectedCustomer && (
                <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                  <h3 style={{ marginTop: 0 }}>Customer Information</h3>
                  {selectedCustomer.customer_number && (
                    <div style={{ marginBottom: '10px' }}>
                      <strong>Customer Number:</strong> {selectedCustomer.customer_number}
                    </div>
                  )}
                  <div style={{ marginBottom: '10px' }}>
                    <strong>Name:</strong> {selectedCustomer.name}
                  </div>
                  {selectedCustomer.phone && (
                    <div style={{ marginBottom: '10px' }}>
                      <strong>Phone:</strong> {selectedCustomer.phone}
                    </div>
                  )}
                  {selectedCustomer.address && (
                    <div style={{ marginBottom: '10px' }}>
                      <strong>Address:</strong> {selectedCustomer.address}
                    </div>
                  )}
                  {selectedCustomer.license_number && (
                    <div style={{ marginBottom: '10px' }}>
                      <strong>License Number:</strong> {selectedCustomer.license_number}
                    </div>
                  )}
                </div>
              )}

              {/* 显示车辆信息 */}
              {customerVehicles.length > 0 && (
                <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
                  <h3 style={{ marginTop: 0 }}>Vehicle Information</h3>
                  {customerVehicles.map((vehicle, index) => (
                    <div key={vehicle.id || index} style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: index < customerVehicles.length - 1 ? '1px solid #ddd' : 'none' }}>
                      {vehicle.license_plate && (
                        <div style={{ marginBottom: '5px' }}>
                          <strong>License Plate:</strong> {vehicle.license_plate}
                        </div>
                      )}
                      {vehicle.make && vehicle.model && (
                        <div style={{ marginBottom: '5px' }}>
                          <strong>Make/Model:</strong> {vehicle.make} {vehicle.model}
                        </div>
                      )}
                      {vehicle.year && (
                        <div style={{ marginBottom: '5px' }}>
                          <strong>Year:</strong> {vehicle.year}
                        </div>
                      )}
                      {vehicle.color && (
                        <div style={{ marginBottom: '5px' }}>
                          <strong>Color:</strong> {vehicle.color}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Biometric Collection Area */}
              {weighingForm.customer_id && (
                <div className="biometric-section" style={{ marginTop: '20px' }}>
                  <h3>Biometric Collection</h3>
                  <div className="biometric-controls">
                    <button 
                      onClick={handleCaptureFace} 
                      className="biometric-btn camera-btn"
                      disabled={!weighingForm.customer_id}
                    >
                      📷 {biometricData?.face_image_path ? 'Retake Face Photo' : 'Capture Face Photo'}
                    </button>
                    <button 
                      onClick={handleCaptureFingerprint} 
                      className="biometric-btn fingerprint-btn"
                      disabled={!weighingForm.customer_id}
                    >
                      👆 {biometricData?.fingerprint_image_path ? 'Retake Fingerprint' : 'Capture Fingerprint'}
                    </button>
                    <button 
                      onClick={handleCaptureSignature} 
                      className="biometric-btn signature-btn"
                      disabled={!weighingForm.customer_id}
                    >
                      ✍️ {biometricData?.signature_image_path ? 'Retake Signature' : 'Capture Signature'}
                    </button>
                  </div>
                  
                  <div className="biometric-status">
                    <div className="biometric-info-grid">
                      {/* Photos Column */}
                      <div className="biometric-column">
                        <h4 className="biometric-column-title">Photos</h4>
                        <div className="biometric-image-container">
                          {biometricData?.face_image_path && 
                           biometricImageCache[biometricData.face_image_path] && 
                           !biometricImageErrors[biometricData.face_image_path] ? (
                            <img 
                              src={biometricImageCache[biometricData.face_image_path]} 
                              alt="Face Photo" 
                              className="biometric-preview-image"
                              onError={(e) => {
                                setBiometricImageErrors(prev => ({ ...prev, [biometricData.face_image_path]: true }));
                              }}
                            />
                          ) : biometricData?.face_image_path && !biometricImageErrors[biometricData.face_image_path] ? (
                            <div className="image-loading">Loading...</div>
                          ) : (
                            <img 
                              src={DEFAULT_PLACEHOLDER_IMAGE} 
                              alt="No Face Photo" 
                              className="biometric-preview-image"
                            />
                          )}
                        </div>
                      </div>
                      
                      {/* Fingerprints Column */}
                      <div className="biometric-column">
                        <h4 className="biometric-column-title">Fingerprints</h4>
                        <div className="biometric-image-container">
                          {biometricData?.fingerprint_image_path && 
                           biometricImageCache[biometricData.fingerprint_image_path] && 
                           !biometricImageErrors[biometricData.fingerprint_image_path] ? (
                            <img 
                              src={biometricImageCache[biometricData.fingerprint_image_path]} 
                              alt="Fingerprint" 
                              className="biometric-preview-image"
                              onError={(e) => {
                                setBiometricImageErrors(prev => ({ ...prev, [biometricData.fingerprint_image_path]: true }));
                              }}
                            />
                          ) : biometricData?.fingerprint_image_path && !biometricImageErrors[biometricData.fingerprint_image_path] ? (
                            <div className="image-loading">Loading...</div>
                          ) : (
                            <img 
                              src={DEFAULT_PLACEHOLDER_IMAGE} 
                              alt="No Fingerprint" 
                              className="biometric-preview-image"
                            />
                          )}
                        </div>
                      </div>
                      
                      {/* Signatures Column */}
                      <div className="biometric-column">
                        <h4 className="biometric-column-title">Signatures</h4>
                        <div className="biometric-image-container">
                          {biometricData?.signature_image_path && 
                           biometricImageCache[biometricData.signature_image_path] && 
                           !biometricImageErrors[biometricData.signature_image_path] ? (
                            <img 
                              src={biometricImageCache[biometricData.signature_image_path]} 
                              alt="Signature" 
                              className="biometric-preview-image"
                              onError={(e) => {
                                setBiometricImageErrors(prev => ({ ...prev, [biometricData.signature_image_path]: true }));
                              }}
                            />
                          ) : (
                            <img 
                              src={DEFAULT_PLACEHOLDER_IMAGE} 
                              alt="No Signature" 
                              className="biometric-preview-image"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Submit按钮 - 放在底部 */}
        {activeTab === 'weighing' && (
          <div style={{ marginTop: '20px', textAlign: 'center', padding: '20px', borderTop: '1px solid #ddd' }}>
            <button 
              onClick={handleWeighing} 
              className="btn-primary"
              disabled={metalList.length === 0}
              style={{ fontSize: '18px', padding: '12px 40px' }}
            >
              Submit
            </button>
          </div>
        )}

        {activeTab === 'customers' && (
          <div className="customers-section">
            <h2>Customer Management</h2>
            <div className="form-group">
              <label>Customer Name:</label>
              <input 
                type="text"
                value={customerForm.name}
                onChange={(e) => setCustomerForm({...customerForm, name: e.target.value})}
                placeholder="Enter customer name"
                required
              />
            </div>

            <div className="form-group">
              <label>Phone Number:</label>
              <input 
                type="text"
                value={customerForm.phone}
                onChange={(e) => setCustomerForm({...customerForm, phone: e.target.value})}
                placeholder="Enter phone number"
              />
            </div>

            <div className="form-group">
              <label>Address:</label>
              <input 
                type="text"
                value={customerForm.address}
                onChange={(e) => setCustomerForm({...customerForm, address: e.target.value})}
                placeholder="Enter address"
              />
            </div>

            <div className="form-group">
              <label>Driver License Number:</label>
              <input 
                type="text"
                value={customerForm.license_number}
                onChange={(e) => setCustomerForm({...customerForm, license_number: e.target.value})}
                placeholder="Enter driver license number"
              />
            </div>

            <div className="form-group">
              <label>ID Expiration:</label>
              <input 
                type="text"
                value={customerForm.id_expiration}
                onChange={(e) => setCustomerForm({...customerForm, id_expiration: e.target.value})}
                placeholder="Enter ID expiration date"
              />
            </div>

            <div className="form-group">
              <label>Height:</label>
              <input 
                type="text"
                value={customerForm.height}
                onChange={(e) => setCustomerForm({...customerForm, height: e.target.value})}
                placeholder="Enter height (e.g., 5' 10&quot;)"
              />
            </div>

            <div className="form-group">
              <label>Weight:</label>
              <input 
                type="text"
                value={customerForm.weight}
                onChange={(e) => setCustomerForm({...customerForm, weight: e.target.value})}
                placeholder="Enter weight"
              />
            </div>

            <div className="form-group">
              <label>Hair Color:</label>
              <input 
                type="text"
                value={customerForm.hair_color}
                onChange={(e) => setCustomerForm({...customerForm, hair_color: e.target.value})}
                placeholder="Enter hair color"
              />
            </div>

            {/* 驾照照片上传区域 */}
            <div className="license-photo-section">
              <h3>Driver License Photo</h3>
              <div className="license-photo-controls">
                <button 
                  onClick={handleUploadLicensePhoto} 
                  className="license-camera-btn"
                >
                  📤 Upload Driver License
                </button>
                {licensePhotoPath && licensePhotoPreview && (
                  <div className="license-photo-preview">
                    <img 
                      src={licensePhotoPreview} 
                      alt="License photo preview" 
                      className="license-photo-thumbnail"
                    />
                    <button 
                      onClick={() => {
                        setLicensePhotoPath(null);
                        setLicensePhotoPreview(null);
                      }}
                      className="remove-photo-btn"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>

            <button onClick={handleAddCustomer} className="btn-primary">
              Add Customer
            </button>

            <div className="customers-list">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ margin: 0 }}>Customer List</h3>
                {customerPagination && (
                  <div style={{ color: '#666', fontSize: '14px' }}>
                    Total: {customerPagination.total} customers
                  </div>
                )}
              </div>

              {/* 搜索框 */}
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  value={customerListSearchQuery}
                  onChange={(e) => setCustomerListSearchQuery(e.target.value)}
                  placeholder="Search by RefNo, name, or address..."
                  style={{
                    width: '100%',
                    padding: '10px 15px',
                    borderRadius: '6px',
                    border: '2px solid #ddd',
                    fontSize: '14px',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#667eea';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#ddd';
                  }}
                />
              </div>

              {/* 客户列表 */}
              {customerListLoading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                  Loading customers...
                </div>
              ) : customers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                  {customerListSearchQuery ? 'No customers found' : 'No customers yet'}
                </div>
              ) : (
                <>
                  {customers.map(customer => {
                    const isExpanded = expandedCustomers.has(customer.id);
                    const isEditing = editingCustomers.has(customer.id);
                    const editData = customerEditData[customer.id] || {};
                    const vehicles = customerVehiclesData[customer.id] || [];
                    
                    return (
                      <div key={customer.id} className="customer-item" style={{ cursor: 'pointer' }}>
                        {/* 客户基本信息（可点击展开） */}
                        <div 
                          onClick={() => {
                            if (!isExpanded) {
                              // 展开时加载详细信息
                              setExpandedCustomers(prev => new Set(prev).add(customer.id));
                              // 加载车辆信息
                              loadCustomerVehicles(customer.id);
                              // 加载驾照照片
                              loadCustomerLicensePhoto(customer.id, customer.license_photo_path || null);
                            } else {
                              // 折叠
                              setExpandedCustomers(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(customer.id);
                                return newSet;
                              });
                              // 取消编辑状态
                              setEditingCustomers(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(customer.id);
                                return newSet;
                              });
                            }
                          }}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <div style={{ flex: 1 }}>
                            {customer.customer_number && (
                              <span style={{ fontWeight: 'bold', color: '#667eea', marginRight: '8px' }}>
                                [{customer.customer_number}]
                              </span>
                            )}
                            <strong>{customer.name}</strong>
                            {customer.phone && <span> - {customer.phone}</span>}
                            {customer.address && <div className="address">{customer.address}</div>}
                          </div>
                          <div style={{ fontSize: '18px', color: '#667eea', marginLeft: '10px' }}>
                            {isExpanded ? '▼' : '▶'}
                          </div>
                        </div>

                        {/* 展开的详细信息 */}
                        {isExpanded && (
                          <div style={{ 
                            marginTop: '15px', 
                            padding: '15px', 
                            backgroundColor: '#f9f9f9', 
                            borderRadius: '6px',
                            border: '1px solid #e0e0e0'
                          }} onClick={(e) => e.stopPropagation()}>
                            {/* 客户详细信息 */}
                            <div style={{ marginBottom: '20px' }}>
                              <h4 style={{ marginTop: 0, marginBottom: '15px', color: '#333' }}>Customer Information</h4>
                              
                              {/* Customer Number */}
                              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <strong style={{ minWidth: '140px' }}>Customer Number:</strong>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editData.customer_number !== undefined ? editData.customer_number : (customer.customer_number || '')}
                                    onChange={(e) => {
                                      setCustomerEditData(prev => ({
                                        ...prev,
                                        [customer.id]: { ...prev[customer.id], customer_number: e.target.value }
                                      }));
                                    }}
                                    style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: '4px' }}
                                  />
                                ) : (
                                  <span onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCustomers(prev => new Set(prev).add(customer.id));
                                    setCustomerEditData(prev => ({
                                      ...prev,
                                      [customer.id]: { ...prev[customer.id], customer_number: customer.customer_number || '' }
                                    }));
                                  }} style={{ flex: 1, cursor: 'pointer', padding: '6px 10px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid transparent' }}>
                                    {customer.customer_number || '(empty)'}
                                  </span>
                                )}
                              </div>

                              {/* Name */}
                              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <strong style={{ minWidth: '140px' }}>Name:</strong>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editData.name !== undefined ? editData.name : customer.name}
                                    onChange={(e) => {
                                      setCustomerEditData(prev => ({
                                        ...prev,
                                        [customer.id]: { ...prev[customer.id], name: e.target.value }
                                      }));
                                    }}
                                    style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: '4px' }}
                                  />
                                ) : (
                                  <span onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCustomers(prev => new Set(prev).add(customer.id));
                                    setCustomerEditData(prev => ({
                                      ...prev,
                                      [customer.id]: { ...prev[customer.id], name: customer.name }
                                    }));
                                  }} style={{ flex: 1, cursor: 'pointer', padding: '6px 10px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid transparent' }}>
                                    {customer.name}
                                  </span>
                                )}
                              </div>

                              {/* Phone Number */}
                              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <strong style={{ minWidth: '140px' }}>Phone Number:</strong>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editData.phone !== undefined ? editData.phone : (customer.phone || '')}
                                    onChange={(e) => {
                                      setCustomerEditData(prev => ({
                                        ...prev,
                                        [customer.id]: { ...prev[customer.id], phone: e.target.value }
                                      }));
                                    }}
                                    style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: '4px' }}
                                  />
                                ) : (
                                  <span onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCustomers(prev => new Set(prev).add(customer.id));
                                    setCustomerEditData(prev => ({
                                      ...prev,
                                      [customer.id]: { ...prev[customer.id], phone: customer.phone || '' }
                                    }));
                                  }} style={{ flex: 1, cursor: 'pointer', padding: '6px 10px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid transparent' }}>
                                    {customer.phone || '(empty)'}
                                  </span>
                                )}
                              </div>

                              {/* Address */}
                              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                <strong style={{ minWidth: '140px', paddingTop: '6px' }}>Address:</strong>
                                {isEditing ? (
                                  <textarea
                                    value={editData.address !== undefined ? editData.address : (customer.address || '')}
                                    onChange={(e) => {
                                      setCustomerEditData(prev => ({
                                        ...prev,
                                        [customer.id]: { ...prev[customer.id], address: e.target.value }
                                      }));
                                    }}
                                    style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: '4px', minHeight: '60px', resize: 'vertical' }}
                                  />
                                ) : (
                                  <span onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingCustomers(prev => new Set(prev).add(customer.id));
                                    setCustomerEditData(prev => ({
                                      ...prev,
                                      [customer.id]: { ...prev[customer.id], address: customer.address || '' }
                                    }));
                                  }} style={{ flex: 1, cursor: 'pointer', padding: '6px 10px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid transparent', minHeight: '20px', display: 'block', whiteSpace: 'pre-wrap' }}>
                                    {customer.address || '(empty)'}
                                  </span>
                                )}
                              </div>

                              {/* License Number */}
                              {(customer.license_number || isEditing) && (
                                <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <strong style={{ minWidth: '140px' }}>License Number:</strong>
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editData.license_number !== undefined ? editData.license_number : (customer.license_number || '')}
                                      onChange={(e) => {
                                        setCustomerEditData(prev => ({
                                          ...prev,
                                          [customer.id]: { ...prev[customer.id], license_number: e.target.value }
                                        }));
                                      }}
                                      style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: '4px' }}
                                    />
                                  ) : (
                                    <span onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingCustomers(prev => new Set(prev).add(customer.id));
                                      setCustomerEditData(prev => ({
                                        ...prev,
                                        [customer.id]: { ...prev[customer.id], license_number: customer.license_number || '' }
                                      }));
                                    }} style={{ flex: 1, cursor: 'pointer', padding: '6px 10px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid transparent' }}>
                                      {customer.license_number || '(empty)'}
                                    </span>
                                  )}
                                </div>
                              )}

                              {/* Driver License Photo */}
                              <div style={{ marginBottom: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                                  <strong style={{ minWidth: '140px' }}>Driver License Photo:</strong>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUploadCustomerLicensePhoto(customer.id);
                                    }}
                                    style={{
                                      padding: '6px 15px',
                                      backgroundColor: '#667eea',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: '500'
                                    }}
                                  >
                                    📤 Upload Photo
                                  </button>
                                </div>
                                {customerLicensePhotos[customer.id] && (
                                  <div style={{ marginLeft: '150px', marginTop: '10px' }}>
                                    <img
                                      src={customerLicensePhotos[customer.id]}
                                      alt="Driver License"
                                      style={{
                                        maxWidth: '300px',
                                        maxHeight: '200px',
                                        borderRadius: '6px',
                                        border: '1px solid #ddd',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                      }}
                                    />
                                  </div>
                                )}
                                {!customerLicensePhotos[customer.id] && customer.license_photo_path && (
                                  <div style={{ marginLeft: '150px', marginTop: '10px', color: '#999', fontStyle: 'italic' }}>
                                    Photo path exists but failed to load
                                  </div>
                                )}
                                {!customerLicensePhotos[customer.id] && !customer.license_photo_path && (
                                  <div style={{ marginLeft: '150px', marginTop: '10px', color: '#999', fontStyle: 'italic' }}>
                                    No photo uploaded
                                  </div>
                                )}
                              </div>

                              {/* 保存/取消按钮 */}
                              {isEditing && (
                                <div style={{ marginTop: '15px', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        await window.electronAPI.customers.update(customer.id, editData);
                                        // 重新加载客户列表
                                        loadCustomerList(customerPage, customerListSearchQuery);
                                        // 取消编辑状态
                                        setEditingCustomers(prev => {
                                          const newSet = new Set(prev);
                                          newSet.delete(customer.id);
                                          return newSet;
                                        });
                                        setCustomerEditData(prev => {
                                          const newData = { ...prev };
                                          delete newData[customer.id];
                                          return newData;
                                        });
                                      } catch (error) {
                                        console.error('Failed to update customer:', error);
                                        alert('Failed to update customer');
                                      }
                                    }}
                                    style={{
                                      padding: '8px 20px',
                                      backgroundColor: '#28a745',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: '500'
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingCustomers(prev => {
                                        const newSet = new Set(prev);
                                        newSet.delete(customer.id);
                                        return newSet;
                                      });
                                      setCustomerEditData(prev => {
                                        const newData = { ...prev };
                                        delete newData[customer.id];
                                        return newData;
                                      });
                                    }}
                                    style={{
                                      padding: '8px 20px',
                                      backgroundColor: '#6c757d',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      cursor: 'pointer',
                                      fontSize: '14px',
                                      fontWeight: '500'
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* 车辆信息 */}
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                <h4 style={{ marginTop: 0, marginBottom: 0, color: '#333' }}>Vehicles</h4>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenAddVehicleModal(customer.id);
                                  }}
                                  style={{
                                    padding: '6px 15px',
                                    backgroundColor: '#28a745',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontWeight: '500'
                                  }}
                                >
                                  ➕ Add Vehicle
                                </button>
                              </div>
                              {vehicles.length === 0 ? (
                                <div style={{ color: '#999', fontStyle: 'italic', padding: '10px' }}>No vehicles</div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                  {vehicles.map((vehicle: any, index: number) => (
                                    <div key={vehicle.id} style={{
                                      padding: '10px',
                                      backgroundColor: 'white',
                                      borderRadius: '4px',
                                      border: '1px solid #e0e0e0'
                                    }}>
                                      <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#667eea' }}>
                                        {vehicles.length === 1 ? 'Vehicle' : `Vehicle ${index + 1}`}
                                      </div>
                                      <div><strong>License Plate:</strong> {vehicle.license_plate}</div>
                                      {vehicle.year && <div><strong>Year:</strong> {vehicle.year}</div>}
                                      {vehicle.color && <div><strong>Color:</strong> {vehicle.color}</div>}
                                      {vehicle.make && <div><strong>Make:</strong> {vehicle.make}</div>}
                                      {vehicle.model && <div><strong>Model:</strong> {vehicle.model}</div>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* 分页控件 */}
                  {customerPagination && customerPagination.totalPages > 1 && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: '10px',
                      marginTop: '30px',
                      padding: '20px',
                      borderTop: '1px solid #eee'
                    }}>
                      <button
                        onClick={() => {
                          const newPage = customerPage - 1;
                          setCustomerPage(newPage);
                          loadCustomerList(newPage, customerListSearchQuery);
                        }}
                        disabled={customerPage === 1 || customerListLoading}
                        style={{
                          padding: '8px 16px',
                          border: '1px solid #ddd',
                          borderRadius: '6px',
                          backgroundColor: customerPage === 1 ? '#f5f5f5' : 'white',
                          cursor: customerPage === 1 ? 'not-allowed' : 'pointer',
                          color: customerPage === 1 ? '#999' : '#333',
                          fontSize: '14px'
                        }}
                      >
                        Previous
                      </button>
                      
                      <div style={{
                        display: 'flex',
                        gap: '5px',
                        alignItems: 'center'
                      }}>
                        {Array.from({ length: Math.min(5, customerPagination.totalPages) }, (_, i) => {
                          let pageNum: number;
                          if (customerPagination.totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (customerPage <= 3) {
                            pageNum = i + 1;
                          } else if (customerPage >= customerPagination.totalPages - 2) {
                            pageNum = customerPagination.totalPages - 4 + i;
                          } else {
                            pageNum = customerPage - 2 + i;
                          }
                          
                          return (
                            <button
                              key={pageNum}
                              onClick={() => {
                                setCustomerPage(pageNum);
                                loadCustomerList(pageNum, customerSearchQuery);
                              }}
                              disabled={customerListLoading}
                              style={{
                                padding: '8px 12px',
                                border: '1px solid #ddd',
                                borderRadius: '6px',
                                backgroundColor: customerPage === pageNum ? '#667eea' : 'white',
                                color: customerPage === pageNum ? 'white' : '#333',
                                cursor: 'pointer',
                                fontSize: '14px',
                                minWidth: '40px'
                              }}
                            >
                              {pageNum}
                            </button>
                          );
                        })}
                      </div>
                      
                      <button
                        onClick={() => {
                          const newPage = customerPage + 1;
                          setCustomerPage(newPage);
                          loadCustomerList(newPage, customerListSearchQuery);
                        }}
                        disabled={customerPage === customerPagination.totalPages || customerListLoading}
                        style={{
                          padding: '8px 16px',
                          border: '1px solid #ddd',
                          borderRadius: '6px',
                          backgroundColor: customerPage === customerPagination.totalPages ? '#f5f5f5' : 'white',
                          cursor: customerPage === customerPagination.totalPages ? 'not-allowed' : 'pointer',
                          color: customerPage === customerPagination.totalPages ? '#999' : '#333',
                          fontSize: '14px'
                        }}
                      >
                        Next
                      </button>
                      
                      <div style={{ marginLeft: '15px', color: '#666', fontSize: '14px' }}>
                        Page {customerPage} of {customerPagination.totalPages}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'records' && (
          <div className="records-section">
            <div className="records-header">
              <h2>Weighing Records</h2>
            </div>
            
            {/* 筛选器 */}
            <div className="records-filter">
              <div className="filter-row">
                <div className="filter-group">
                  <label>Start Date:</label>
                  <input
                    type="date"
                    value={recordsFilter.startDate}
                    onChange={(e) => setRecordsFilter({...recordsFilter, startDate: e.target.value})}
                  />
                </div>
                <div className="filter-group">
                  <label>End Date:</label>
                  <input
                    type="date"
                    value={recordsFilter.endDate}
                    onChange={(e) => setRecordsFilter({...recordsFilter, endDate: e.target.value})}
                  />
                </div>
                <div className="filter-group">
                  <label>Customer Name:</label>
                  <input
                    type="text"
                    placeholder="Search by customer name"
                    value={recordsFilter.customerName}
                    onChange={(e) => setRecordsFilter({...recordsFilter, customerName: e.target.value})}
                  />
                </div>
                <div className="filter-actions">
                  <button onClick={applyRecordsFilter} className="apply-filter-btn">
                    Apply Filter
                  </button>
                  <button onClick={resetRecordsFilter} className="reset-filter-btn">
                    Reset
                  </button>
                  {recordsFilter.startDate && recordsFilter.endDate && (
                    <button 
                      onClick={async () => {
                        try {
                          setRecordsLoading(true);
                          await (window.electronAPI as any).report.generateInventoryReport(
                            recordsFilter.startDate,
                            recordsFilter.endDate
                          );
                        } catch (error: any) {
                          console.error('Failed to generate report:', error);
                          alert(`生成报告失败: ${error.message || '未知错误'}`);
                        } finally {
                          setRecordsLoading(false);
                        }
                      }}
                      className="generate-report-btn"
                      disabled={recordsLoading}
                      style={{
                        backgroundColor: recordsLoading ? '#6c757d' : '#28a745',
                        color: 'white',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: recordsLoading ? 'not-allowed' : 'pointer',
                        transition: 'background-color 0.2s'
                      }}
                    >
                      {recordsLoading ? '生成中...' : 'Generate Report'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 记录列表 */}
            <div className="records-list">
              {recordsLoading ? (
                <div className="loading">Loading records...</div>
              ) : recordsData?.data?.length > 0 ? (
                <>
                  {recordsData.data.map((session: any) => (
                    <div key={session.id} className="record-item">
                      <div 
                        className="record-header clickable"
                        onClick={() => setExpandedRecord(expandedRecord === session.id ? null : session.id)}
                      >
                        <span className="record-id">Session #{session.id}</span>
                        <span className="record-time">
                          {new Date(session.session_time).toLocaleString()}
                        </span>
                        {session.status === 'unfinished' && (
                          <span style={{
                            color: 'red',
                            fontWeight: 'bold',
                            marginLeft: '10px',
                            fontSize: '14px'
                          }}>
                            Unfinished
                          </span>
                        )}
                        <span className="expand-icon">
                          {expandedRecord === session.id ? '▼' : '▶'}
                        </span>
                      </div>
                      <div className="record-details">
                        <div>Customer: {session.customer_name || 'Not specified'}</div>
                        <div className="total-amount" style={{
                          color: session.status === 'unfinished' ? 'red' : 'inherit'
                        }}>
                          Total Amount: ${session.total_amount.toFixed(2)}
                        </div>
                        {session.status === 'unfinished' && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                // 加载session数据
                                const sessionData = await window.electronAPI.weighingSessions.getById(session.id);
                                const weighings = await window.electronAPI.weighings.getBySession(session.id);
                                
                                // 设置客户
                                if (sessionData.customer_id) {
                                  const customerIdStr = sessionData.customer_id.toString();
                                  setWeighingForm(prev => ({
                                    ...prev,
                                    customer_id: customerIdStr,
                                    notes: sessionData.notes || ''
                                  }));
                                  
                                  // 手动加载客户详情
                                  try {
                                    const customer = await window.electronAPI.customers.getById(sessionData.customer_id);
                                    setSelectedCustomer(customer);
                                    
                                    // 加载车辆信息
                                    const vehicles = await window.electronAPI.vehicles.getByCustomerId(sessionData.customer_id);
                                    setCustomerVehicles(vehicles || []);
                                    
                                    // 清空biometric数据，让用户重新采集
                                    setBiometricData(null);
                                    setBiometricImageCache({});
                                    setBiometricImageErrors({});
                                  } catch (error) {
                                    console.error('Failed to load customer details:', error);
                                  }
                                } else {
                                  // 如果没有客户，清空相关状态
                                  setSelectedCustomer(null);
                                  setCustomerVehicles([]);
                                  setBiometricData(null);
                                }
                                
                                // 恢复metal list
                                const restoredMetalList = weighings.map((w: any, index: number) => ({
                                  id: Date.now() + index, // 生成临时ID
                                  metal_type_id: w.waste_type_id,
                                  metal_type_name: w.waste_type_name || w.metal_symbol || 'Unknown',
                                  grossWeight: 0, // 数据库中没有保存，设为0
                                  tareWeight: 0, // 数据库中没有保存，设为0
                                  weight: parseFloat(w.weight) || 0, // 确保是数字
                                  unit_price: parseFloat(w.unit_price) || 0, // 确保是数字
                                  total_amount: parseFloat(w.total_amount) || 0 // 确保是数字
                                }));
                                setMetalList(restoredMetalList);
                                
                                // 恢复waste photos（如果有）
                                const photoPaths = weighings
                                  .filter((w: any) => w.product_photo_path)
                                  .map((w: any, index: number) => ({
                                    id: Date.now() + index,
                                    path: w.product_photo_path,
                                    preview: '' // 稍后加载
                                  }));
                                
                                // 加载照片预览
                                const photosWithPreview = await Promise.all(
                                  photoPaths.map(async (photo) => {
                                    try {
                                      const imageData = await window.electronAPI.image.readFile(photo.path);
                                      return { ...photo, preview: imageData || '' };
                                    } catch {
                                      return photo;
                                    }
                                  })
                                );
                                setWastePhotos(photosWithPreview);
                                
                                // 设置编辑状态
                                setEditingSessionId(session.id);
                                
                                // 切换到Weighing页面
                                setActiveTab('weighing');
                                
                                // 更新unfinished数量
                                await loadUnfinishedCount();
                              } catch (error) {
                                console.error('Failed to load session data:', error);
                                alert('Failed to load session data');
                              }
                            }}
                            style={{
                              marginTop: '10px',
                              padding: '8px 16px',
                              backgroundColor: '#28a745',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontWeight: '500'
                            }}
                          >
                            Continue
                          </button>
                        )}
                      </div>
                      {expandedRecord === session.id && (
                        <SessionDetails sessionId={session.id} />
                      )}
                    </div>
                  ))}
                  
                  {/* 分页控件 */}
                  {recordsData.pagination.totalPages > 1 && (
                    <div className="pagination">
                      <button 
                        onClick={() => loadRecordsData(recordsFilter.page - 1)}
                        disabled={recordsFilter.page <= 1}
                        className="page-btn"
                      >
                        Previous
                      </button>
                      
                      <span className="page-info">
                        Page {recordsFilter.page} of {recordsData.pagination.totalPages} 
                        ({recordsData.pagination.total} total records)
                      </span>
                      
                      <button 
                        onClick={() => loadRecordsData(recordsFilter.page + 1)}
                        disabled={recordsFilter.page >= recordsData.pagination.totalPages}
                        className="page-btn"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="no-records">No records found</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'import' && (
          <div className="import-section">
            <h2>Import Data</h2>
            <div className="import-options">
              <div className="import-card">
                <h3>Import Customer Data</h3>
                <p>Import customer information from CSV or Excel files</p>
                <button 
                  onClick={handleImportCustomers} 
                  className="btn-primary"
                  disabled={isImporting}
                >
                  {isImporting ? 'Importing...' : 'Select Customer File'}
                </button>
              </div>
              
              <div className="import-card">
                <h3>Import Vehicle Data</h3>
                <p>Import vehicle information and auto-match with customers</p>
                <button 
                  onClick={handleImportVehicles} 
                  className="btn-primary"
                  disabled={isImporting}
                >
                  {isImporting ? 'Importing...' : 'Select Vehicle File'}
                </button>
              </div>
            </div>
            
            {importResult && (
              <div className={`import-result ${importResult.success ? 'success' : 'error'}`}>
                <h4>{importResult.message}</h4>
                {importResult.importedCustomers > 0 && (
                  <p>Imported {importResult.importedCustomers} customers</p>
                )}
                {importResult.importedVehicles > 0 && (
                  <p>Imported {importResult.importedVehicles} vehicles</p>
                )}
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="import-errors">
                    <h5>Errors:</h5>
                    <ul>
                      {importResult.errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* 生物识别组件 */}
      {showCameraCapture && (
        <CameraCapture
          onCapture={handleFaceCaptured}
          onClose={() => setShowCameraCapture(false)}
        />
      )}

      {showFingerprintCapture && (
        <FingerprintCapture
          onCapture={handleFingerprintCaptured}
          onClose={() => setShowFingerprintCapture(false)}
        />
      )}

      {showSignatureCapture && (
        <SignatureCapture
          onCapture={handleSignatureCaptured}
          onClose={() => setShowSignatureCapture(false)}
        />
      )}

      {/* 设置组件 */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* 金属种类管理组件 */}
      {showMetalManagement && (
        <MetalTypeManagement
          onClose={() => {
            setShowMetalManagement(false);
            loadData(); // 关闭时重新加载数据
          }}
          onDataChange={loadData} // 数据变更时重新加载数据
        />
      )}


      {/* Waste照片摄像头组件 */}
      {showWasteCamera && (
        <CameraCapture
          onCapture={handleWastePhotoCaptured}
          onClose={() => setShowWasteCamera(false)}
        />
      )}

      {/* 导入进度窗口 */}
      <ImportProgress
        isVisible={importProgress !== null}
        progress={importProgress?.percent || 0}
        current={importProgress?.current || 0}
        total={importProgress?.total || 0}
        message={importProgress?.message || ''}
        onClose={() => {
          if (importProgress && importProgress.percent >= 100) {
            setImportProgress(null);
          }
        }}
      />

      {/* 添加车辆模态框 */}
      {showAddVehicleModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }} onClick={() => setShowAddVehicleModal(false)}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '30px',
            width: '500px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333' }}>Add Vehicle</h2>
            
            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                License Plate <span style={{ color: 'red' }}>*</span>
              </label>
              <input
                type="text"
                value={vehicleForm.license_plate}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, license_plate: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '2px solid #ddd',
                  fontSize: '14px'
                }}
                placeholder="Enter license plate"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                Year
              </label>
              <input
                type="number"
                value={vehicleForm.year}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, year: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '2px solid #ddd',
                  fontSize: '14px'
                }}
                placeholder="Enter year"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                Color
              </label>
              <input
                type="text"
                value={vehicleForm.color}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, color: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '2px solid #ddd',
                  fontSize: '14px'
                }}
                placeholder="Enter color"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                Make
              </label>
              <input
                type="text"
                value={vehicleForm.make}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, make: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '2px solid #ddd',
                  fontSize: '14px'
                }}
                placeholder="Enter make (e.g., Toyota, Ford)"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                Model
              </label>
              <input
                type="text"
                value={vehicleForm.model}
                onChange={(e) => setVehicleForm(prev => ({ ...prev, model: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '2px solid #ddd',
                  fontSize: '14px'
                }}
                placeholder="Enter model"
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowAddVehicleModal(false);
                  setAddVehicleCustomerId(null);
                  setVehicleForm({
                    license_plate: '',
                    year: '',
                    color: '',
                    make: '',
                    model: ''
                  });
                }}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddVehicle}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Add Vehicle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
