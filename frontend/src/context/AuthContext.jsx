import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    });
  }, []);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const token = res.data?.token;
      const nextUser = res.data?.user;
      // Never establish a session without BOTH a token and a user object.
      if (!token || !nextUser) throw new Error('Login failed. Please try again.');
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(nextUser));
      setUser(nextUser);
      return nextUser;
    } catch (err) {
      // A rejected login (wrong password, pending/rejected/deactivated
      // account) must leave NO stale session behind — especially one from a
      // pre-fix token held by an ineligible account. Network/server errors
      // (5xx) keep the previous state untouched.
      if (err.status === 401 || err.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      }
      throw err;
    } finally { setLoading(false); }
  }, []);

  const register = useCallback(async (payload) => {
    setLoading(true);
    try {
      const res = await api.post('/api/auth/register', payload);
      return res;
    } finally { setLoading(false); }
  }, []);

  const logout = useCallback(() => {
    api.post('/api/auth/logout').catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/me');
      localStorage.setItem('user', JSON.stringify(res.data.user));
      setUser(res.data.user);
      return res.data.user;
    } catch { return null; }
  }, []);

  // Keep the cached user (and the navbar role badge) in sync with the database.
  // The backend re-reads the role per request, so /me returns the CURRENT role
  // even after a promotion/demotion done in another session — no re-login needed.
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    refreshUser();
  }, [refreshUser]);

  const role = user?.role || null;
  const isAtLeast = (r) => ({ VISITOR: 1, MEMBER: 2, ADMIN: 3, AUTHORITY: 4 }[role] >= { VISITOR: 1, MEMBER: 2, ADMIN: 3, AUTHORITY: 4 }[r]);
  const isMember = isAtLeast('MEMBER');
  const isAdmin = isAtLeast('ADMIN');
  const isAuthority = role === 'AUTHORITY';

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, register, logout, refreshUser, role, isMember, isAdmin, isAuthority }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
