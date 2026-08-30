import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, IconButton } from './primitives.jsx';
import { cx } from '../../lib/format.js';

function useLockedScroll(open) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
}

/**
 * Centred dialog on desktop, bottom sheet on phones — same component, so
 * every form in the app gets the right shape for the device it's on.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useLockedScroll(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button" aria-label="Close dialog" onClick={onClose}
        className="absolute inset-0 bg-[rgb(8_12_16/0.55)] backdrop-blur-[2px]"
      />
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className={cx(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden border border-line bg-surface shadow-pop',
          'rounded-t-2xl animate-sheet-up sm:animate-fade-up sm:rounded-card', widths[size]
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <IconButton label="Close" icon={X} onClick={onClose} className="-mr-1 -mt-1" />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>

        {footer && (
          <div className="safe-bottom flex flex-wrap items-center justify-end gap-2 border-t border-line bg-raised px-4 py-3 sm:px-5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Right-hand drawer on desktop, full-height sheet on phones. Used for filters. */
export function Drawer({ open, onClose, title, children, footer }) {
  useLockedScroll(open);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button type="button" aria-label="Close panel" onClick={onClose} className="absolute inset-0 bg-[rgb(8_12_16/0.5)]" />
      <div
        role="dialog" aria-modal="true" aria-label={title}
        className="relative flex h-full w-full max-w-sm flex-col border-l border-line bg-surface shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <IconButton label="Close" icon={X} onClick={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="safe-bottom flex items-center justify-between gap-2 border-t border-line bg-raised px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message,
  confirmLabel = 'Confirm', tone = 'danger', loading,
}) {
  return (
    <Modal
      open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{message}</p>
    </Modal>
  );
}
