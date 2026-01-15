import React, { useRef, useEffect, useState } from 'react';
import './CameraCapture.css';

interface CameraCaptureProps {
  onCapture: (imageData: ArrayBuffer) => void;
  onClose: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initializeCamera();
    return () => {
      stopCamera();
    };
  }, []);

  // 当选择的设备ID变化时，重新启动摄像头（但跳过初始化时的第一次设置）
  useEffect(() => {
    if (isInitialized && selectedDeviceId && devices.length > 0) {
      startCamera(selectedDeviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  const initializeCamera = async () => {
    try {
      // 获取摄像头设备列表
      const deviceList = await window.electronAPI.camera.getDevices();
      const videoDevices = deviceList.filter(device => device.kind === 'videoinput');
      setDevices(videoDevices);
      
      // 如果有设备，启动默认摄像头
      if (videoDevices.length > 0) {
        const success = await window.electronAPI.camera.start();
        if (success) {
          // 使用第一个设备作为默认设备
          const defaultDeviceId = videoDevices[0].deviceId;
          setSelectedDeviceId(defaultDeviceId);
          await startCamera(defaultDeviceId);
          setIsInitialized(true);
        }
      } else {
        setIsInitialized(true);
      }
    } catch (error) {
      console.error('Failed to initialize camera:', error);
      setIsInitialized(true);
    }
  };

  const startCamera = async (deviceId?: string) => {
    try {
      // 先停止当前流
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Failed to start camera:', error);
      alert('Failed to start camera. Please check camera permissions.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    window.electronAPI.camera.stop();
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsCapturing(true);
    
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      
      if (!ctx) {
        setIsCapturing(false);
        return;
      }

      // 优化：限制最大尺寸以提高处理速度（保持宽高比）
      const maxWidth = 1280;
      const maxHeight = 960;
      let canvasWidth = video.videoWidth;
      let canvasHeight = video.videoHeight;
      
      if (canvasWidth > maxWidth || canvasHeight > maxHeight) {
        const aspectRatio = canvasWidth / canvasHeight;
        if (canvasWidth > canvasHeight) {
          canvasWidth = maxWidth;
          canvasHeight = maxWidth / aspectRatio;
        } else {
          canvasHeight = maxHeight;
          canvasWidth = maxHeight * aspectRatio;
        }
      }

      // 设置画布尺寸
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // 绘制视频帧到画布（使用优化后的尺寸）
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 优化：使用较低质量但更快的压缩，并直接转换为ArrayBuffer
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              blob.arrayBuffer().then(resolve).catch(reject);
            } else {
              reject(new Error('Failed to create blob'));
            }
          },
          'image/jpeg',
          0.75 // 降低质量以加快处理速度（0.75是质量和速度的平衡点）
        );
      });
      
      // 直接调用回调函数，不需要等待主进程
      onCapture(arrayBuffer);
      
      // 关闭摄像头
      stopCamera();
      onClose();
    } catch (error) {
      console.error('Failed to capture photo:', error);
      setIsCapturing(false);
    }
  };


  const handleDeviceChange = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    // useEffect 会自动处理摄像头切换
  };

  return (
    <div className="camera-capture-overlay">
      <div className="camera-capture-modal">
        <div className="camera-header">
          <h3>拍照识别</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="camera-controls">
          {devices.length > 0 && (
            <select 
              value={selectedDeviceId} 
              onChange={(e) => handleDeviceChange(e.target.value)}
              className="device-selector"
            >
              {devices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="camera-preview">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted
            className="camera-video"
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>

        <div className="camera-actions">
          <button 
            onClick={capturePhoto} 
            disabled={isCapturing}
            className="capture-btn"
          >
            {isCapturing ? '拍照中...' : '拍照'}
          </button>
          <button onClick={onClose} className="cancel-btn">
            取消
          </button>
        </div>
      </div>
    </div>
  );
};

export default CameraCapture;
