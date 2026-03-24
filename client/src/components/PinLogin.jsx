import { useState, useEffect, useCallback } from 'react';
import { Car, Delete, Lock } from 'lucide-react';
import { login as apiLogin } from '../api';
import { useAuth } from '../context/AuthContext';

export default function PinLogin() {
  const { login } = useAuth();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('name'); // 'name' or 'pin'

  const handleNameSubmit = () => {
    if (!name.trim()) return;
    setStep('pin');
    setPin('');
    setError('');
  };

  const handleDigit = useCallback((digit) => {
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      return prev + digit;
    });
    setError('');
  }, []);

  const handleBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
    setError('');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await apiLogin(name.trim(), pin);
      login(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Invalid credentials');
      setPin('');
    } finally {
      setLoading(false);
    }
  }, [pin, name, login]);

  // Auto-submit when 4+ digits entered
  useEffect(() => {
    if (pin.length === 4 && step === 'pin') {
      handleSubmit();
    }
  }, [pin, step, handleSubmit]);

  // Keyboard support
  useEffect(() => {
    if (step !== 'pin') return;
    function handleKeyDown(e) {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter' && pin.length >= 4) {
        handleSubmit();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, pin, handleDigit, handleBackspace, handleSubmit]);

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4">
            <Car className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">VMT</h1>
          <p className="text-white/60 text-sm mt-1">Vehicle Maintenance Tracker</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
          {step === 'name' ? (
            <div className="p-6 space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50 text-center">
                Welcome Back
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                Enter your name to sign in
              </p>
              <input
                type="text"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700
                           bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-50
                           text-center text-lg font-medium focus:outline-none focus:ring-2
                           focus:ring-brand-500 focus:border-transparent"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); }}
                autoFocus
              />
              <button
                onClick={handleNameSubmit}
                disabled={!name.trim()}
                className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white
                           font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {/* User info */}
              <div className="text-center">
                <button
                  onClick={() => { setStep('name'); setPin(''); setError(''); }}
                  className="text-sm text-brand-600 dark:text-brand-400 hover:underline mb-2 inline-block"
                >
                  &larr; Change user
                </button>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                  Hi, {name}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center justify-center gap-1 mt-1">
                  <Lock className="w-3.5 h-3.5" />
                  Enter your PIN
                </p>
              </div>

              {/* PIN dots */}
              <div className="flex justify-center gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full transition-all duration-200 ${
                      i < pin.length
                        ? 'bg-brand-600 scale-110'
                        : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                ))}
                {pin.length > 4 &&
                  [...Array(pin.length - 4)].map((_, i) => (
                    <div
                      key={i + 4}
                      className="w-4 h-4 rounded-full bg-brand-600 scale-110 transition-all duration-200"
                    />
                  ))}
              </div>

              {/* Error */}
              {error && (
                <p className="text-red-500 text-sm text-center animate-fade-in">{error}</p>
              )}

              {/* Loading */}
              {loading && (
                <p className="text-brand-600 text-sm text-center animate-pulse">Signing in...</p>
              )}

              {/* Numeric keypad */}
              <div className="grid grid-cols-3 gap-2">
                {digits.map((d, i) => {
                  if (d === '') return <div key={i} />;
                  if (d === 'del') {
                    return (
                      <button
                        key="del"
                        onClick={handleBackspace}
                        disabled={loading}
                        className="flex items-center justify-center py-4 rounded-xl
                                   text-gray-600 dark:text-gray-300
                                   hover:bg-gray-100 dark:hover:bg-gray-800
                                   active:bg-gray-200 dark:active:bg-gray-700
                                   transition-colors disabled:opacity-50"
                      >
                        <Delete className="w-6 h-6" />
                      </button>
                    );
                  }
                  return (
                    <button
                      key={d}
                      onClick={() => handleDigit(d)}
                      disabled={loading}
                      className="py-4 rounded-xl text-xl font-semibold
                                 text-gray-900 dark:text-gray-50
                                 hover:bg-gray-100 dark:hover:bg-gray-800
                                 active:bg-gray-200 dark:active:bg-gray-700
                                 transition-colors disabled:opacity-50"
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
