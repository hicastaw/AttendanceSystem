import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import api from '../api/client.js';
import { clearStoredSession, getStoredSession, normalizeUser, setStoredSession } from './session.js';

const AuthContext = createContext(null);

const authApi = axios.create({
  baseURL: '/api/v1/auth',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

export function AuthProvider({ children }) {
  const [session, setSessionState] = useState(() => getStoredSession());
  const [authLoading, setAuthLoading] = useState(true);

  const persistSession = (nextSession) => {
    const normalized = setStoredSession(nextSession);
    setSessionState(normalized);
    return normalized;
  };

  const logout = () => {
    const cleared = clearStoredSession();
    setSessionState(cleared);
  };

  const refreshCurrentUser = async () => {
    const current = getStoredSession();
    if (!current.token) {
      setAuthLoading(false);
      return null;
    }

    try {
      const res = await authApi.get('/me', {
        headers: { Authorization: `Bearer ${current.token}` },
      });
      const nextSession = persistSession({ token: current.token, user: res.data?.data });
      return nextSession.user;
    } catch {
      logout();
      return null;
    } finally {
      setAuthLoading(false);
    }
  };

  useEffect(() => {
    refreshCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (identifier, password) => {
    const res = await authApi.post('/login', { identifier, password });
    const data = res.data?.data || {};
    const nextSession = persistSession({ token: data.access_token, user: data.user });
    return nextSession.user;
  };

  const changePassword = async (oldPassword, newPassword) => {
    const res = await api.post('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    });

    const nextUser = normalizeUser(res.data?.data?.user || session.user);
    persistSession({ token: session.token, user: nextUser });
    return nextUser;
  };

  const value = useMemo(() => {
    const user = normalizeUser(session.user);
    return {
      session,
      actor: user,
      user,
      token: session.token,
      authLoading,
      login,
      logout,
      refreshCurrentUser,
      changePassword,
      isAdmin: user.role === 'admin',
      isLecturer: user.role === 'lecturer',
      isStudent: user.role === 'student',
      isAuthenticated: Boolean(session.token) && user.role !== 'anonymous',
    };
  }, [session, authLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
