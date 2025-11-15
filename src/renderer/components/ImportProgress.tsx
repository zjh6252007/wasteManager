import React from 'react';
import './ImportProgress.css';

interface ImportProgressProps {
  isVisible: boolean;
  progress: number;
  current: number;
  total: number;
  message: string;
  onClose?: () => void;
}

const ImportProgress: React.FC<ImportProgressProps> = ({
  isVisible,
  progress,
  current,
  total,
  message,
  onClose
}) => {
  if (!isVisible) return null;

  return (
    <div className="import-progress-overlay">
      <div className="import-progress-modal">
        <div className="import-progress-header">
          <h3>Importing Data</h3>
          {onClose && (
            <button onClick={onClose} className="close-btn" disabled={progress < 100}>
              ×
            </button>
          )}
        </div>
        
        <div className="import-progress-content">
          <div className="progress-info">
            <div className="progress-message">{message}</div>
            <div className="progress-stats">
              {current} / {total} items
            </div>
          </div>
          
          <div className="progress-bar-container">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="progress-percentage">
              {Math.round(progress)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportProgress;

