import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
import { NAV } from './navigation.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { cx } from '../../lib/format.js';

/**
 * Thumb-reach tab bar.
 *
 * Only four destinations fit comfortably across a phone, but the app has
 * nine — so the fifth slot is a "More" button opening a sheet with everything
 * that did not fit. Without it, Reports, History, Data quality and People are
 * simply unreachable on a phone, which is how they were before.
 */
export function MobileNav() {
  const { can } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  const allowed = NAV.filter((item) => can(item.permission));
  const primary = allowed.filter((item) => item.mobile).slice(0, 4);
  const primaryPaths = new Set(primary.map((i) => i.to));
  const overflow = allowed.filter((item) => !primaryPaths.has(item.to));

  // Any navigation closes the sheet, including the browser back button.
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  const overflowActive = overflow.some((item) => location.pathname.startsWith(item.to) && item.to !== '/');

  return (
    <>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
        <ul className="flex items-stretch">
          {primary.map(({ to, label, icon: Icon, end }) => (
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

          {overflow.length > 0 && (
            <li className="flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-expanded={moreOpen}
                aria-label={`More sections (${overflow.length})`}
                className={cx(
                  'flex w-full flex-col items-center gap-0.5 px-1 pb-1.5 pt-2 text-[0.6875rem] font-medium transition-colors',
                  moreOpen || overflowActive ? 'text-brand' : 'text-faint'
                )}
              >
                <span
                  className={cx(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    (moreOpen || overflowActive) && 'bg-brand-soft'
                  )}
                >
                  <MoreHorizontal size={19} />
                </span>
                <span className="truncate">More</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      {moreOpen && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end lg:hidden">
          <button
            type="button" aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-[rgb(8_12_16/0.55)] backdrop-blur-[2px]"
          />
          <div
            role="dialog" aria-modal="true" aria-label="More sections"
            className="safe-bottom relative w-full rounded-t-2xl border border-line bg-surface pb-2 shadow-pop animate-sheet-up"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">More</h2>
              <button
                type="button" onClick={() => setMoreOpen(false)}
                aria-label="Close" className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            <ul className="max-h-[60dvh] overflow-y-auto p-2">
              {overflow.map(({ to, label, icon: Icon, end }) => (
                <li key={to}>
                  <NavLink
                    to={to} end={end}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors',
                        isActive ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-raised'
                      )
                    }
                  >
                    <Icon size={18} className="shrink-0" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
