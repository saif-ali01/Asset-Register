import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LogOut, Monitor, Moon, Plus, ScanBarcode, Search, Sun, UserCircle2,
} from 'lucide-react';
import { Avatar, IconButton } from '../ui/primitives.jsx';
import { AssetTag } from '../ui/data.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useDebounced } from '../../hooks/useApi.js';
import { api } from '../../lib/api.js';
import { P } from '../../lib/constants.js';
import { cx, titleCase } from '../../lib/format.js';

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor };

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term, 250);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (debounced.trim().length < 2) { setResults([]); return; }
    let live = true;
    api.get('/assets', { search: debounced, limit: 6 })
      .then((res) => live && setResults(res.items))
      .catch(() => live && setResults([]));
    return () => { live = false; };
  }, [debounced]);

  const go = (id) => {
    setOpen(false);
    setTerm('');
    navigate(`/assets/${id}`);
  };

  return (
    <div className="relative flex-1 sm:max-w-md">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search tag, name or serial"
        aria-label="Search assets"
        className="h-9 w-full rounded-md border border-line bg-raised pl-9 pr-14 text-sm text-ink placeholder:text-faint"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.625rem] text-faint sm:block">
        ⌘K
      </kbd>

      {open && results.length > 0 && (
        <ul className="absolute inset-x-0 top-11 z-50 overflow-hidden rounded-card border border-line bg-surface shadow-pop animate-fade-up">
          {results.map((asset) => (
            <li key={asset._id}>
              <button
                type="button" onMouseDown={() => go(asset._id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-raised"
              >
                <AssetTag value={asset.tag} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{asset.name}</span>
                <span className="hidden truncate font-mono text-xs text-faint sm:block">{asset.serialNumber || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountMenu() {
  const { user, roleInfo, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md p-1 hover:bg-raised"
        aria-label="Account menu" aria-expanded={open}
      >
        <Avatar name={user?.name} src={user?.avatarUrl} size={30} />
      </button>

      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-card border border-line bg-surface shadow-pop animate-fade-up">
            <div className="border-b border-line px-3 py-3">
              <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
              <p className="mt-1.5 font-mono text-[0.625rem] uppercase tracking-widest text-brand">
                {roleInfo?.label || titleCase(user?.role || '')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/profile'); }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-ink hover:bg-raised"
            >
              <UserCircle2 size={16} className="text-muted" /> Your profile
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); logout(); }}
              className="flex w-full items-center gap-2.5 border-t border-line px-3 py-2.5 text-sm text-danger hover:bg-danger-soft"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TopBar() {
  const { mode, cycle, setMode } = useTheme();
  const { can } = useAuth();
  const ThemeIcon = THEME_ICON[mode];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="Asset Register home">
          <ScanBarcode size={20} className="text-brand" />
        </Link>

        {can(P.ASSET_READ) ? <GlobalSearch /> : <div className="flex-1" />}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {can(P.ASSET_CREATE) && (
            <Link
              to="/assets/new"
              className="hidden h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-xs font-medium text-brand-ink hover:brightness-110 sm:inline-flex"
            >
              <Plus size={15} /> Add asset
            </Link>
          )}
          <IconButton
            label={`Theme: ${mode} — click to change`}
            icon={ThemeIcon}
            onClick={cycle}
            onContextMenu={(e) => { e.preventDefault(); setMode('system'); }}
          />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
