import React, { useRef, useEffect, useState } from 'react';
import './SignatureCapture.css';

interface SignatureCaptureProps {
  onCapture: (imageData: ArrayBuffer) => void;
  onClose: () => void;
}

const SignatureCapture: React.FC<SignatureCaptureProps> = ({ onCapture, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const [hasSignature, setHasSignature] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const isCursorLockedRef = useRef(false);

  useEffect(() => {
    initializeTablet();
    return () => {
      cleanup();
    };
  }, []);

  // 确保组件卸载时解锁鼠标
  useEffect(() => {
    return () => {
      if (isCursorLockedRef.current) {
        window.electronAPI.tablet.unlockCursor().catch(console.error);
        isCursorLockedRef.current = false;
      }
    };
  }, []);

  const initializeTablet = async () => {
    try {
      await window.electronAPI.tablet.init();
      await window.electronAPI.tablet.startCapture();
    } catch (error) {
      console.error('Failed to initialize tablet:', error);
    }
  };

  const cleanup = async () => {
    try {
      // 确保解锁鼠标
      if (isCursorLockedRef.current) {
        try {
          await window.electronAPI.tablet.unlockCursor();
          isCursorLockedRef.current = false;
        } catch (error) {
          console.error('Failed to unlock cursor during cleanup:', error);
        }
      }
      await window.electronAPI.tablet.stopCapture();
    } catch (error) {
      console.error('Failed to stop tablet:', error);
    }
  };

  // 监听手写板的输入事件
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置画布（只在初始化时设置一次）
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = 800;
      canvas.height = 300;
    }
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const startDrawing = async (e: MouseEvent | TouchEvent) => {
      e.preventDefault(); // 防止默认行为
      isDrawingRef.current = true;
      setHasSignature(true);
      const rect = canvas.getBoundingClientRect();
      
      // 锁定鼠标到画布区域
      if (!isCursorLockedRef.current && !('touches' in e)) {
        try {
          const container = containerRef.current;
          if (container) {
            const containerRect = container.getBoundingClientRect();
            // 添加一些边距，确保鼠标不会卡在边界
            const margin = 5;
            const result = await window.electronAPI.tablet.lockCursor({
              x: containerRect.left - margin,
              y: containerRect.top - margin,
              width: containerRect.width + margin * 2,
              height: containerRect.height + margin * 2
            });
            if (result.success) {
              isCursorLockedRef.current = true;
              console.log('Cursor locked successfully');
            } else {
              console.warn('Failed to lock cursor:', result.error);
            }
          }
        } catch (error) {
          console.error('Failed to lock cursor:', error);
        }
      }
      
      // 无论从哪里开始，都从画布的固定位置开始（左上角偏移一点，避免从边界开始）
      const startOffset = 10; // 从左上角偏移10像素开始
      lastXRef.current = startOffset;
      lastYRef.current = startOffset;
      
      // 在起始位置画一个小点，确保有起始标记
      ctx.beginPath();
      ctx.arc(startOffset, startOffset, 1, 0, 2 * Math.PI);
      ctx.fill();
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      e.preventDefault(); // 防止默认行为
      if (!isDrawingRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      let clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      let clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      
      // 限制鼠标在画布区域内
      if (!('touches' in e)) {
        clientX = Math.max(rect.left, Math.min(rect.right, clientX));
        clientY = Math.max(rect.top, Math.min(rect.bottom, clientY));
      }
      
      const currentX = clientX - rect.left;
      const currentY = clientY - rect.top;
      
      // 确保坐标在画布范围内
      const clampedX = Math.max(0, Math.min(canvas.width, currentX));
      const clampedY = Math.max(0, Math.min(canvas.height, currentY));
      
      // 如果是第一次移动（从固定起始位置开始），直接移动到当前位置
      // 否则从上一个位置连线到当前位置
      if (lastXRef.current === 10 && lastYRef.current === 10) {
        // 第一次移动，从起始位置移动到当前位置
        ctx.beginPath();
        ctx.moveTo(lastXRef.current, lastYRef.current);
        ctx.lineTo(clampedX, clampedY);
        ctx.stroke();
      } else {
        // 正常绘制，从上一个位置连线
        ctx.beginPath();
        ctx.moveTo(lastXRef.current, lastYRef.current);
        ctx.lineTo(clampedX, clampedY);
        ctx.stroke();
      }

      lastXRef.current = clampedX;
      lastYRef.current = clampedY;
    };

    const stopDrawing = async (e: MouseEvent | TouchEvent) => {
      e.preventDefault(); // 防止默认行为
      isDrawingRef.current = false;
      
      // 解锁鼠标
      if (isCursorLockedRef.current && !('touches' in e)) {
        try {
          await window.electronAPI.tablet.unlockCursor();
          isCursorLockedRef.current = false;
        } catch (error) {
          console.error('Failed to unlock cursor:', error);
        }
      }
    };

    // 鼠标事件
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // 触摸事件（用于手写板）
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });
    canvas.addEventListener('touchcancel', stopDrawing, { passive: false });

    // 监听手写板的IPC消息
    const electronAPI = window.electronAPI as any;
    let handleTabletData: ((event: any, data: any) => void) | null = null;
    
    if (electronAPI && electronAPI.ipc) {
      handleTabletData = (event: any, data: any) => {
        // 处理手写板数据
        if (data.x !== undefined && data.y !== undefined) {
          const x = (data.x / data.maxX) * canvas.width;
          const y = (data.y / data.maxY) * canvas.height;
          
          if (data.pressure > 0) {
            if (!isDrawingRef.current) {
              isDrawingRef.current = true;
              setHasSignature(true);
            }
            ctx.beginPath();
            ctx.moveTo(lastXRef.current, lastYRef.current);
            ctx.lineTo(x, y);
            ctx.stroke();
            lastXRef.current = x;
            lastYRef.current = y;
          } else {
            isDrawingRef.current = false;
          }
        }
      };

      electronAPI.ipc.on('tablet:data', handleTabletData);
    }

    return () => {
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('mouseleave', stopDrawing);
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDrawing);
      canvas.removeEventListener('touchcancel', stopDrawing);
      if (handleTabletData && electronAPI && electronAPI.ipc) {
        electronAPI.ipc.removeListener('tablet:data', handleTabletData);
      }
    };
  }, []); // 空依赖数组，只在组件挂载时执行一次

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const captureSignature = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;

    setIsCapturing(true);
    
    try {
      // 将画布转换为Blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        }, 'image/png', 1.0);
      });

      // 转换为ArrayBuffer
      const arrayBuffer = await blob.arrayBuffer();
      
      // 调用回调函数
      onCapture(arrayBuffer);
      
      // 清理
      await cleanup();
      onClose();
    } catch (error) {
      console.error('Failed to capture signature:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="signature-capture-overlay">
      <div className="signature-capture-modal">
        <div className="signature-header">
          <h3>Signature Capture</h3>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <div className="signature-instructions">
          <p>Please sign in the box below using your handwriting tablet</p>
        </div>

        <div 
          ref={containerRef}
          className="signature-canvas-container"
          onMouseLeave={async () => {
            // 当鼠标离开容器时解锁
            if (isCursorLockedRef.current) {
              try {
                await window.electronAPI.tablet.unlockCursor();
                isCursorLockedRef.current = false;
              } catch (error) {
                console.error('Failed to unlock cursor:', error);
              }
            }
          }}
        >
          <canvas 
            ref={canvasRef}
            className="signature-canvas"
          />
        </div>

        <div className="signature-actions">
          <button 
            onClick={clearSignature}
            className="clear-btn"
            disabled={!hasSignature || isCapturing}
          >
            Clear
          </button>
          <button 
            onClick={captureSignature} 
            disabled={!hasSignature || isCapturing}
            className="capture-btn"
          >
            {isCapturing ? 'Capturing...' : 'Capture Signature'}
          </button>
          <button onClick={onClose} className="cancel-btn">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignatureCapture;

