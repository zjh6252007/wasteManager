import React, { useEffect, useState } from 'react';
import './FingerprintCapture.css';

interface FingerprintCaptureProps {
  onCapture: (template: ArrayBuffer, imageData?: ArrayBuffer) => void;
  onClose: () => void;
}

const FingerprintCapture: React.FC<FingerprintCaptureProps> = ({ onCapture, onClose }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [status, setStatus] = useState('正在初始化指纹板...');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    initializeFingerprint();
    return () => {
      stopCapture();
    };
  }, []);

  const initializeFingerprint = async () => {
    try {
      setStatus('正在初始化指纹板...');
      const success = await window.electronAPI.fingerprint.init();
      if (success) {
        setIsInitialized(true);
        setStatus('指纹板已就绪，请放置手指');
        startCapture();
      } else {
        setStatus('指纹板初始化失败');
      }
    } catch (error) {
      console.error('初始化指纹板失败:', error);
      setStatus('指纹板初始化失败: ' + error);
    }
  };

  const startCapture = async () => {
    try {
      setStatus('开始指纹采集...');
      setIsCapturing(true);
      setProgress(0);
      
      const success = await window.electronAPI.fingerprint.startCapture();
      if (success) {
        setStatus('请将手指放在指纹板上...');
        captureFingerprint();
      } else {
        setStatus('启动指纹采集失败');
        setIsCapturing(false);
      }
    } catch (error) {
      console.error('启动指纹采集失败:', error);
      setStatus('启动指纹采集失败: ' + error);
      setIsCapturing(false);
    }
  };

  const captureFingerprint = async () => {
    try {
      setStatus('正在采集指纹...');
      
      // 模拟采集进度
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);

      const result = await window.electronAPI.fingerprint.capture();
      
      clearInterval(progressInterval);
      setProgress(100);

      if (result.success) {
        setStatus('指纹采集成功！');
        onCapture(result.template, result.imageData);
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        // 检查是否是Windows独占或不支持错误
        if (result.error && (result.error.includes('Windows系统独占') || result.error.includes('不支持直接USB访问') || result.error.includes('不支持直接USB访问'))) {
          setStatus('设备不支持直接USB访问。可能需要：1) 设备专用驱动和SDK 2) 检查设备管理器状态');
          setIsCapturing(false);
        } else {
          setStatus('指纹采集失败: ' + (result.error || '未知错误'));
          setIsCapturing(false);
        }
      }
    } catch (error) {
      console.error('指纹采集失败:', error);
      setStatus('指纹采集失败: ' + error);
      setIsCapturing(false);
    }
  };

  const stopCapture = async () => {
    try {
      await window.electronAPI.fingerprint.stopCapture();
    } catch (error) {
      console.error('停止指纹采集失败:', error);
    }
  };

  const retryCapture = () => {
    setProgress(0);
    setStatus('请将手指放在指纹板上...');
    captureFingerprint();
  };

  return (
    <div className="fingerprint-capture-overlay">
      <div className="fingerprint-capture-modal">
        <div className="fingerprint-header">
          <h3>指纹采集</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="fingerprint-content">
          <div className="fingerprint-status">
            <div className="status-text">{status}</div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="fingerprint-visual">
            <div className="fingerprint-placeholder">
              <div className="fingerprint-icon">
                {isCapturing ? '👆' : '👋'}
              </div>
              <div className="fingerprint-instructions">
                {isCapturing ? '请保持手指稳定' : '请将手指放在指纹板上'}
              </div>
            </div>
          </div>

          <div className="fingerprint-actions">
            {!isCapturing && isInitialized && (
              <button 
                onClick={retryCapture}
                className="retry-btn"
              >
                重新采集
              </button>
            )}
            <button 
              onClick={onClose} 
              className="cancel-btn"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FingerprintCapture;
