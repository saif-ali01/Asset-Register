import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cx, initials } from '../../lib/format.js';

const VARIANTS = {
  primary: 'bg-brand text-brand-ink hover:brightness-110 border-transparent',
  secondary: 'bg-surface text-ink border-line hover:bg-raised',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-raised hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-110 border-transparent',
  quiet: 'bg-raised text-ink border-line hover:bg-line/50',
};

const SIZES = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-10 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', loading, icon: Icon, children, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-md border font-medium',
        'transition-[filter,background-color,color] disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant], SIZES[size], className
      )}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
});

export function IconButton({ label, icon: Icon, className, size = 18, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent',
        'text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40',
        className
      )}
    >
      <Icon size={size} />
    </button>
  );
}

export function Field({ label, hint, error, required, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && (
        <span className="mb-1.5 flex items-baseline gap-1 text-sm font-medium text-ink">
          {label}
          {required && <span className="text-danger" aria-hidden>*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL = `w-full rounded-md border bg-surface px-3 text-sm text-ink
  placeholder:text-faint disabled:bg-raised disabled:text-muted`;

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(CONTROL, 'h-10', invalid ? 'border-danger' : 'border-line', className)}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} {...props} className={cx(CONTROL, 'border-line py-2', className)} />;
});

export const Select = forwardRef(function Select({ className, children, invalid, ...props }, ref) {
  return (
    <select
      ref={ref}
      {...props}
      className={cx(CONTROL, 'h-10 appearance-none pr-8', invalid ? 'border-danger' : 'border-line', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238a96a2' d='M6 8.5 1.5 4h9z'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.65rem center',
      }}
    >
      {children}
    </select>
  );
});

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2 text-sm text-ink', className)}>
      <input
        type="checkbox"
        {...props}
        className="h-4 w-4 rounded border-line text-brand accent-[rgb(var(--brand))]"
      />
      {label}
    </label>
  );
}

const TONES = {
  brand: 'bg-brand-soft text-brand border-brand/30',
  amber: 'bg-amber-soft text-amber border-amber/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  steel: 'bg-steel-soft text-steel border-steel/30',
  neutral: 'bg-raised text-muted border-line',
};

export function Badge({ tone = 'neutral', children, className, dot }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium',
        TONES[tone] || TONES.neutral, className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Card({ children, className, as: As = 'div', ...props }) {
  return <As {...props} className={cx('card', className)}>{children}</As>;
}

export function SectionHeader({ eyebrow, title, description, actions, className }) {
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h2 className="text-lg font-semibold text-ink sm:text-xl">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Avatar({ name, src, size = 32, className }) {
  if (src) {
    return (
      <img
        src={src} alt={name} width={size} height={size}
        className={cx('shrink-0 rounded-full border border-line object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-line',
        'bg-raised font-mono font-medium uppercase text-muted', className
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Skeleton({ className }) {
  return <div className={cx('skeleton h-4 w-full', className)} />;
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {Icon && (
        <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-raised text-muted">
          <Icon size={20} />
        </span>
      )}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className, size = 18 }) {
  return <Loader2 size={size} className={cx('animate-spin text-muted', className)} />;
}

export function Toggle({ checked, onChange, label, id }) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button" role="switch" aria-checked={checked} id={id}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
          checked ? 'border-brand bg-brand' : 'border-line bg-raised'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-surface transition-[left]',
            checked ? 'left-[1.15rem]' : 'left-0.5'
          )}
        />
      </button>
      {label && <label htmlFor={id} className="cursor-pointer text-sm text-ink">{label}</label>}
    </div>
  );
}
