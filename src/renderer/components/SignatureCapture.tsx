import React, { useRef, useEffect, useState } from 'react';
import './SignatureCapture.css';

interface SignatureCaptureProps {
  onCapture: (imageData: ArrayBuffer) => void;
  onClose: () => void;
}

// Global callback function for SigWeb GetSigImageB64
(window as any).__sigImageCallback = function(base64Str: string) {
  if ((window as any).__sigImageCallbackResolve) {
    (window as any).__sigImageCallbackResolve(base64Str);
    (window as any).__sigImageCallbackResolve = null;
  }
};

const SignatureCapture: React.FC<SignatureCaptureProps> = ({ onCapture, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const [hasSignature, setHasSignature] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [sigWebActive, setSigWebActive] = useState(false); // Track if SigWeb device is active
  
  // 屏幕尺寸（用于坐标映射）
  const screenSizeRef = useRef({ width: 1920, height: 1080 });

  useEffect(() => {
    initializeTablet();
    return () => {
      cleanup();
    };
  }, []);

  const initializeTablet = async () => {
    try {
      console.log('[SignatureCapture] ========== Initializing Signature Capture ==========');
      
      // 获取屏幕尺寸
      if (window.screen) {
        screenSizeRef.current = {
          width: window.screen.width,
          height: window.screen.height
        };
        console.log('[SignatureCapture] Screen size detected:', screenSizeRef.current);
      }
      
      // Step 1: Check if SigWebTablet.js is loaded
      console.log('[SignatureCapture] Step 1: Checking if SigWebTablet.js is loaded...');
      const sigWebFunctions = {
        IsSigWebInstalled: typeof (window as any).IsSigWebInstalled,
        SetTabletState: typeof (window as any).SetTabletState,
        GetTabletState: typeof (window as any).GetTabletState,
        SigWebSetDisplayTarget: typeof (window as any).SigWebSetDisplayTarget,
        SetDisplayXSize: typeof (window as any).SetDisplayXSize,
        SetDisplayYSize: typeof (window as any).SetDisplayYSize,
        SigWebRefresh: typeof (window as any).SigWebRefresh,
      };
      console.log('[SignatureCapture] Available SigWeb functions:', sigWebFunctions);
      
      if (typeof (window as any).IsSigWebInstalled !== 'function') {
        console.warn('[SignatureCapture] ⚠ SigWebTablet.js not loaded!');
        console.warn('[SignatureCapture] Please check:');
        console.warn('[SignatureCapture] 1. SigWebTablet.js file exists in .vite/renderer/');
        console.warn('[SignatureCapture] 2. HTML file includes <script src="./SigWebTablet.js"></script>');
        console.warn('[SignatureCapture] 3. Browser console shows no 404 errors for SigWebTablet.js');
        console.log('[SignatureCapture] → Using mouse/touch input fallback');
      } else {
        // Step 2: Check SigWeb Service
        console.log('[SignatureCapture] Step 2: Checking SigWeb Service...');
        let sigWebServiceAvailable = false;
        try {
          sigWebServiceAvailable = (window as any).IsSigWebInstalled();
          console.log('[SignatureCapture] SigWeb Service available:', sigWebServiceAvailable);
        } catch (error) {
          console.error('[SignatureCapture] Error checking SigWeb Service:', error);
        }
        
        if (!sigWebServiceAvailable) {
          console.warn('[SignatureCapture] ⚠ SigWeb Service is not running!');
          console.warn('[SignatureCapture] Please:');
          console.warn('[SignatureCapture] 1. Restart SigWeb Service (see restart-sigweb.ps1)');
          console.warn('[SignatureCapture] 2. Check ports 47289/47290 are listening');
          console.log('[SignatureCapture] → Using mouse/touch input fallback');
        } else {
          // Step 3: Try to initialize SigWeb
          console.log('[SignatureCapture] Step 3: Initializing SigWeb tablet...');
          const canvas = canvasRef.current;
          if (canvas && typeof (window as any).SetTabletState === 'function') {
            try {
              const ctx = canvas.getContext('2d');
              if (ctx) {
                // Step 3.1: Reset device first (if Reset function exists)
                if (typeof (window as any).Reset === 'function') {
                  try {
                    console.log('[SignatureCapture] Resetting device...');
                    (window as any).Reset();
                    console.log('[SignatureCapture] Device reset completed');
                    // Wait a bit for reset to complete
                    await new Promise(resolve => setTimeout(resolve, 500));
                  } catch (resetError) {
                    console.warn('[SignatureCapture] Reset failed (may be normal):', resetError);
                  }
                }
                
                // Step 3.2: Check initial tablet state
                let initialState = '0';
                if (typeof (window as any).GetTabletState === 'function') {
                  try {
                    initialState = (window as any).GetTabletState();
                    console.log('[SignatureCapture] Initial tablet state:', initialState);
                    // Trim whitespace and newlines
                    initialState = String(initialState).trim();
                  } catch (stateError) {
                    console.warn('[SignatureCapture] Could not get initial state:', stateError);
                  }
                }
                
                // Step 3.3: Set display target and size BEFORE activation
                console.log('[SignatureCapture] Setting display target and size...');
                if (typeof (window as any).SigWebSetDisplayTarget === 'function') {
                  (window as any).SigWebSetDisplayTarget(ctx);
                  console.log('[SignatureCapture] Display target set');
                }
                if (typeof (window as any).SetDisplayXSize === 'function' && typeof (window as any).SetDisplayYSize === 'function') {
                  (window as any).SetDisplayXSize(canvas.width);
                  (window as any).SetDisplayYSize(canvas.height);
                  console.log('[SignatureCapture] Display size set to:', canvas.width, 'x', canvas.height);
                }
                
                // Step 3.4: Activate tablet with retry logic
                console.log('[SignatureCapture] Activating tablet...');
                let tmr: any = null;
                let activationSuccess = false;
                const maxRetries = 3;
                
                for (let retry = 0; retry < maxRetries; retry++) {
                  if (retry > 0) {
                    console.log(`[SignatureCapture] Retry ${retry}/${maxRetries - 1}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                  }
                  
                  try {
                    tmr = (window as any).SetTabletState(1, ctx, 50);
                    (window as any).__sigWebTimer = tmr;
                    
                    if (tmr) {
                      console.log('[SignatureCapture] ✓ SetTabletState returned timer:', tmr);
                      activationSuccess = true;
                      break;
                    } else {
                      console.warn(`[SignatureCapture] ⚠ SetTabletState returned null (attempt ${retry + 1}/${maxRetries})`);
                      
                      // Check state after failed activation
                      if (typeof (window as any).GetTabletState === 'function') {
                        try {
                          const stateAfter = String((window as any).GetTabletState()).trim();
                          console.log('[SignatureCapture] Tablet state after failed activation:', stateAfter);
                          if (stateAfter === '1' || stateAfter === '1\n' || parseInt(stateAfter) === 1) {
                            console.log('[SignatureCapture] ✓ Device state is 1, device may be ready!');
                            activationSuccess = true;
                            // Create a dummy timer to keep refresh going
                            tmr = setInterval(() => {
                              if (typeof (window as any).SigWebRefresh === 'function') {
                                try {
                                  (window as any).SigWebRefresh();
                                } catch (e) {
                                  // Ignore refresh errors
                                }
                              }
                            }, 50);
                            (window as any).__sigWebTimer = tmr;
                            break;
                          }
                        } catch (e) {
                          // Ignore state check errors
                        }
                      }
                    }
                  } catch (activationError) {
                    console.error(`[SignatureCapture] Activation error (attempt ${retry + 1}):`, activationError);
                  }
                }
                
                if (activationSuccess && tmr) {
                  console.log('[SignatureCapture] ✓✓✓ SigWeb tablet activated successfully!');
                  console.log('[SignatureCapture] ✓✓✓ You can now sign on the signature pad device');
                  setSigWebActive(true); // Mark SigWeb as active - disable mouse input
                  
                  // Verify after delay
                  setTimeout(() => {
                    try {
                      if (typeof (window as any).GetTabletState === 'function') {
                        const state = String((window as any).GetTabletState()).trim();
                        console.log('[SignatureCapture] Tablet state (verification):', state);
                        if (state === '1' || state === '1\n' || parseInt(state) === 1) {
                          console.log('[SignatureCapture] ✓✓✓✓ Device confirmed ready! Sign on the pad now!');
                          setSigWebActive(true);
                        } else {
                          console.warn('[SignatureCapture] ⚠ State verification: device state is', state);
                          console.warn('[SignatureCapture] Device may still work - try signing on the pad');
                          // Still mark as active if we got a timer
                          setSigWebActive(true);
                        }
                      }
                    } catch (e) {
                      console.warn('[SignatureCapture] Could not verify state:', e);
                    }
                  }, 1500);
                } else {
                  console.error('[SignatureCapture] ❌ Failed to activate tablet after', maxRetries, 'attempts');
                  console.error('[SignatureCapture] Possible reasons:');
                  console.error('[SignatureCapture]   1. Device not connected via USB');
                  console.error('[SignatureCapture]   2. Device not recognized by SigWeb Service');
                  console.error('[SignatureCapture]   3. Device driver issue');
                  console.error('[SignatureCapture]   4. SigWeb Service needs restart');
                  console.error('[SignatureCapture] → Mouse/touch input will still work as fallback');
                }
              }
            } catch (error) {
              console.error('[SignatureCapture] Error activating SigWeb:', error);
              console.log('[SignatureCapture] → Using mouse/touch input fallback');
            }
          }
        }
      }
      
      // Enable mouse/touch input as fallback (only if SigWeb is not active)
      if (!sigWebActive) {
        console.log('[SignatureCapture] Step 4: Mouse/touch input enabled as fallback');
        console.log('[SignatureCapture] ✓ You can sign using:');
        console.log('[SignatureCapture]   - Mouse (click and drag on canvas)');
        console.log('[SignatureCapture]   - Touch screen (touch and drag)');
        console.log('[SignatureCapture]   - Pen/stylus (if supported)');
      } else {
        console.log('[SignatureCapture] Step 4: SigWeb device is active - mouse input disabled');
        console.log('[SignatureCapture] ✓ Please sign using the signature pad device only');
      }
      console.log('[SignatureCapture] ========== Initialization Complete ==========');
      console.log('[SignatureCapture] Ready for signature capture!');
      
    } catch (error) {
      console.error('[SignatureCapture] ❌ Failed to initialize:', error);
      console.log('[SignatureCapture] → Mouse/touch input will still work');
    }
  };

  const cleanup = async () => {
    try {
      // Clean up SigWeb if it was used
      if (typeof (window as any).SetTabletState === 'function' && (window as any).__sigWebTimer) {
        console.log('[SignatureCapture] Deactivating SigWeb tablet...');
        setSigWebActive(false); // Reset state
        (window as any).SetTabletState(0, (window as any).__sigWebTimer);
        (window as any).__sigWebTimer = null;
        
        // Reset SigWeb display target
        if (typeof (window as any).SigWebSetDisplayTarget === 'function') {
          (window as any).SigWebSetDisplayTarget(null);
        }
        
        // Call Reset function if available (recommended by Topaz)
        if (typeof (window as any).Reset === 'function') {
          (window as any).Reset();
        }
      } else {
        // No need to stop anything if SigWeb wasn't used
        console.log('[SignatureCapture] No SigWeb cleanup needed');
      }
    } catch (error) {
      console.error('Failed to stop tablet:', error);
    }
  };

  // Listen for signature pad input events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置 canvas 为全屏尺寸（使用窗口尺寸，而不是固定尺寸）
    const updateCanvasSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2; // 线条宽度
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.imageSmoothingEnabled = true; // 启用图像平滑
      ctx.imageSmoothingQuality = 'high'; // 高质量平滑
      console.log('[SignatureCapture] Canvas size set to:', canvas.width, 'x', canvas.height);
    };
    
    // 初始化时设置尺寸
    updateCanvasSize();
    
    // 窗口大小改变时更新 canvas 尺寸
    const handleResize = () => {
      updateCanvasSize();
    };
    window.addEventListener('resize', handleResize);

    // 全局监听 pointer 事件（使用 window 而不是 canvas）
    // 处理 pen、mouse 和 touch 输入
    // NOTE: If SigWeb is active, only allow pen input from the signature pad, not mouse
    const handleGlobalPointerMove = (e: PointerEvent) => {
      // If SigWeb is active, only allow pen input (from signature pad), not mouse
      if (sigWebActive && e.pointerType === 'mouse') {
        return; // Ignore mouse input when SigWeb device is active
      }
      
      // 处理 pen 输入（有压力）或 mouse 输入（按钮被按下，仅在 SigWeb 未激活时）
      const isPenInput = e.pointerType === 'pen' && e.pressure > 0;
      const isMouseInput = !sigWebActive && e.pointerType === 'mouse' && e.buttons > 0;
      
      if (isPenInput || isMouseInput) {
        // 获取 canvas 的实际位置和尺寸
        const rect = canvas.getBoundingClientRect();
        
        // 计算缩放比例（canvas 内部尺寸 vs 实际显示尺寸）
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        // 将窗口坐标转换为 canvas 坐标
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        // 限制在 canvas 范围内
        const clampedX = Math.max(0, Math.min(canvas.width, x));
        const clampedY = Math.max(0, Math.min(canvas.height, y));
        
        if (!isDrawingRef.current) {
          isDrawingRef.current = true;
          setHasSignature(true);
          lastXRef.current = clampedX;
          lastYRef.current = clampedY;
          // 绘制起始点
          ctx.beginPath();
          ctx.arc(clampedX, clampedY, 2, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          // 绘制线条（使用平滑的直线）
          ctx.beginPath();
          ctx.moveTo(lastXRef.current, lastYRef.current);
          ctx.lineTo(clampedX, clampedY);
          ctx.stroke();
        }
        lastXRef.current = clampedX;
        lastYRef.current = clampedY;
      } else if ((e.pointerType === 'pen' && e.pressure === 0) || (e.pointerType === 'mouse' && e.buttons === 0)) {
        // 笔尖或鼠标抬起
        isDrawingRef.current = false;
      }
    };

    // 鼠标输入处理（用于测试和备用，仅在 SigWeb 未激活时）
    const startDrawing = async (e: MouseEvent | TouchEvent) => {
      // If SigWeb is active, ignore mouse/touch input
      if (sigWebActive && !('touches' in e)) {
        return;
      }
      
      e.preventDefault();
      
      if (!('touches' in e)) {
        // 鼠标输入
        isDrawingRef.current = true;
        setHasSignature(true);
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.clientX;
        const clientY = e.clientY;
        lastXRef.current = Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX));
        lastYRef.current = Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY));
      } else {
        // Touch事件
        isDrawingRef.current = true;
        setHasSignature(true);
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches[0].clientX;
        const clientY = e.touches[0].clientY;
        lastXRef.current = Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX));
        lastYRef.current = Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY));
      }
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      // If SigWeb is active, ignore mouse input (but allow touch as fallback)
      if (sigWebActive && !('touches' in e)) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      if (!isDrawingRef.current) return;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      let clientX: number;
      let clientY: number;
      
      if (!('touches' in e)) {
        // 鼠标输入 - 只在按钮按下时绘制
        if (e.buttons === 0) {
          isDrawingRef.current = false;
          return;
        }
        clientX = Math.max(rect.left, Math.min(rect.right, e.clientX));
        clientY = Math.max(rect.top, Math.min(rect.bottom, e.clientY));
      } else {
        // Touch事件
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      }
      
      const currentX = (clientX - rect.left) * scaleX;
      const currentY = (clientY - rect.top) * scaleY;
      
      const clampedX = Math.max(0, Math.min(canvas.width, currentX));
      const clampedY = Math.max(0, Math.min(canvas.height, currentY));
      
      // 确保线条宽度正确
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000000';
      
      // 绘制线条
      ctx.beginPath();
      ctx.moveTo(lastXRef.current, lastYRef.current);
      ctx.lineTo(clampedX, clampedY);
      ctx.stroke();

      lastXRef.current = clampedX;
      lastYRef.current = clampedY;
    };

    const stopDrawing = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDrawingRef.current) {
        console.log('[SignatureCapture] Drawing stopped');
      }
      isDrawingRef.current = false;
    };

    // Mouse events (for testing/fallback) - 也使用全局监听
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDrawingRef.current && e.buttons > 0) { // 确保鼠标按钮被按下
        // 获取 canvas 的实际位置和尺寸
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        // 将窗口坐标转换为 canvas 坐标
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        // 限制在 canvas 范围内
        const clampedX = Math.max(0, Math.min(canvas.width, x));
        const clampedY = Math.max(0, Math.min(canvas.height, y));
        
        // 绘制线条
        ctx.beginPath();
        ctx.moveTo(lastXRef.current, lastYRef.current);
        ctx.lineTo(clampedX, clampedY);
        ctx.stroke();
        
        lastXRef.current = clampedX;
        lastYRef.current = clampedY;
      }
    };
    
    const handleGlobalMouseDown = (e: MouseEvent) => {
      if (e.button === 0) { // 左键
        // 获取 canvas 的实际位置和尺寸
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        // 将窗口坐标转换为 canvas 坐标
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        
        // 限制在 canvas 范围内
        const clampedX = Math.max(0, Math.min(canvas.width, x));
        const clampedY = Math.max(0, Math.min(canvas.height, y));
        
        isDrawingRef.current = true;
        setHasSignature(true);
        lastXRef.current = clampedX;
        lastYRef.current = clampedY;
        ctx.beginPath();
        ctx.arc(clampedX, clampedY, 2, 0, 2 * Math.PI);
        ctx.fill();
      }
    };
    
    const handleGlobalMouseUp = () => {
      isDrawingRef.current = false;
    };
    
    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        isDrawingRef.current = false;
      }
    };

    // 全局监听 pointer 事件（关键：使用 window 而不是 canvas）
    window.addEventListener('pointermove', handleGlobalPointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('mousedown', handleGlobalMouseDown);
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    // Mouse events on canvas (for testing/fallback)
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // Touch events
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });
    canvas.addEventListener('touchcancel', stopDrawing, { passive: false });

    return () => {
      // 清理全局监听器
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousedown', handleGlobalMouseDown);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('mouseleave', stopDrawing);
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDrawing);
      canvas.removeEventListener('touchcancel', stopDrawing);
    };
  }, []); // Empty dependency array, only execute once when component mounts

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
      let arrayBuffer: ArrayBuffer;
      
      // Check if SigWeb is available and use it to get signature image
      if (typeof (window as any).GetSigImageB64 === 'function') {
        console.log('[SignatureCapture] Using SigWeb to capture signature...');
        
        // Use SigWeb's GetSigImageB64 function
        const base64Image = await new Promise<string>((resolve, reject) => {
          try {
            // Set up resolve function for callback
            (window as any).__sigImageCallbackResolve = resolve;
            
            // Call GetSigImageB64 with callback function name
            (window as any).GetSigImageB64('__sigImageCallback');
            
            // Timeout after 5 seconds
            setTimeout(() => {
              if ((window as any).__sigImageCallbackResolve === resolve) {
                (window as any).__sigImageCallbackResolve = null;
                reject(new Error('SigWeb image capture timeout'));
              }
            }, 5000);
          } catch (error) {
            (window as any).__sigImageCallbackResolve = null;
            reject(error);
          }
        });
        
        // Convert base64 to ArrayBuffer
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else {
        // Fallback: Convert canvas to Blob
        console.log('[SignatureCapture] Using canvas fallback to capture signature...');
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          }, 'image/png', 1.0);
        });

        // Convert to ArrayBuffer
        arrayBuffer = await blob.arrayBuffer();
      }
      
      // Call callback function
      try {
        onCapture(arrayBuffer);
      } catch (captureError) {
        console.error('Error in onCapture callback:', captureError);
        // Continue to close even if callback fails
      }
      
      // Clean up
      await cleanup();
      
      // Close the window - this should always happen
      console.log('[SignatureCapture] Closing signature capture window...');
      onClose();
    } catch (error) {
      console.error('Failed to capture signature:', error);
      // Even if there's an error, try to clean up and close
      try {
        await cleanup();
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
      // Always close the window, even if there were errors
      console.log('[SignatureCapture] Closing signature capture window (after error)...');
      onClose();
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="signature-capture-fullscreen">
      {/* 顶部控制栏 */}
      <div className="signature-control-bar">
        <div className="signature-header">
          <h3>Signature Capture</h3>
          <p className="signature-hint">
            {typeof (window as any).IsSigWebInstalled === 'function' && (window as any).IsSigWebInstalled() 
              ? '✓ SigWeb Service detected - You can sign on the signature pad device OR use mouse/touch below'
              : 'You can sign using mouse (click and drag) or touch screen'}
          </p>
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

      {/* 全屏 Canvas */}
      <div 
        ref={containerRef}
        className="signature-canvas-fullscreen"
      >
        <canvas 
          ref={canvasRef}
          className="signature-canvas"
        />
      </div>
    </div>
  );
};

export default SignatureCapture;
