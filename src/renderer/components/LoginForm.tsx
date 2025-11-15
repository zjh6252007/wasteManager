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
        setError(result.message);
        console.log('Login failed:', result.message);
      }
    } catch (err) {
      console.error('Login exception:', err);
      setError('Login failed, please try again');
    } finally {
      setLoading(false);
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
          </div>
        </form>

        <div className="login-footer">
          <p>If you have any issues, please contact the system administrator</p>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;