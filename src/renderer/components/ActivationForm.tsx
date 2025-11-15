import React, { useState } from 'react';
import './ActivationForm.css';

interface ActivationFormProps {
  onActivationSuccess: () => void;
}

const ActivationForm: React.FC<ActivationFormProps> = ({ onActivationSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showTestButton, setShowTestButton] = useState(true);

  // 检查激活状态
  const checkActivationStatus = async () => {
    if (!activationCode.trim()) {
      setError('请输入激活码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.electronAPI.auth.checkActivationStatus(activationCode);
      if (result.success) {
        setActivationStatus(result.data);
        setIsActivated(true);
        setError('');
      } else {
        setError(result.message);
        setIsActivated(false);
        setActivationStatus(null);
      }
    } catch (err) {
      setError('检查激活状态失败，请重试');
      setIsActivated(false);
      setActivationStatus(null);
    } finally {
      setLoading(false);
    }
  };

  // 激活账户
  const activateAccount = async () => {
    if (!activationCode.trim() || !username.trim() || !password.trim()) {
      setError('请填写完整信息');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.electronAPI.auth.activateAccount(activationCode, username, password);
      if (result.success) {
        setError('');
        alert('账户激活成功！');
        onActivationSuccess();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('激活失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 登录
  const handleLogin = async () => {
    if (!activationCode.trim() || !username.trim() || !password.trim()) {
      setError('请填写完整信息');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.electronAPI.auth.authenticateUser(activationCode, username, password);
      if (result.success) {
        setError('');
        onActivationSuccess();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 创建测试激活码
  const createTestActivationCode = async () => {
    setLoading(true);
    setError('');

    try {
      const result = await window.electronAPI.test.createTestActivationCode();
      if (result.success) {
        setActivationCode(result.activationCode);
        setShowTestButton(false);
        setError('');
        alert(result.message);
        // 自动检查激活状态
        await checkActivationStatus();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('创建测试激活码失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="activation-container">
      <div className="activation-form">
        <div className="activation-header">
          <h2>垃圾回收称重系统</h2>
          <p>请输入激活码激活账户</p>
        </div>

        <form onSubmit={(e) => e.preventDefault()}>
          <div className="form-group">
            <label htmlFor="activationCode">激活码:</label>
            <div className="input-group">
              <input
                type="text"
                id="activationCode"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="请输入激活码"
                disabled={loading}
              />
              <button
                type="button"
                onClick={checkActivationStatus}
                disabled={loading || !activationCode.trim()}
                className="check-btn"
              >
                检查
              </button>
            </div>
          </div>

          {activationStatus && isActivated && (
            <div className="activation-info">
              <p><strong>公司名称:</strong> {activationStatus.company_name}</p>
              <p><strong>激活时间:</strong> {new Date(activationStatus.activated_at).toLocaleDateString()}</p>
              <p><strong>到期时间:</strong> {new Date(activationStatus.expires_at).toLocaleDateString()}</p>
              <p><strong>剩余天数:</strong> {activationStatus.daysLeft} 天</p>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">用户名:</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">密码:</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              disabled={loading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="button-group">
            {!isActivated ? (
              <button
                type="button"
                onClick={activateAccount}
                disabled={loading}
                className="activate-btn"
              >
                {loading ? '激活中...' : '激活账户'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogin}
                disabled={loading}
                className="login-btn"
              >
                {loading ? '登录中...' : '登录'}
              </button>
            )}
          </div>
        </form>

        <div className="activation-footer">
          {showTestButton && (
            <button
              type="button"
              onClick={createTestActivationCode}
              disabled={loading}
              className="test-btn"
            >
              创建测试激活码
            </button>
          )}
          <p>如有问题，请联系系统管理员</p>
        </div>
      </div>
    </div>
  );
};

export default ActivationForm;
