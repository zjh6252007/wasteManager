import React, { useEffect, useState } from 'react';
import './FingerprintCapture.css';

interface FingerprintCaptureProps {
  onCapture: (template: ArrayBuffer, imageData?: ArrayBuffer) => void;
  onClose: () => void;
}

const FingerprintCapture: React.FC<FingerprintCaptureProps> = ({ onCapture, onClose }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [status, setStatus] = useState('Initializing fingerprint device...');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    initializeFingerprint();
    return () => {
      stopCapture();
    };
  }, []);

  const initializeFingerprint = async () => {
    try {
      setStatus('Initializing fingerprint device...');
      const success = await window.electronAPI.fingerprint.init();
      if (success) {
        setIsInitialized(true);
        setStatus('Fingerprint device ready, please place finger');
        startCapture();
      } else {
        setStatus('Fingerprint device initialization failed');
      }
    } catch (error) {
      console.error('Failed to initialize fingerprint device:', error);
      setStatus('Fingerprint device initialization failed: ' + error);
    }
  };

  const startCapture = async () => {
    try {
      setStatus('Starting fingerprint capture...');
      setIsCapturing(true);
      setProgress(0);
      
      const success = await window.electronAPI.fingerprint.startCapture();
      if (success) {
        setStatus('Please place finger on fingerprint device...');
        captureFingerprint();
      } else {
        setStatus('Failed to start fingerprint capture');
        setIsCapturing(false);
      }
    } catch (error) {
      console.error('Failed to start fingerprint capture:', error);
      setStatus('Failed to start fingerprint capture: ' + error);
      setIsCapturing(false);
    }
  };

  const captureFingerprint = async () => {
    try {
      setStatus('Capturing fingerprint...');
      
      // Simulate capture progress
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
        setStatus('Fingerprint captured successfully!');
        onCapture(result.template, result.imageData);
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        // Check if it's Windows exclusive or unsupported error
        if (result.error && (result.error.includes('Windows system exclusive') || result.error.includes('Windows系统独占') || result.error.includes('does not support direct USB access') || result.error.includes('不支持直接USB访问'))) {
          setStatus('Device does not support direct USB access. May need: 1) Device-specific driver and SDK 2) Check Device Manager status');
          setIsCapturing(false);
        } else {
          setStatus('Fingerprint capture failed: ' + (result.error || 'Unknown error'));
          setIsCapturing(false);
        }
      }
    } catch (error) {
      console.error('Fingerprint capture failed:', error);
      setStatus('Fingerprint capture failed: ' + error);
      setIsCapturing(false);
    }
  };

  const stopCapture = async () => {
    try {
      await window.electronAPI.fingerprint.stopCapture();
    } catch (error) {
      console.error('Failed to stop fingerprint capture:', error);
    }
  };

  const retryCapture = () => {
    setProgress(0);
    setStatus('Please place finger on fingerprint device...');
    captureFingerprint();
  };

  return (
    <div className="fingerprint-capture-overlay">
      <div className="fingerprint-capture-modal">
        <div className="fingerprint-header">
          <h3>Fingerprint Capture</h3>
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
                {isCapturing ? 'Please keep finger steady' : 'Please place finger on fingerprint device'}
              </div>
            </div>
          </div>

          <div className="fingerprint-actions">
            {!isCapturing && isInitialized && (
              <button 
                onClick={retryCapture}
                className="retry-btn"
              >
                Retry Capture
              </button>
            )}
            <button 
              onClick={onClose} 
              className="cancel-btn"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FingerprintCapture;
