import { useAuth } from '../context/AuthContext.jsx';

/** Renders children only when the signed-in user holds one of the permissions. */
export function Can({ permission, all, fallback = null, children }) {
  const { can, canAll } = useAuth();
  const list = Array.isArray(permission) ? permission : [permission];
  const allowed = all ? canAll(...list) : can(...list);
  return allowed ? children : fallback;
}
