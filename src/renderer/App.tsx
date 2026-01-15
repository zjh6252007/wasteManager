import React, { useState, useEffect } from 'react';
import './style.css';
import LoginForm from './components/LoginForm';
import CameraCapture from './components/CameraCapture';
import FingerprintCapture from './components/FingerprintCapture';
import SignatureCapture from './components/SignatureCapture';
import Settings from './components/Settings';
import MetalTypeManagement from './components/MetalTypeManagement';
import ImportProgress from './components/ImportProgress';

// Default placeholder image (SVG encoded as base64 data URI)
const DEFAULT_PLACEHOLDER_IMAGE = `data:image/svg+xml;base64,${btoa(`
  <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
    <rect width="200" height="200" fill="#f0f0f0"/>
    <text x="50%" y="45%" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="#999">No Image</text>
    <text x="50%" y="55%" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#999">Available</text>
    <circle cx="100" cy="100" r="30" fill="none" stroke="#ccc" stroke-width="2"/>
  </svg>
`)}`;

// Session details component
const SessionDetails: React.FC<{ 
  sessionId: number;
  onContinue?: (sessionId: number) => Promise<void>;
  onDelete?: (sessionId: number) => Promise<void>;
}> = ({ sessionId, onContinue, onDelete }) => {
  const [sessionWeighings, setSessionWeighings] = useState<any[]>([]);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [biometricData, setBiometricData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [imageCache, setImageCache] = useState<{ [key: string]: string }>({});
  const [imageErrors, setImageErrors] = useState<{ [key: string]: boolean }>({});
  const [generatingReport, setGeneratingReport] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Load session data and biometric data
  useEffect(() => {
    const loadSessionData = async () => {
      try {
        setLoading(true);
        // Load weighing records
        const weighings = await window.electronAPI.weighings.getBySession(sessionId);
        setSessionWeighings(weighings);
        
        // Load session information
        const session = await window.electronAPI.weighingSessions.getById(sessionId);
        setSessionInfo(session);
        
        // If customer_id exists, load biometric data
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

  // Load images to cache - must be after all hooks, before return
  useEffect(() => {
    if (loading) return; // If still loading, don't load images
    
    const imagePaths: string[] = [];
    
    // Collect image paths that need to be loaded
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
    
    // Load all images
    imagePaths.forEach(imagePath => {
      // Use functional update to check cache, avoid dependency on imageCache
      setImageCache(prev => {
        // If already in cache, skip
        if (prev[imagePath]) return prev;
        
        // Asynchronously load image
        (window.electronAPI as any).image.readFile(imagePath)
          .then((dataUrl: string | null) => {
            if (dataUrl) {
              setImageCache(current => {
                if (current[imagePath]) return current; // Avoid duplicate setting
                return { ...current, [imagePath]: dataUrl };
              });
            }
          })
          .catch((error: any) => {
            console.error(`Failed to load image ${imagePath}:`, error);
          });
        
        return prev; // Return original value first, update after async load completes
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricData, sessionWeighings, loading]); // imageCache accessed via functional update, not needed in dependencies

  const handleGenerateReport = async () => {
    try {
      setGeneratingReport(true);
      await (window.electronAPI as any).report.generatePoliceReport(sessionId);
      // PDF will automatically open in new window, no popup needed
    } catch (error: any) {
      console.error('Failed to generate report:', error);
      alert(`Failed to generate report: ${error.message || 'Unknown error'}`);
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleContinue = async () => {
    if (onContinue) {
      await onContinue(sessionId);
    }
  };

  const handleDeleteSession = async () => {
    if (!deletePassword) {
      alert('Please enter your password');
      return;
    }

    try {
      setDeleting(true);
      
      // Verify password
      const currentUser = await (window.electronAPI as any).auth.getCurrentUser();
      if (!currentUser) {
        alert('User not found. Please login again.');
        setShowDeleteConfirm(false);
        setDeletePassword('');
        // 恢复焦点到body，避免输入框被锁住
        setTimeout(() => {
          document.body.focus();
          if (document.activeElement && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }, 100);
        return;
      }

      // Verify password by attempting to authenticate
      const authResult = await (window.electronAPI as any).auth.verifyPassword(currentUser.username, deletePassword);
      if (!authResult.success) {
        alert('Incorrect password. Please try again.');
        setDeletePassword('');
        // 重新聚焦到密码输入框
        setTimeout(() => {
          const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
          if (passwordInput) {
            passwordInput.focus();
          }
        }, 100);
        return;
      }

      // Delete session
      if (onDelete) {
        await onDelete(sessionId);
      } else {
        // Fallback: direct delete if onDelete callback not provided
        await (window.electronAPI as any).weighingSessions.delete(sessionId);
      }

      // Close dialog
      setShowDeleteConfirm(false);
      setDeletePassword('');
      
      // 恢复焦点，避免输入框被锁住
      setTimeout(() => {
        document.body.focus();
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        // 确保可以正常输入
        const activeElement = document.activeElement;
        if (activeElement && activeElement instanceof HTMLElement) {
          activeElement.blur();
        }
      }, 100);
    } catch (error: any) {
      console.error('Failed to delete session:', error);
      alert(`Failed to delete session: ${error.message || 'Unknown error'}`);
      // 恢复焦点
      setTimeout(() => {
        document.body.focus();
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }, 100);
    } finally {
      setDeleting(false);
    }
  };

  // Check if session is unfinished OR if biometric data is incomplete
  const isBiometricIncomplete = sessionInfo?.customer_id && (
    !biometricData?.face_image_path || 
    !biometricData?.fingerprint_image_path || 
    !biometricData?.signature_image_path
  );
  const isUnfinished = sessionInfo?.status === 'unfinished' || isBiometricIncomplete;

  return (
    <div className="record-expanded" style={{ position: 'relative' }}>
      <div className="expanded-details">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h4 style={{ margin: 0 }}>Session Details</h4>
          <div style={{ display: 'flex', gap: '10px' }}>
            {/* Continue button - show when session is unfinished */}
            {isUnfinished && onContinue && (
              <button
                onClick={handleContinue}
                disabled={loading}
                className="continue-btn"
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'background-color 0.2s'
                }}
              >
                Continue
              </button>
            )}
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
              {generatingReport ? 'Generating...' : 'Generate Police Report'}
            </button>
          </div>
        </div>
        
        {/* Biometric information section */}
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

        {/* Product list section */}
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
        
        {/* Delete button - positioned at bottom right */}
        {onDelete && (
          <div style={{ 
            position: 'absolute', 
            bottom: '20px', 
            right: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '10px'
          }}>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={loading || deleting}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading || deleting ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'background-color 0.2s',
                opacity: loading || deleting ? 0.6 : 1
              }}
            >
              {deleting ? 'Deleting...' : '🗑️ Delete Session'}
            </button>
          </div>
        )}
      </div>
      
      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={(e) => {
            // 点击背景关闭对话框
            if (e.target === e.currentTarget) {
              setShowDeleteConfirm(false);
              setDeletePassword('');
              // 恢复焦点
              setTimeout(() => {
                document.body.focus();
                if (document.activeElement && document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }
              }, 100);
            }
          }}
        >
          <div 
            style={{
              backgroundColor: 'white',
              padding: '30px',
              borderRadius: '8px',
              minWidth: '400px',
              maxWidth: '500px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
            }}
            onClick={(e) => {
              // 阻止事件冒泡，避免点击对话框内容时关闭
              e.stopPropagation();
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#dc3545' }}>Delete Session</h3>
            <p style={{ marginBottom: '20px', color: '#666' }}>
              Are you sure you want to delete this session? This action cannot be undone.
            </p>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Enter your password to confirm:
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter password"
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && deletePassword && !deleting) {
                    e.preventDefault();
                    handleDeleteSession();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowDeleteConfirm(false);
                    setDeletePassword('');
                    // 恢复焦点
                    setTimeout(() => {
                      document.body.focus();
                      if (document.activeElement && document.activeElement instanceof HTMLElement) {
                        document.activeElement.blur();
                      }
                    }, 100);
                  }
                }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletePassword('');
                  // 恢复焦点，避免输入框被锁住
                  setTimeout(() => {
                    document.body.focus();
                    if (document.activeElement && document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur();
                    }
                  }, 100);
                }}
                disabled={deleting}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSession}
                disabled={!deletePassword || deleting}
                style={{
                  padding: '10px 20px',
                  backgroundColor: deleting ? '#6c757d' : '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: !deletePassword || deleting ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const [appVersion, setAppVersion] = useState<string>('');
  
  // Customer list pagination and search state
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
  
  // Customer expand and edit state
  const [expandedCustomers, setExpandedCustomers] = useState<Set<number>>(new Set());
  const [editingCustomers, setEditingCustomers] = useState<Set<number>>(new Set());
  const [customerEditData, setCustomerEditData] = useState<{ [key: number]: any }>({});
  const [customerVehiclesData, setCustomerVehiclesData] = useState<{ [key: number]: any[] }>({});
  const [customerLicensePhotos, setCustomerLicensePhotos] = useState<{ [key: number]: string }>({});
  
  // Vehicle add modal state
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
  const [addVehicleCustomerId, setAddVehicleCustomerId] = useState<number | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    license_plate: '',
    year: '',
    color: '',
    make: '',
    model: ''
  });

  // Quick add customer modal state
  const [showQuickAddCustomerModal, setShowQuickAddCustomerModal] = useState(false);
  const [quickAddCustomerForm, setQuickAddCustomerForm] = useState({
    name: '',
    phone: '',
    address: ''
  });
  
  const [metalTypes, setMetalTypes] = useState<any[]>([]);
  const [weighings, setWeighings] = useState<Weighing[]>([]);
  const [unfinishedCount, setUnfinishedCount] = useState<number>(0);

  // Data mismatch dialog state
  const [syncInProgress, setSyncInProgress] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ progress: number; message: string; stage?: string } | null>(null);
  const [syncType, setSyncType] = useState<'upload' | 'download' | null>(null);
  
  // Sync notification state when closing
  const [showClosingSyncDialog, setShowClosingSyncDialog] = useState(false);
  const [closingSyncMessage, setClosingSyncMessage] = useState('');
  
  // Error message toast state
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Load app version on mount
  useEffect(() => {
    const loadVersion = async () => {
      try {
        const version = await (window.electronAPI as any).update.getCurrentVersion();
        setAppVersion(version || '0.0.1');
      } catch (error) {
        console.error('Failed to load app version:', error);
        setAppVersion('0.0.1');
      }
    };
    loadVersion();
  }, []);

  // Set up camera device enumeration listener
  useEffect(() => {
    const electronAPI = window.electronAPI as any;
    if (!electronAPI || !electronAPI.ipc) {
      console.warn('electronAPI.ipc not available');
      return;
    }
    
    // Listen for camera device list requests
    const handleGetDevices = async () => {
      console.log('Received camera device enumeration request');
      try {
        // First request media permissions (if needed)
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        } catch (permError) {
          console.log('Media permission request failed, but continuing device enumeration:', permError);
          // Permission denied, but can still enumerate devices (just no label)
        }
        
        // Enumerate devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameraDevices = devices.filter(device => device.kind === 'videoinput');
        
        console.log('Found camera devices:', cameraDevices.length, cameraDevices);
        
        // Convert MediaDeviceInfo to serializable object
        const serializableDevices = cameraDevices.map(device => ({
          deviceId: device.deviceId,
          kind: device.kind,
          label: device.label,
          groupId: device.groupId
        }));
        
        console.log('Sending device list to main process:', serializableDevices);
        
        // Send device list back to main process
        electronAPI.ipc.send('camera:devices', serializableDevices);
      } catch (error) {
        console.error('Failed to enumerate camera devices:', error);
        electronAPI.ipc.send('camera:devices', []);
      }
    };

    // Listen for main process requests
    electronAPI.ipc.on('camera:get-devices', handleGetDevices);
    console.log('Camera device enumeration listener set up');

    // Clean up listener
    return () => {
      electronAPI.ipc.removeListener('camera:get-devices', handleGetDevices);
    };
  }, []);

  // Listen for data mismatch events
  useEffect(() => {
    const electronAPI = window.electronAPI as any;
    if (!electronAPI || !electronAPI.sync) {
      return;
    }


    const handleClosingSync = (data: { message: string }) => {
      setClosingSyncMessage(data.message);
      setShowClosingSyncDialog(true);
    };

    const handleClosingSyncComplete = (data: { success: boolean; message: string }) => {
      setClosingSyncMessage(data.message);
      // Delay closing dialog to let user see completion message
      setTimeout(() => {
        setShowClosingSyncDialog(false);
      }, 1000);
    };

    const handleSyncProgress = (progress: { stage: string; progress: number; message: string; deviceCount?: number; syncedRecords?: number; totalRecords?: number }) => {
      setSyncProgress({
        progress: progress.progress,
        message: progress.message,
        stage: progress.stage
      });
    };

    electronAPI.sync.onClosingSync(handleClosingSync);
    electronAPI.sync.onClosingSyncComplete(handleClosingSyncComplete);
    electronAPI.sync.onProgress(handleSyncProgress);

    return () => {
      electronAPI.sync.removeClosingSyncListener();
      electronAPI.sync.removeProgressListener();
    };
  }, []);
  
  // Records filter and pagination state
  const [recordsFilter, setRecordsFilter] = useState({
    startDate: '',
    endDate: '',
    customerName: '',
    page: 1
  });
  
  // Batch report generation progress
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; sessionId: number } | null>(null);
  const [showBatchConfirmDialog, setShowBatchConfirmDialog] = useState(false);
  const [pendingBatchParams, setPendingBatchParams] = useState<{ startDate?: string; endDate?: string; customerName?: string } | null>(null);
  const [batchReportCount, setBatchReportCount] = useState<number | null>(null);
  const [recordsData, setRecordsData] = useState<any>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'weighing' | 'customers' | 'records' | 'import'>('weighing');
  
  // Import function state
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    message: string;
  } | null>(null);
  
  // Biometric function state
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const [showFingerprintCapture, setShowFingerprintCapture] = useState(false);
  const [showSignatureCapture, setShowSignatureCapture] = useState(false);
  const [biometricData, setBiometricData] = useState<any>(null);
  const [biometricImageCache, setBiometricImageCache] = useState<{ [key: string]: string }>({});
  const [biometricImageErrors, setBiometricImageErrors] = useState<{ [key: string]: boolean }>({});
  
  // Settings function state
  const [showSettings, setShowSettings] = useState(false);
  const [showMetalManagement, setShowMetalManagement] = useState(false);

  // Weighing form state
  const [weighingForm, setWeighingForm] = useState({
    customer_id: '',
    metal_type_id: '',
    grossWeight: '', // Gross weight
    tareWeight: '', // Tare weight
    netWeight: '', // Net weight (auto calculated)
    unitPrice: '', // Unit price
    price: '', // Price (auto calculated)
    notes: ''
  });
  const [metalList, setMetalList] = useState<any[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null); // Currently editing session ID
  
  // Waste Photo state (supports multiple photos)
  const [showWasteCamera, setShowWasteCamera] = useState(false);
  const [wastePhotos, setWastePhotos] = useState<Array<{ id: number; path: string; preview: string }>>([]);
  
  // Vehicle information state
  const [customerVehicles, setCustomerVehicles] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  
  // Customer search state
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<any[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);

  // Customer form state
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
  
  // Driver license photo state
  const [licensePhotoPath, setLicensePhotoPath] = useState<string | null>(null);
  const [licensePhotoPreview, setLicensePhotoPreview] = useState<string | null>(null);

  // Check login status
  useEffect(() => {
    checkLoginStatus();
  }, []);

  // Load data when switching to Records tab
  useEffect(() => {
    if (activeTab === 'records' && isLoggedIn) {
      loadRecordsData(1);
    }
  }, [activeTab, isLoggedIn]);


  // Load data
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
      console.error('Failed to check login status:', error);
    }
  };

  // Load unfinished record count
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
      
      // Load unfinished count
      await loadUnfinishedCount();
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  // Load paginated customer list
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

  // Customer search logic (for quick search on weighing page)
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

    // Debounce: delay 300ms before executing search
    const timeoutId = setTimeout(searchCustomers, 300);
    return () => clearTimeout(timeoutId);
  }, [customerSearchQuery]);

  // Search customer list (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (activeTab === 'customers') {
        setCustomerPage(1); // Reset to first page when searching
        loadCustomerList(1, customerListSearchQuery);
      }
    }, 300);
    
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerListSearchQuery]);

  // Load customer vehicle information
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

  // Load customer driver license photo
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

  // Upload customer driver license photo
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
      console.error('Failed to upload driver license photo:', error);
      alert('Failed to upload license photo');
    }
  };

  // Open add vehicle modal
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

  // Add vehicle
  const handleAddVehicle = async () => {
    if (!addVehicleCustomerId) return;
    
    if (!vehicleForm.license_plate.trim()) {
      showError('Please enter license plate');
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
      showError('Failed to add vehicle');
    }
  };

  // Load first page when switching to Customers tab
  useEffect(() => {
    if (activeTab === 'customers') {
      loadCustomerList(1, customerListSearchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Update unfinished count when switching to Records tab
  useEffect(() => {
    if (activeTab === 'records') {
      loadUnfinishedCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Load Records data (paginated)
  const loadRecordsData = async (page = 1, filterOverride?: typeof recordsFilter) => {
    try {
      setRecordsLoading(true);
      // Also update unfinished count
      await loadUnfinishedCount();
      const filter = filterOverride || recordsFilter;
      const options = {
        page,
        limit: 10,
        startDate: filter.startDate || undefined,
        endDate: filter.endDate || undefined,
        customerName: filter.customerName || undefined
      };
      
      const result = await window.electronAPI.weighings.getPaginated(options);
      setRecordsData(result);
      setRecordsFilter(prev => ({ ...prev, page, ...(filterOverride ? { startDate: filter.startDate, endDate: filter.endDate } : {}) }));
    } catch (error) {
      console.error('Failed to load records data:', error);
    } finally {
      setRecordsLoading(false);
    }
  };

  // Apply filter
  const applyRecordsFilter = () => {
    setRecordsFilter(prev => ({ ...prev, page: 1 }));
    loadRecordsData(1);
  };

  // 开始批量生成报告
  const startBatchReportGeneration = async (startDate?: string, endDate?: string, customerName?: string) => {
    try {
      setRecordsLoading(true);
      setBatchProgress({ current: 0, total: 0, sessionId: 0 });
      
      // 设置进度监听
      const progressCallback = (progress: { current: number; total: number; sessionId: number }) => {
        setBatchProgress(progress);
      };
      
      (window.electronAPI as any).report.onBatchProgress(progressCallback);
      
      try {
        await (window.electronAPI as any).report.generatePoliceReportsBatch(
          startDate,
          endDate,
          customerName
        );
        
        // PDF will automatically open in new window, no popup needed
      } finally {
        (window.electronAPI as any).report.removeBatchProgressListener(progressCallback);
        setBatchProgress(null);
      }
    } catch (error: any) {
      console.error('Failed to generate batch police reports:', error);
      alert(`Failed to generate reports: ${error.message || 'Unknown error'}`);
      setBatchProgress(null);
    } finally {
      setRecordsLoading(false);
    }
  };

  // Reset filter
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
    
    // 监听自动同步完成事件
    (window.electronAPI as any).sync.onAutoSyncComplete((data: { success: boolean; message: string; syncedRecords?: number }) => {
      if (data.success) {
        showSuccess(`Data synchronized from cloud successfully! ${data.syncedRecords || 0} records downloaded.`);
        // 刷新所有数据
        loadCustomerList(1, customerListSearchQuery);
        loadRecordsData(1);
        // 刷新金属类型等其他数据
        // Metal types are loaded automatically when needed
      } else {
        showError(`Failed to sync data from cloud: ${data.message}`);
      }
    });
    
    // 监听数据刷新事件
    (window.electronAPI as any).sync.onRefreshData(() => {
      console.log('[Frontend] Received refresh data signal');
      loadCustomerList(1, customerListSearchQuery);
      loadRecordsData(1);
      // Metal types are loaded automatically when needed
      loadData(); // Reload all data including metal types
    });
    
    // 监听过期时间更新事件
    (window.electronAPI as any).auth.onExpirationUpdated((data: { expiresAt: string }) => {
      console.log('[Frontend] Expiration time updated:', data.expiresAt);
      // 重新检查登录状态以更新过期时间显示
      checkLoginStatus();
    });
    
    // 定期从服务器刷新过期时间（每5分钟），确保所有客户端显示一致
    const refreshExpirationInterval = setInterval(() => {
      console.log('[Frontend] Scheduled refresh: checking login status...');
      checkLoginStatus();
    }, 5 * 60 * 1000); // 每5分钟刷新一次
    
    // 窗口获得焦点时也刷新过期时间
    const handleWindowFocus = () => {
      console.log('[Frontend] Window focused, refreshing expiration time...');
      checkLoginStatus();
    };
    window.addEventListener('focus', handleWindowFocus);
    
    return () => {
      clearInterval(refreshExpirationInterval);
      window.removeEventListener('focus', handleWindowFocus);
    };
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
      console.error('Failed to logout:', error);
    }
  };

  // Add metal to list
  const handleAddToMetalList = () => {
    if (!weighingForm.metal_type_id || !weighingForm.netWeight || parseFloat(weighingForm.netWeight) <= 0) {
      showError('Please fill in metal type and ensure net weight is greater than 0');
      return;
    }

    if (!weighingForm.unitPrice || parseFloat(weighingForm.unitPrice) <= 0) {
      showError('Please fill in unit price');
      return;
    }

    const metalType = metalTypes.find(mt => mt.id === parseInt(weighingForm.metal_type_id));
    if (!metalType) {
      showError('Please select a valid metal type');
      return;
    }

    const netWeight = parseFloat(weighingForm.netWeight);
    const unitPrice = parseFloat(weighingForm.unitPrice);
    const price = parseFloat(weighingForm.price) || netWeight * unitPrice;

    const metalItem = {
      id: Date.now(), // Temporary ID
      metal_type_id: parseInt(weighingForm.metal_type_id),
      metal_type_name: metalType.name,
      grossWeight: parseFloat(weighingForm.grossWeight) || 0,
      tareWeight: parseFloat(weighingForm.tareWeight) || 0,
      weight: netWeight, // Use net weight as weight
      unit_price: unitPrice,
      total_amount: price,
      photos: [...wastePhotos] // Associate current photos with this metal item
    };

    setMetalList([...metalList, metalItem]);
    
    // Reset metal type, weight and price related fields, and photos, keep customer and notes
    setWeighingForm({
      ...weighingForm,
      metal_type_id: '',
      grossWeight: '',
      tareWeight: '',
      netWeight: '',
      unitPrice: '',
      price: ''
    });
    setWastePhotos([]); // Clear photos after adding to list
  };

  // Remove metal from list
  const handleRemoveFromMetalList = (id: number) => {
    setMetalList(metalList.filter(item => item.id !== id));
  };

  // Delete photo from metal item
  const handleDeleteMetalItemPhoto = (metalItemId: number, photoId: number) => {
    setMetalList(prev => prev.map(item => 
      item.id === metalItemId 
        ? { ...item, photos: (item.photos || []).filter((photo: any) => photo.id !== photoId) }
        : item
    ));
  };

  // Handle Waste Photo capture
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
                showError('Failed to save waste photo');
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
          showError('Failed to process waste photo');
        }
      };
      
      reader.readAsDataURL(blob);
      setShowWasteCamera(false);
    } catch (error) {
      console.error('Failed to process waste photo:', error);
      alert('Failed to process waste photo');
    }
  };

  // Delete Waste Photo
  const handleDeleteWastePhoto = (id: number) => {
    setWastePhotos(prev => prev.filter(photo => photo.id !== id));
  };

  // Auto calculate net weight (gross weight - tare weight)
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

  // Auto calculate price (net weight × unit price)
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

  // Auto fill Unit Price after selecting Metal Type
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

  // Handle Customer selection change
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
        
        // Don't load previous biometric data, need to re-capture each time
        // Clear biometric data to let user re-capture
        setBiometricData(null);
        setBiometricImageCache({});
        setBiometricImageErrors({});
      } else {
        setSelectedCustomer(null);
        setCustomerVehicles([]);
        setBiometricData(null);
        // Don't clear search query, let user keep search history
      }
    };
    
    loadCustomerData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weighingForm.customer_id]);

  // Helper function to show error message
  const showError = (message: string) => {
    console.log('Showing error message:', message);
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(''), 5000); // Auto clear after 5 seconds
  };

  // Helper function to show success message
  const showSuccess = (message: string) => {
    console.log('Showing success message:', message);
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(''), 5000); // Auto clear after 5 seconds
  };

  // Handle weighing save
  const handleWeighing = async () => {
    console.log('[Submit] handleWeighing called');
    
    if (metalList.length === 0) {
      showError('Please add at least one metal item to the list');
      return;
    }

    // Check if customer is selected
    if (!weighingForm.customer_id) {
      showError('Please select a customer before submitting');
      return;
    }

    console.log('[Submit] Validations passed, starting save process...');

    // Check if biometric data is complete
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
        console.log('[Submit] Updating existing session:', editingSessionId);
        sessionId = editingSessionId;
        // 更新session的notes和status
        await window.electronAPI.weighingSessions.update(sessionId, {
          notes: weighingForm.notes,
          status: status
        });
        // 删除该session的所有现有weighings，然后重新添加
        await window.electronAPI.weighings.deleteBySession(sessionId);
      } else {
        console.log('[Submit] Creating new session...');
        // 创建新的称重会话
        const sessionResult = await window.electronAPI.weighingSessions.create({
          customer_id: parseInt(weighingForm.customer_id),
          notes: weighingForm.notes,
          status: status
        });
        console.log('[Submit] Session created, full result:', JSON.stringify(sessionResult, null, 2));
        // 云端数据库返回 { id: ... }，本地数据库返回 { lastInsertRowid: ... }
        sessionId = sessionResult?.id || sessionResult?.lastInsertRowid;
        if (!sessionId) {
          console.error('[Submit] Session result does not contain id or lastInsertRowid:', sessionResult);
          throw new Error(`Failed to get session ID from create result. Result: ${JSON.stringify(sessionResult)}`);
        }
        console.log('[Submit] Session ID:', sessionId);
      }

      // 计算总金额
      let totalAmount = 0;

      // Create weighing record for each metal
      console.log('[Submit] Creating weighing records for', metalList.length, 'metal items...');
      for (let i = 0; i < metalList.length; i++) {
        const metalItem = metalList[i];
        console.log('[Submit] Creating weighing record', i + 1, 'of', metalList.length, ':', metalItem);
        // Use first saved photo from this metal item's photos
        const savedPhotos = (metalItem.photos || []).filter((photo: any) => photo.path);
        const productPhotoPath = savedPhotos.length > 0 ? savedPhotos[0].path : null;
        
        const weighingData = {
          session_id: sessionId,
          waste_type_id: metalItem.metal_type_id,
          weight: parseFloat(metalItem.weight) || 0,
          unit_price: parseFloat(metalItem.unit_price) || 0,
          total_amount: parseFloat(metalItem.total_amount) || 0,
          product_photo_path: productPhotoPath
        };
        console.log('[Submit] Weighing data:', weighingData);
        
        await window.electronAPI.weighings.create(weighingData);
        totalAmount += metalItem.total_amount;
        console.log('[Submit] Weighing record', i + 1, 'created successfully');
      }

      console.log('[Submit] Updating session total amount:', totalAmount);
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
      
      console.log('[Submit] Reloading data...');
      // 重新加载数据
      loadData();
      // 更新unfinished数量
      await loadUnfinishedCount();
      console.log('[Submit] Success!');
      showSuccess(`Successfully saved weighing session with ${metalList.length} metal item(s)!`);
      
      // 恢复焦点，避免输入框被锁住
      setTimeout(() => {
        document.body.focus();
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }, 100);
    } catch (error: any) {
      console.error('[Submit] Failed to save weighing session:', error);
      console.error('[Submit] Error details:', {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      });
      const errorMessage = error?.message || 'Failed to save weighing session, please try again';
      showError(`Failed to save weighing session: ${errorMessage}`);
      
      // 恢复焦点
      setTimeout(() => {
        document.body.focus();
        if (document.activeElement && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      }, 100);
    }
  };

  // Quick add customer (from weighing page)
  const handleQuickAddCustomer = async () => {
    if (!quickAddCustomerForm.name.trim()) {
      showError('Please enter customer name');
      return;
    }

    try {
      const customerData = {
        name: quickAddCustomerForm.name.trim(),
        phone: quickAddCustomerForm.phone.trim() || undefined,
        address: quickAddCustomerForm.address.trim() || undefined,
        license_number: '',
        id_expiration: '',
        height: '',
        weight: '',
        hair_color: '',
        license_photo_path: null
      };
      
      const result = await window.electronAPI.customers.create(customerData);
      
      // Clear form
      setQuickAddCustomerForm({ name: '', phone: '', address: '' });
      setShowQuickAddCustomerModal(false);
      
      // Reload customer list and search
      loadData();
      loadCustomerList(customerPage, customerListSearchQuery);
      
      // Select the newly added customer
      if (result.lastInsertRowid) {
        try {
          const newCustomer = await window.electronAPI.customers.getById(result.lastInsertRowid);
          if (newCustomer) {
            setSelectedCustomer(newCustomer);
            setWeighingForm(prev => ({
              ...prev,
              customer_id: newCustomer.id.toString()
            }));
            setCustomerSearchQuery(newCustomer.name);
            setCustomerSearchResults([]);
          }
        } catch (error) {
          console.error('Failed to load newly added customer:', error);
          // Still show success, customer was added
        }
      }
      
      showSuccess('Customer added successfully!');
    } catch (error) {
      console.error('Failed to add customer:', error);
      showError('Failed to add customer, please try again');
    }
  };

  // Add customer
  const handleAddCustomer = async () => {
    if (!customerForm.name) {
      showError('Please enter customer name');
      return;
    }

    try {
      // Directly use temporary photo path (if exists)
      // Temporary photo already saved to file system, only need to save path to database
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
      // Reload customer list (keep current page and search conditions)
      loadCustomerList(customerPage, customerListSearchQuery);
      showSuccess('Customer added successfully!');
    } catch (error) {
      console.error('Failed to add customer:', error);
      showError('Failed to add customer, please try again');
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
      console.error('Failed to upload driver license photo:', error);
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
        // 如果当前在客户列表页面，刷新客户列表
        if (activeTab === 'customers') {
          loadCustomerList(1, customerListSearchQuery);
        }
        // 2秒后关闭进度窗口
        setTimeout(() => {
          setImportProgress(null);
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to import customer data:', error);
      setImportResult({
        success: false,
        message: `Import failed: ${error}`,
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
      console.error('Failed to import vehicle data:', error);
      setImportResult({
        success: false,
        message: `Import failed: ${error}`,
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

  // Biometric function
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
        console.error('Failed to save face photo:', error);
        alert('Failed to save face photo');
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
        console.error('Failed to save fingerprint data:', error);
        alert('Failed to save fingerprint data');
      }
    }
  };

  const handleSignatureCaptured = async (imageData: ArrayBuffer) => {
    if (weighingForm.customer_id) {
      try {
        // Save signature image to file system (using dedicated signature save method)
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

  // If not logged in, show login interface
  if (!isLoggedIn) {
    return <LoginForm onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <>
      {/* Toast Messages - Render outside app container to avoid z-index issues */}
      {errorMessage && (
        <div 
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            backgroundColor: '#f44336',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 999999,
            maxWidth: '400px',
            minWidth: '300px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            animation: 'slideIn 0.3s ease-out',
            pointerEvents: 'auto',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          <span style={{ flex: 1, marginRight: '16px' }}>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage('')}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              fontSize: '20px',
              fontWeight: 'bold',
              cursor: 'pointer',
              padding: '0',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          >
            ×
          </button>
        </div>
      )}
      {successMessage && (
        <div 
          style={{
            position: 'fixed',
            top: errorMessage ? '80px' : '20px',
            right: '20px',
            backgroundColor: '#4caf50',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 999999,
            maxWidth: '400px',
            minWidth: '300px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            animation: 'slideIn 0.3s ease-out',
            pointerEvents: 'auto',
            fontFamily: 'Arial, sans-serif',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          <span style={{ flex: 1, marginRight: '16px' }}>{successMessage}</span>
          <button
            onClick={() => setSuccessMessage('')}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              fontSize: '20px',
              fontWeight: 'bold',
              cursor: 'pointer',
              padding: '0',
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              borderRadius: '4px',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          >
            ×
          </button>
        </div>
      )}
    <div className="app">
      <header className="header">
        <div className="header-left">
          <h1>Waste Recycling Scale System</h1>
          <div className="user-info">
            <span>Welcome, {currentUser?.username} - {currentActivation?.company_name}</span>
            {currentActivation?.expires_at && (
              <div style={{ fontSize: '12px', color: '#fff', marginTop: '4px' }}>
                Valid until: {new Date(currentActivation.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })}
              </div>
            )}
          </div>
        </div>
        <div className="header-right">
          {appVersion && (
            <span 
              style={{
                fontSize: '11px',
                color: 'rgba(255, 255, 255, 0.7)',
                marginRight: '8px',
                padding: '4px 8px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '4px',
                fontFamily: 'monospace'
              }}
              title={`Version ${appVersion}`}
            >
              v{appVersion}
            </span>
          )}
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
          <div className="weighing-section" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', position: 'relative' }}>
            {/* Save button - placed at top right */}
            <button 
              onClick={handleWeighing} 
              className="btn-primary"
              disabled={metalList.length === 0}
              style={{ 
                position: 'absolute',
                top: '0',
                right: '0',
                fontSize: '16px',
                padding: '10px 30px',
                zIndex: 10
              }}
            >
              Save
            </button>
            
            {/* Left: Weighing section */}
            <div style={{ flex: 1, minWidth: '400px' }}>
              <h2>Weighing</h2>
              
              <div className="form-group">
                <label>Metal Type:</label>
                <select 
                  value={weighingForm.metal_type_id}
                  onChange={(e) => setWeighingForm({...weighingForm, metal_type_id: e.target.value})}
                  onDoubleClick={() => setShowMetalManagement(true)}
                  required
                  title="Double-click to manage metal types"
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
                      // Dynamically adjust thumbnail size based on photo count
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
                            title="Delete Photo"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Add to list button */}
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

              {/* Metal list display */}
              {metalList.length > 0 && (
                <div className="metal-list-section" style={{ marginTop: '20px' }}>
                  <h3>Metal List ({metalList.length} items)</h3>
                  <div className="metal-list">
                    {metalList.map((item, index) => (
                      <div key={item.id} className="metal-list-item" style={{ marginBottom: '15px', padding: '15px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: item.photos && item.photos.length > 0 ? '10px' : '0' }}>
                          <div className="metal-item-info" style={{ flex: 1 }}>
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
                        {/* Display photos for this metal item */}
                        {item.photos && item.photos.length > 0 && (
                          <div style={{ 
                            display: 'flex', 
                            gap: '8px', 
                            flexWrap: 'wrap',
                            marginTop: '10px',
                            paddingTop: '10px',
                            borderTop: '1px solid #f0f0f0'
                          }}>
                            {item.photos.map((photo: any) => (
                              <div 
                                key={photo.id} 
                                style={{ 
                                  position: 'relative',
                                  width: '100px',
                                  height: '100px',
                                  flexShrink: 0
                                }}
                              >
                                <img 
                                  src={photo.preview || photo.path} 
                                  alt="Waste Photo" 
                                  style={{ 
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    borderRadius: '4px',
                                    border: '1px solid #ddd'
                                  }}
                                />
                                <button
                                  onClick={() => handleDeleteMetalItemPhoto(item.id, photo.id)}
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
                                  title="Delete Photo"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="metal-list-total">
                    <strong>Total Amount: ${metalList.reduce((sum, item) => sum + item.total_amount, 0).toFixed(2)}</strong>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Customer section */}
            <div style={{ flex: 1, minWidth: '400px' }}>
              <h2>Customer</h2>
              
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Customer:</label>
                
                {/* Search input box */}
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
                    // Delay closing to allow clicking dropdown items
                    setTimeout(() => setShowCustomerDropdown(false), 200);
                  }}
                  onDoubleClick={() => {
                    setShowQuickAddCustomerModal(true);
                    setQuickAddCustomerForm({ name: '', phone: '', address: '' });
                  }}
                  placeholder="Quick search by number or name... (Double-click to add new customer)"
                  title="Double-click to quickly add a new customer"
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
                
                {/* Search results dropdown list */}
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
                
                {/* Original dropdown selection box */}
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

              {/* Display Customer information */}
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

              {/* Display vehicle information */}
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

            {/* Driver license photo upload area */}
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

              {/* Search box */}
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

              {/* Customer list */}
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

                            {/* Vehicle information */}
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

                  {/* Pagination controls */}
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
              <button
                onClick={async () => {
                  try {
                    setRecordsLoading(true);
                    // 从云端下载最新数据
                    const result = await (window.electronAPI as any).sync.downloadFromCloud(false);
                    if (result.success) {
                      // 刷新本地数据
                      await loadRecordsData(recordsFilter.page);
                      showSuccess(`Refreshed! ${result.syncedRecords || 0} new records downloaded.`);
                    } else {
                      showError(`Failed to refresh: ${result.message}`);
                    }
                  } catch (error: any) {
                    console.error('Failed to refresh records:', error);
                    showError(`Failed to refresh: ${error?.message || 'Unknown error'}`);
                  } finally {
                    setRecordsLoading(false);
                  }
                }}
                disabled={recordsLoading}
                className="refresh-records-btn"
                title="Refresh records from cloud"
              >
                <span>🔄</span>
                <span>{recordsLoading ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
            
            {/* Filter */}
            <div className="records-filter">
              <div className="filter-row">
                <div className="filter-group">
                  <label>Start Date:</label>
                  <input
                    type="date"
                    value={recordsFilter.startDate}
                    onChange={(e) => {
                      const newStartDate = e.target.value;
                      const newFilter = {...recordsFilter, startDate: newStartDate};
                      setRecordsFilter(newFilter);
                      // 如果两个日期都选择了，自动应用筛选
                      if (newStartDate && newFilter.endDate) {
                        loadRecordsData(1, newFilter);
                      }
                    }}
                  />
                </div>
                <div className="filter-group">
                  <label>End Date:</label>
                  <input
                    type="date"
                    value={recordsFilter.endDate}
                    onChange={(e) => {
                      const newEndDate = e.target.value;
                      const newFilter = {...recordsFilter, endDate: newEndDate};
                      setRecordsFilter(newFilter);
                      // 如果两个日期都选择了，自动应用筛选
                      if (newFilter.startDate && newEndDate) {
                        loadRecordsData(1, newFilter);
                      }
                    }}
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
                  <button onClick={resetRecordsFilter} className="reset-filter-btn">
                    Reset
                  </button>
                  {recordsFilter.startDate && recordsFilter.endDate && (
                    <>
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
                            alert(`Failed to generate report: ${error.message || 'Unknown error'}`);
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
                      {recordsLoading ? 'Generating...' : 'Generate Report'}
                    </button>
                    <button 
                        onClick={async () => {
                          try {
                            // 先获取要生成的报告数量
                            const count = await (window.electronAPI as any).report.getBatchReportCount(
                              recordsFilter.startDate,
                              recordsFilter.endDate,
                              recordsFilter.customerName || undefined
                            );
                            
                            // 如果数量大于20，显示确认对话框
                            if (count > 20) {
                              setBatchReportCount(count);
                              setPendingBatchParams({
                                startDate: recordsFilter.startDate,
                                endDate: recordsFilter.endDate,
                                customerName: recordsFilter.customerName || undefined
                              });
                              setShowBatchConfirmDialog(true);
                              return;
                            }
                            
                            // 如果数量小于等于20，直接生成
                            await startBatchReportGeneration(
                              recordsFilter.startDate,
                              recordsFilter.endDate,
                              recordsFilter.customerName || undefined
                            );
                          } catch (error: any) {
                            console.error('Failed to check batch report count:', error);
                            alert(`Failed to check report count: ${error.message || 'Unknown error'}`);
                          }
                        }}
                        className="generate-report-btn"
                        disabled={recordsLoading}
                        style={{
                          backgroundColor: recordsLoading ? '#6c757d' : '#dc3545',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '4px',
                          fontSize: '14px',
                          fontWeight: '500',
                          cursor: recordsLoading ? 'not-allowed' : 'pointer',
                          transition: 'background-color 0.2s',
                          marginLeft: '10px'
                        }}
                      >
                        {recordsLoading 
                          ? (batchProgress 
                              ? `Generating ${batchProgress.current}/${batchProgress.total}...` 
                              : 'Generating...') 
                          : 'Generate All Police Reports'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Record list */}
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
                      </div>
                      {expandedRecord === session.id && (
                        <SessionDetails 
                          sessionId={session.id} 
                          onContinue={async (sessionId) => {
                            try {
                              // 加载session数据
                              const sessionData = await window.electronAPI.weighingSessions.getById(sessionId);
                              const weighings = await window.electronAPI.weighings.getBySession(sessionId);
                              
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
                                  
                                  // 加载已有的biometric数据（如果存在）
                                  await loadBiometricData();
                                } catch (error) {
                                  console.error('Failed to load customer details:', error);
                                }
                              } else {
                                // 如果没有客户，清空相关状态
                                setSelectedCustomer(null);
                                setCustomerVehicles([]);
                                setBiometricData(null);
                                setBiometricImageCache({});
                                setBiometricImageErrors({});
                              }
                              
                              // Restore metal list with photos
                              const restoredMetalList = await Promise.all(
                                weighings.map(async (w: any, index: number) => {
                                  const photos: any[] = [];
                                  
                                  // If this weighing has a photo, load it
                                  if (w.product_photo_path) {
                                    try {
                                      const preview = await window.electronAPI.image.readFile(w.product_photo_path);
                                      photos.push({
                                        id: Date.now() + index,
                                        path: w.product_photo_path,
                                        preview: preview || ''
                                      });
                                    } catch (error) {
                                      console.error('Failed to load photo preview:', error);
                                      // Still add photo with path even if preview fails
                                      photos.push({
                                        id: Date.now() + index,
                                        path: w.product_photo_path,
                                        preview: ''
                                      });
                                    }
                                  }
                                  
                                  return {
                                    id: Date.now() + index, // Generate temporary ID
                                    metal_type_id: w.waste_type_id,
                                    metal_type_name: w.waste_type_name || w.metal_symbol || 'Unknown',
                                    grossWeight: 0, // Not saved in database, set to 0
                                    tareWeight: 0, // Not saved in database, set to 0
                                    weight: parseFloat(w.weight) || 0, // Ensure is number
                                    unit_price: parseFloat(w.unit_price) || 0, // Ensure is number
                                    total_amount: parseFloat(w.total_amount) || 0, // Ensure is number
                                    photos: photos // Associate photos with this metal item
                                  };
                                })
                              );
                              setMetalList(restoredMetalList);
                              setWastePhotos([]); // Clear form photos
                              
                              // 设置编辑状态
                              setEditingSessionId(sessionId);
                              
                              // 切换到Weighing页面
                              setActiveTab('weighing');
                              
                              // 更新unfinished数量
                              await loadUnfinishedCount();
                            } catch (error) {
                              console.error('Failed to load session data:', error);
                              alert('Failed to load session data');
                            }
                          }}
                          onDelete={async (sessionId) => {
                            try {
                              await window.electronAPI.weighingSessions.delete(sessionId);
                              // 关闭详情
                              setExpandedRecord(null);
                              // 刷新Records列表（使用当前页码和过滤器）
                              await loadRecordsData(recordsFilter.page, recordsFilter);
                              // 更新unfinished数量
                              await loadUnfinishedCount();
                              alert('Session deleted successfully');
                            } catch (error: any) {
                              console.error('Failed to delete session:', error);
                              alert(`Failed to delete session: ${error.message || 'Unknown error'}`);
                            }
                          }}
                        />
                      )}
                    </div>
                  ))}
                  
                  {/* Pagination controls */}
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

      {/* Biometric component */}
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

      {/* Settings component */}
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


      {/* Waste photo camera component */}
      {showWasteCamera && (
        <CameraCapture
          onCapture={handleWastePhotoCaptured}
          onClose={() => setShowWasteCamera(false)}
        />
      )}

      {/* Import progress window */}
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

      {/* Quick add customer modal */}
      {showQuickAddCustomerModal && (
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
        }} onClick={() => setShowQuickAddCustomerModal(false)}>
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
            <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#333' }}>Quick Add Customer</h2>
            
            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                Customer Name <span style={{ color: 'red' }}>*</span>
              </label>
              <input
                type="text"
                value={quickAddCustomerForm.name}
                onChange={(e) => setQuickAddCustomerForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter customer name"
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #ddd',
                  fontSize: '14px'
                }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickAddCustomerForm.name.trim()) {
                    handleQuickAddCustomer();
                  }
                }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                Phone Number
              </label>
              <input
                type="text"
                value={quickAddCustomerForm.phone}
                onChange={(e) => setQuickAddCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="Enter phone number (optional)"
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #ddd',
                  fontSize: '14px'
                }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', color: '#333' }}>
                Address
              </label>
              <input
                type="text"
                value={quickAddCustomerForm.address}
                onChange={(e) => setQuickAddCustomerForm(prev => ({ ...prev, address: e.target.value }))}
                placeholder="Enter address (optional)"
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid #ddd',
                  fontSize: '14px'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowQuickAddCustomerModal(false);
                  setQuickAddCustomerForm({ name: '', phone: '', address: '' });
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
                onClick={handleQuickAddCustomer}
                style={{
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Add Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add vehicle modal */}
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

      {/* 关闭时同步提示对话框 */}
      {showClosingSyncDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10001
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '10px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            textAlign: 'center'
          }}>
            <div style={{
              marginBottom: '20px',
              fontSize: '48px'
            }}>
              ⏳
            </div>
            <h2 style={{
              marginTop: 0,
              marginBottom: '15px',
              color: '#333',
              fontSize: '18px',
              fontWeight: '600'
            }}>
              Syncing data
            </h2>
            <p style={{
              marginBottom: 0,
              color: '#666',
              fontSize: '14px',
              lineHeight: '1.6'
            }}>
              {closingSyncMessage}
            </p>
          </div>
        </div>
      )}

    </div>
    </>
  );
}

export default App;
