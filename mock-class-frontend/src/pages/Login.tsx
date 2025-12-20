import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AUTOMATION_USER } from '../lib/mockData';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Mock login logic: Check if user exists (mock auth) or just allow general access for automation
    // For this mock, we accept any non-empty credential, but let's check against mock users for realism
    // or just fallback to successful login.
    
    // Simulating a JWT
    const token = `mock-jwt-token-${Date.now()}`;
    localStorage.setItem('authToken', token);
    localStorage.setItem('username', username); // Store username for classroom
    navigate('/class');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-white/20 w-96 transform hover:scale-105 transition-all duration-300">
        <h1 className="text-3xl font-bold mb-6 text-center bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          Student Portal
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
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-500 transition-colors"
              placeholder="Enter password"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold shadow-lg transform active:scale-95 transition-all"
          >
            Login
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
