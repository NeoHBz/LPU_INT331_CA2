import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTOMATION_USER } from '../lib/mockData';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8080';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const checkServerHealth = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(`${SERVER_URL}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = await response.json();
      return data?.status === 'ok';
    } catch {
      clearTimeout(timeout);
      return false;
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const normalizedUsername = username.trim().toLowerCase();
    const isUsernameValid = normalizedUsername.length > 0;
    const isPasswordValid = password.trim().length > 0;

    if (!isUsernameValid || !isPasswordValid) {
      setError('Please enter both username and password.');
      return;
    }

    const isAutomationUser =
      normalizedUsername === AUTOMATION_USER.username.toLowerCase() &&
      password === AUTOMATION_USER.password;

    if (!isAutomationUser) {
      setError(`Invalid credentials. Try ${AUTOMATION_USER.username} / ${AUTOMATION_USER.password}.`);
      return;
    }

    setIsSubmitting(true);

    const isServerHealthy = await checkServerHealth();
    if (!isServerHealthy) {
      setIsSubmitting(false);
      setError('Backend server is unreachable. Please start it and try again.');
      return;
    }

    // Simulate a short network delay for better UX feedback.
    setTimeout(() => {
      const token = `mock-jwt-token-${Date.now()}`;
      localStorage.setItem('authToken', token);
      localStorage.setItem('username', normalizedUsername);
      navigate('/class');
    }, 250);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-white/20 w-96 transform hover:scale-105 transition-all duration-300">
        <h1 className="text-3xl font-bold mb-6 text-center bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Student Login
        </h1>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500 transition-colors"
              placeholder="Enter username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-300">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 pr-12 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500 transition-colors"
                placeholder="Enter password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-3 flex items-center text-xs text-gray-400 hover:text-white"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          {error && (
            <div className="text-sm text-red-400 bg-red-900/30 border border-red-700 rounded-lg px-3 py-2" role="alert" aria-live="polite">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold shadow-lg transform active:scale-95 transition-all ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isSubmitting ? 'Signing in...' : 'Login'}
          </button>
        </form> 
        <div className="mt-4 text-xs text-gray-500 text-center">
            Hint: Use {AUTOMATION_USER.username} / {AUTOMATION_USER.password}
        </div>
      </div>
    </div>
  );
};

export default Login;
