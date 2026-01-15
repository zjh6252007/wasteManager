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

  // Check activation status
  const checkActivationStatus = async () => {
    if (!activationCode.trim()) {
      setError('Please enter activation code');
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
      setError('Failed to check activation status, please try again');
      setIsActivated(false);
      setActivationStatus(null);
    } finally {
      setLoading(false);
    }
  };

  // Activate account
  const activateAccount = async () => {
    if (!activationCode.trim() || !username.trim() || !password.trim()) {
      setError('Please fill in all information');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.electronAPI.auth.activateAccount(activationCode, username, password);
      if (result.success) {
        setError('');
        alert('Account activated successfully!');
        onActivationSuccess();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('Activation failed, please try again');
    } finally {
      setLoading(false);
    }
  };

  // Login
  const handleLogin = async () => {
    if (!activationCode.trim() || !username.trim() || !password.trim()) {
      setError('Please fill in all information');
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
      setError('Login failed, please try again');
    } finally {
      setLoading(false);
    }
  };

  // Create test activation code
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
        // Automatically check activation status
        await checkActivationStatus();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError('Failed to create test activation code, please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="activation-container">
      <div className="activation-form">
        <div className="activation-header">
          <h2>Waste Recycling Scale System</h2>
          <p>Please enter activation code to activate account</p>
        </div>

        <form onSubmit={(e) => e.preventDefault()}>
          <div className="form-group">
            <label htmlFor="activationCode">Activation Code:</label>
            <div className="input-group">
              <input
                type="text"
                id="activationCode"
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                placeholder="Enter activation code"
                disabled={loading}
              />
              <button
                type="button"
                onClick={checkActivationStatus}
                disabled={loading || !activationCode.trim()}
                className="check-btn"
              >
                Check
              </button>
            </div>
          </div>

          {activationStatus && isActivated && (
            <div className="activation-info">
              <p><strong>Company Name:</strong> {activationStatus.company_name}</p>
              <p><strong>Activated At:</strong> {new Date(activationStatus.activated_at).toLocaleDateString()}</p>
              <p><strong>Expires At:</strong> {new Date(activationStatus.expires_at).toLocaleDateString()}</p>
              <p><strong>Days Remaining:</strong> {activationStatus.daysLeft} days</p>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="username">Username:</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password:</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
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
                {loading ? 'Activating...' : 'Activate Account'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogin}
                disabled={loading}
                className="login-btn"
              >
                {loading ? 'Logging in...' : 'Login'}
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
              Create Test Activation Code
            </button>
          )}
          <p>If you have any questions, please contact the system administrator</p>
        </div>
      </div>
    </div>
  );
};

export default ActivationForm;
