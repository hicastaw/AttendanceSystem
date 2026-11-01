import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getToken, setToken, onUnauthorized } from './api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(getToken());

  const login = useCallback((newToken) => {
    setToken(newToken);
    setTokenState(newToken);
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setTokenState('');
  }, []);

  // Backend giữ token trong RAM — restart server là token cũ hết hạn (401),
  // khi đó tự đăng xuất để quay về trang đăng nhập.
  useEffect(() => onUnauthorized(logout), [logout]);

  return (
    <AuthContext.Provider value={{ token, isLoggedIn: Boolean(token), login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
