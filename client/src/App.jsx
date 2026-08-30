import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { Spinner } from './components/ui/primitives.jsx';
import { P } from './lib/constants.js';

import { Login, Register } from './pages/Login.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Assets } from './pages/Assets.jsx';
import { AssetDetail } from './pages/AssetDetail.jsx';
import { AssetForm } from './pages/AssetForm.jsx';
import { Custody } from './pages/Custody.jsx';
import { MaintenancePage } from './pages/Maintenance.jsx';
import { People } from './pages/People.jsx';
import { History } from './pages/History.jsx';
import { Settings } from './pages/Settings.jsx';
import { DataQuality } from './pages/DataQuality.jsx';
import { Reports } from './pages/Reports.jsx';
import { Profile } from './pages/Profile.jsx';
import { Forbidden, NotFound } from './pages/NotFound.jsx';

function Booting() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <Spinner size={26} />
    </div>
  );
}

/** Gate for the whole app: signed in, and optionally holding a permission. */
function Protected({ permission, children }) {
  const { isAuthenticated, booting, can } = useAuth();
  const location = useLocation();

  if (booting) return <Booting />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (permission && !can(permission)) return <Forbidden />;
  return children;
}

export default function App() {
  const { booting } = useAuth();
  if (booting) return <Booting />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<Protected><AppShell /></Protected>}>
        <Route index element={<Protected permission={P.DASHBOARD_READ}><Dashboard /></Protected>} />

        <Route path="assets" element={<Protected permission={P.ASSET_READ}><Assets /></Protected>} />
        <Route path="assets/new" element={<Protected permission={P.ASSET_CREATE}><AssetForm /></Protected>} />
        <Route path="assets/:id" element={<Protected permission={P.ASSET_READ}><AssetDetail /></Protected>} />
        <Route path="assets/:id/edit" element={<Protected permission={P.ASSET_UPDATE}><AssetForm /></Protected>} />

        <Route path="custody" element={<Protected permission={P.ASSIGNMENT_READ}><Custody /></Protected>} />
        <Route path="maintenance" element={<Protected permission={P.MAINTENANCE_READ}><MaintenancePage /></Protected>} />
        <Route path="people" element={<Protected permission={P.USER_READ}><People /></Protected>} />
        <Route path="reports" element={<Protected permission={P.ASSET_READ}><Reports /></Protected>} />
        <Route path="history" element={<Protected permission={P.AUDIT_READ}><History /></Protected>} />
        <Route path="quality" element={<Protected permission={P.ASSET_UPDATE}><DataQuality /></Protected>} />
        <Route path="settings" element={<Protected permission={P.LOOKUP_READ}><Settings /></Protected>} />
        <Route path="profile" element={<Protected><Profile /></Protected>} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}