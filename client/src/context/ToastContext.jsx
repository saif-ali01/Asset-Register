import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cx } from '../lib/format.js';

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
const TONES = {
  success: 'border-brand/40 bg-brand-soft text-ink',
  error: 'border-danger/40 bg-danger-soft text-ink',
  warning: 'border-amber/40 bg-amber-soft text-ink',
  info: 'border-line bg-surface text-ink',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback((message, tone = 'info', ttl = 4500) => {
    const id = crypto.randomUUID();
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    if (ttl) setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error', 7000),
    warning: (m) => push(m, 'warning'),
    info: (m) => push(m, 'info'),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-20 z-[80] flex flex-col gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];
          return (
            <div
              key={toast.id}
              className={cx(
                'pointer-events-auto flex items-start gap-3 rounded-card border p-3 shadow-pop animate-fade-up',
                TONES[toast.tone]
              )}
            >
              <Icon size={18} className="mt-0.5 shrink-0" />
              <p className="flex-1 text-sm leading-snug">{toast.message}</p>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded p-0.5 text-muted hover:text-ink"
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
