import { NavLink } from 'react-router-dom';
import { NAV } from './navigation.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { cx } from '../../lib/format.js';

/** Thumb-reach tab bar. Only the five most-used destinations appear here. */
export function MobileNav() {
  const { can } = useAuth();
  const items = NAV.filter((item) => item.mobile && can(item.permission)).slice(0, 5);

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      <ul className="flex items-stretch">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to} end={end}
              className={({ isActive }) =>
                cx(
                  'flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[0.6875rem] font-medium transition-colors',
                  isActive ? 'text-brand' : 'text-faint'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                      isActive && 'bg-brand-soft'
                    )}
                  >
                    <Icon size={19} />
                  </span>
                  <span className="truncate">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
