import {
  BarChart3, Boxes, ClipboardList, History, LayoutDashboard,
  ShieldAlert, Settings2, Users, Wrench,
} from 'lucide-react';
import { P } from '../../lib/constants.js';

/** Single source of truth for both the desktop rail and the mobile tab bar. */
export const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, permission: P.DASHBOARD_READ, end: true, mobile: true },
  { to: '/assets', label: 'Assets', icon: Boxes, permission: P.ASSET_READ, mobile: true },
  { to: '/custody', label: 'Custody', icon: ClipboardList, permission: P.ASSIGNMENT_READ, mobile: true },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench, permission: P.MAINTENANCE_READ, mobile: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, permission: P.ASSET_READ },
  { to: '/history', label: 'History', icon: History, permission: P.AUDIT_READ },
  { to: '/quality', label: 'Data quality', icon: ShieldAlert, permission: P.ASSET_UPDATE },
  { to: '/people', label: 'People', icon: Users, permission: P.USER_READ },
  { to: '/settings', label: 'Settings', icon: Settings2, permission: P.LOOKUP_READ, mobile: true },
];
