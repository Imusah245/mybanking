import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../lib/api';

const TOKEN_KEY = 'mybanking_token';

const AuthContext = createContext(null);

/**
 * AuthProvider — wraps the app and provides authentication state + actions.
 *
 * State: user, account, token, loading, error.
 * Actions: login, register, logout, refresh.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [account, setAccount] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Hydrate on mount ─────────────────────────────────────────────
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    api
      .get('/api/auth/me')
      .then((res) => {
        setUser(res.data.data.user);
        setAccount(res.data.data.account ?? null);
      })
      .catch(() => {
        // Token invalid / expired — clear everything.
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setAccount(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login ────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const res = await api.post('/api/auth/login', { email, password });
    const { user: loggedInUser, token: newToken } = res.data.data;

    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(loggedInUser);
    setError(null);

    // Fetch /me to populate account (login response doesn't include it).
    try {
      const meRes = await api.get('/api/auth/me');
      setAccount(meRes.data.data.account ?? null);
    } catch {
      // Non-critical — account will be populated on next refresh.
      setAccount(null);
    }

    return loggedInUser;
  }, []);

  // ── Register ─────────────────────────────────────────────────────
  const register = useCallback(async (payload) => {
    const res = await api.post('/api/auth/register', payload);
    const {
      user: newUser,
      account: newAccount,
      token: newToken,
    } = res.data.data;

    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    setAccount(newAccount ?? null);
    setError(null);

    return newUser;
  }, []);

  // ── Logout ───────────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setAccount(null);
    setError(null);
  }, []);

  // ── Refresh (re-fetch /me) ───────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      setUser(res.data.data.user);
      setAccount(res.data.data.account ?? null);
    } catch (err) {
      setError(err.message || 'Failed to refresh session');
    }
  }, []);

  const value = {
    user,
    account,
    token,
    loading,
    error,
    login,
    register,
    logout,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth — convenience hook to consume AuthContext.
 * Throws if used outside AuthProvider.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export default AuthContext;
