import React from 'react';
import { Car } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const LoginScreen: React.FC = () => {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="min-h-screen bg-[#F0EDDE] flex items-center justify-center p-4 font-sans text-[#403f4c]">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-8 border border-[#a58039]/20 text-center">
        <div className="flex justify-center mb-6">
          <div className="bg-[#a58039] p-3 rounded-xl shadow-sm">
            <Car className="w-10 h-10 text-[#F0EDDE]" />
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-[#a58039] leading-none tracking-tight mb-2">
          AutoData
        </h1>
        <div className="text-sm font-semibold text-[#403f4c] tracking-[0.2em] uppercase mb-8">
          by caplimo
        </div>

        <p className="text-gray-500 mb-8">Staff access only.</p>

        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-[#403f4c] text-white py-3 px-4 rounded-lg font-bold hover:bg-[#2d2c35] transition-colors shadow-lg shadow-[#403f4c]/20"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  );
};

export default LoginScreen;
