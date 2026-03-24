import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getStoredToken, getStoredUser, storeAuth, clearAuth, setOnUnauthorized, getMe } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  const [token, setToken] = useState(getStoredToken);
  const [loading, setLoading] = useState(!!getStoredToken());

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
    setToken(null);
  }, []);

  // Register the 401 handler
  useEffect(() => {
    setOnUnauthorized(logout);
    return () => setOnUnauthorized(null);
  }, [logout]);

  // Validate stored token on mount
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    getMe()
      .then((data) => {
        const u = data.user || data;
        setUser(u);
        storeAuth(token, u);
      })
      .catch(() => {
        logout();
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = useCallback((authToken, authUser) => {
    storeAuth(authToken, authUser);
    setToken(authToken);
    setUser(authUser);
  }, []);

  const isAdmin = user?.role === 'admin';
  const isAuthenticated = !!user && !!token;

  return (
    <AuthContext.Provider value={{ user, token, isAdmin, isAuthenticated, loading, login: handleLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
