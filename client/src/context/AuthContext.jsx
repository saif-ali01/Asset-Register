import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAccessToken, setUnauthorizedHandler } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [roleInfo, setRoleInfo] = useState(null);
  const [booting, setBooting] = useState(true);

  const adopt = useCallback((payload) => {
    if (payload.accessToken) setAccessToken(payload.accessToken);
    setUser(payload.user);
    setPermissions(payload.permissions || []);
    setRoleInfo(payload.roleInfo || null);
  }, []);

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setPermissions([]);
    setRoleInfo(null);
  }, []);

  // Cold start: the refresh cookie is the only thing that survives a reload.
  useEffect(() => {
    setUnauthorizedHandler(clear);
    (async () => {
      try {
        adopt(await api.refresh());
      } catch {
        clear();
      } finally {
        setBooting(false);
      }
    })();
  }, [adopt, clear]);

  const value = useMemo(() => ({
    user,
    permissions,
    roleInfo,
    booting,
    isAuthenticated: Boolean(user),
    can: (...needed) => needed.some((p) => permissions.includes(p)),
    canAll: (...needed) => needed.every((p) => permissions.includes(p)),
    login: async (email, password) => adopt(await api.post('/auth/login', { email, password })),
    register: async (payload) => adopt(await api.post('/auth/register', payload)),
    logout: async () => {
      try { await api.post('/auth/logout'); } finally { clear(); }
    },
    updateProfile: async (patch) => adopt(await api.patch('/auth/me', patch)),
    refreshUser: async () => adopt(await api.get('/auth/me')),
  }), [user, permissions, roleInfo, booting, adopt, clear]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
