'use client';

import React from 'react';

export default function LoginPage() {
  const handleGoogleLogin = () => {
    const authUrl = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:4000/api/auth';
    window.location.href = authUrl + '/google';
  };

  const handleDevLogin = () => {
    const authUrl = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:4000/api/auth';
    window.location.href = authUrl + '/dev-login';
  };

  return (
    <div className="min-h-screen bg-[#1F1F1F] flex items-center justify-center p-4">
      <div className="bg-[#111111] border border-gray-800 rounded-lg shadow-2xl p-8 w-full max-w-md text-center">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-white mb-2">Login</h1>
          <p className="text-gray-400 text-sm">Please log in to continue</p>
        </div>
        
        <button
          onClick={handleGoogleLogin}
          className="w-full bg-white text-black py-2.5 px-4 rounded font-medium flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors mb-3"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
          Login with Google
        </button>

        <button
          onClick={handleDevLogin}
          className="w-full bg-indigo-600 text-white py-2 px-4 rounded text-sm font-medium flex items-center justify-center gap-2 hover:bg-indigo-500 transition-colors mb-6"
        >
          ⚡ Dev Mode Login (Instant Access)
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="h-px bg-gray-800 flex-1"></div>
          <span className="text-gray-500 text-sm">or sign up through email</span>
          <div className="h-px bg-gray-800 flex-1"></div>
        </div>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email ID"
            disabled
            className="w-full bg-[#1A1A1A] border border-gray-800 rounded px-4 py-2 text-white placeholder-gray-500 cursor-not-allowed opacity-70"
          />
          <input
            type="password"
            placeholder="Password"
            disabled
            className="w-full bg-[#1A1A1A] border border-gray-800 rounded px-4 py-2 text-white placeholder-gray-500 cursor-not-allowed opacity-70"
          />
          <button
            disabled
            className="w-full bg-[#4B63DD] text-white py-2.5 rounded font-medium opacity-50 cursor-not-allowed"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
}
