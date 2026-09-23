import React, { useState } from 'react';
import { Car, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

// PROMPT 42 Stage 1 - the email/password form below is what the Playwright harness drives (a synthetic org-4
// account, never Bashir's, never a real client's) - "through the real login form, exactly as a person does" ruled
// out both writing a session into storage and a hidden test-only route. Google stays primary; this is a real
// fallback path any staff member could also use if Google sign-in were unavailable.
const LoginScreen: React.FC = () => {
  const { signInWithGoogle, signInWithPassword } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await signInWithPassword(email, password);
    if (error) setErr(error);
    setBusy(false);
  };

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

        {!showPassword ? (
          <button onClick={() => setShowPassword(true)} className="mt-4 text-xs text-gray-400 hover:text-gray-600 hover:underline">
            Sign in with email and password instead
          </button>
        ) : (
          <form onSubmit={submitPassword} className="mt-4 text-left space-y-2" data-testid="password-login-form">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="username"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" data-testid="login-email" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" data-testid="login-password" />
            {err && <p className="text-xs text-red-600" data-testid="login-error">{err}</p>}
            <button type="submit" disabled={busy || !email || !password} data-testid="login-submit"
              className="w-full bg-[#a58039] text-white py-2 rounded-lg font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginScreen;
