import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, ScanBarcode } from 'lucide-react';
import { NAV } from './navigation.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { cx, titleCase } from '../../lib/format.js';

export function Sidebar({ collapsed, onToggle }) {
  const { can, user, roleInfo } = useAuth();
  const items = NAV.filter((item) => can(item.permission));

  return (
    <aside
      className={cx(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface lg:flex',
        collapsed ? 'w-[68px]' : 'w-60'
      )}
    >
      <div className={cx('flex h-14 items-center gap-2.5 border-b border-line px-4', collapsed && 'justify-center px-0')}>
        <ScanBarcode size={20} className="shrink-0 text-brand" />
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold tracking-tight text-ink">Asset Register</p>
            <p className="truncate font-mono text-[0.625rem] uppercase tracking-widest text-faint">
              {roleInfo?.label || titleCase(user?.role || '')}
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end} title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cx(
                'group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-raised hover:text-ink'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" />}
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line p-2">
        <button
          type="button" onClick={onToggle}
          className={cx(
            'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted hover:bg-raised hover:text-ink',
            collapsed && 'justify-center px-0'
          )}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}
