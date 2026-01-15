import React, { useState } from 'react';
import './LoginForm.css';

interface LoginFormProps {
  onLoginSuccess: () => void;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRenewalDialog, setShowRenewalDialog] = useState(false);
  const [renewalActivationCode, setRenewalActivationCode] = useState('');
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalError, setRenewalError] = useState('');
  const [currentActivationCode, setCurrentActivationCode] = useState('');
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [activateUsername, setActivateUsername] = useState('');
  const [activateCode, setActivateCode] = useState('');
  const [activateLoading, setActivateLoading] = useState(false);
  const [activateError, setActivateError] = useState('');

  // Login
  const handleLogin = async () => {
    console.log('Login button clicked');
    console.log('Username:', username);
    console.log('Password:', password);
    
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('Starting authentication API call...');
      const result = await window.electronAPI.auth.authenticateUser(username, password);
      console.log('Authentication result:', result);
      
      if (result.success) {
        setError('');
        console.log('Login successful, calling onLoginSuccess');
        onLoginSuccess();
      } else {
        // Check if account is expired
        if (result.expired) {
          setCurrentActivationCode(result.activationCode || '');
          setRenewalActivationCode(result.activationCode || '');
          setShowRenewalDialog(true);
          setError('');
        } else {
          setError(result.message);
          console.log('Login failed:', result.message);
        }
      }
    } catch (err) {
      console.error('Login exception:', err);
      setError('Login failed, please try again');
    } finally {
      setLoading(false);
    }
  };

  // Handle renewal
  const handleRenewal = async () => {
    if (!renewalActivationCode.trim()) {
      setRenewalError('Please enter an activation code');
      return;
    }

    setRenewalLoading(true);
    setRenewalError('');

    try {
      const result = await window.electronAPI.auth.renewActivation(renewalActivationCode);
      if (result.success) {
        setRenewalError('');
        setShowRenewalDialog(false);
        setRenewalActivationCode('');
        // Try to login again after renewal
        await handleLogin();
      } else {
        setRenewalError(result.message);
      }
    } catch (err) {
      console.error('Renewal exception:', err);
      setRenewalError('Renewal failed, please try again');
    } finally {
      setRenewalLoading(false);
    }
  };

  // Handle activation
  const handleActivate = async () => {
    if (!activateUsername.trim()) {
      setActivateError('Please enter username');
      return;
    }

    if (!activateCode.trim()) {
      setActivateError('Please enter activation code');
      return;
    }

    setActivateLoading(true);
    setActivateError('');

    try {
      const result = await window.electronAPI.auth.activateAccountWithCode(activateUsername, activateCode);
      if (result.success) {
        setActivateError('');
        setShowActivateDialog(false);
        setActivateUsername('');
        setActivateCode('');
        alert('Account activated successfully! Your account has been extended for 1 year.');
        // Optionally try to login
        setUsername(activateUsername);
      } else {
        setActivateError(result.message);
      }
    } catch (err) {
      console.error('Activation exception:', err);
      setActivateError('Activation failed, please try again');
    } finally {
      setActivateLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-form">
        <div className="login-header">
          <h2>Waste Recycling Scale System</h2>
          <p>Please enter your username and password to login</p>
        </div>

        <form onSubmit={(e) => e.preventDefault()}>
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
            <button
              type="button"
              onClick={handleLogin}
              disabled={loading}
              className="login-btn"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowActivateDialog(true);
                setActivateError('');
              }}
              disabled={loading}
              className="activate-btn"
              style={{
                marginTop: '10px',
                padding: '10px 20px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                width: '100%'
              }}
            >
              Activate Account
            </button>
          </div>
        </form>

        <div className="login-footer">
          <p>If you have any issues, please contact the system administrator</p>
        </div>
      </div>

      {/* Renewal Dialog */}
      {showRenewalDialog && (
        <div className="renewal-overlay">
          <div className="renewal-dialog">
            <div className="renewal-header">
              <h2>Account Expired</h2>
            </div>
            <div className="renewal-content">
              <p>Your account subscription has expired. Please enter a new activation code to renew your subscription for 1 year.</p>
              <div className="form-group">
                <label htmlFor="renewal-code">Activation Code:</label>
                <input
                  type="text"
                  id="renewal-code"
                  value={renewalActivationCode}
                  onChange={(e) => setRenewalActivationCode(e.target.value)}
                  placeholder="Enter activation code"
                  disabled={renewalLoading}
                  style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                />
              </div>
              {renewalError && <div className="error-message" style={{ marginTop: '10px' }}>{renewalError}</div>}
            </div>
            <div className="renewal-footer">
              <button
                type="button"
                onClick={() => {
                  setShowRenewalDialog(false);
                  setRenewalActivationCode('');
                  setRenewalError('');
                }}
                disabled={renewalLoading}
                style={{ 
                  padding: '8px 16px', 
                  marginRight: '10px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: renewalLoading ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRenewal}
                disabled={renewalLoading}
                style={{ 
                  padding: '8px 16px',
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: renewalLoading ? 'not-allowed' : 'pointer'
                }}
              >
                {renewalLoading ? 'Renewing...' : 'Renew Subscription'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activate Dialog */}
      {showActivateDialog && (
        <div className="renewal-overlay">
          <div className="renewal-dialog">
            <div className="renewal-header">
              <h2>Activate Account</h2>
            </div>
            <div className="renewal-content">
              <p>Enter your username and activation code to extend your account subscription for 1 year.</p>
              <div className="form-group">
                <label htmlFor="activate-username">Username:</label>
                <input
                  type="text"
                  id="activate-username"
                  value={activateUsername}
                  onChange={(e) => setActivateUsername(e.target.value)}
                  placeholder="Enter username"
                  disabled={activateLoading}
                  style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                />
              </div>
              <div className="form-group" style={{ marginTop: '15px' }}>
                <label htmlFor="activate-code">Activation Code:</label>
                <input
                  type="text"
                  id="activate-code"
                  value={activateCode}
                  onChange={(e) => setActivateCode(e.target.value)}
                  placeholder="Enter activation code"
                  disabled={activateLoading}
                  style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                />
              </div>
              {activateError && <div className="error-message" style={{ marginTop: '10px' }}>{activateError}</div>}
            </div>
            <div className="renewal-footer">
              <button
                type="button"
                onClick={() => {
                  setShowActivateDialog(false);
                  setActivateUsername('');
                  setActivateCode('');
                  setActivateError('');
                }}
                disabled={activateLoading}
                style={{ 
                  padding: '8px 16px', 
                  marginRight: '10px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: activateLoading ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleActivate}
                disabled={activateLoading}
                style={{ 
                  padding: '8px 16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: activateLoading ? 'not-allowed' : 'pointer'
                }}
              >
                {activateLoading ? 'Activating...' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginForm;