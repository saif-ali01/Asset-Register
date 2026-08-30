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

  const clear = useCallback(({ expired = false } = {}) => {
    setAccessToken(null);
    setUser(null);
    setPermissions([]);
    setRoleInfo(null);
    /**
     * Sending the browser to the sign-in page here rather than relying only on
     * a route guard means an expired session lands somewhere sensible even if
     * the 401 came from a background request on a page that never re-renders.
     * The current path is passed along so the person returns to where they were.
     */
    if (expired && !window.location.pathname.startsWith('/login')) {
      const from = window.location.pathname + window.location.search;
      window.sessionStorage.setItem('returnTo', from);
      window.location.replace('/login?expired=1');
    }
  }, []);

  // Cold start: the refresh cookie is the only thing that survives a reload.
  useEffect(() => {
    // A 401 that survives a refresh attempt means the session is gone.
    setUnauthorizedHandler(() => clear({ expired: true }));
    (async () => {
      try {
        adopt(await api.refresh());
      } catch {
        // A failed refresh on a cold start is normal (nobody signed in yet),
        // so this is not treated as an expiry — the route guard handles it.
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
