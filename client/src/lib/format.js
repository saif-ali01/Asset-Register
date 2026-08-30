const RUPEE_LOCALE = 'en-IN';

export function money(value, currency = 'INR') {
  if (value === null || value === undefined || value === '') return '—';
  try {
    return new Intl.NumberFormat(RUPEE_LOCALE, {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${Number(value).toLocaleString(RUPEE_LOCALE)}`;
  }
}

export function compactMoney(value, currency = 'INR') {
  if (!value) return money(0, currency);
  return new Intl.NumberFormat(RUPEE_LOCALE, {
    style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
  }).format(value);
}

export function date(value, opts = {}) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(RUPEE_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', ...opts,
  });
}

export function dateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(RUPEE_LOCALE, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function relative(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const units = [
    ['year', 31536000000], ['month', 2592000000], ['day', 86400000],
    ['hour', 3600000], ['minute', 60000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      const n = Math.round(diff / ms);
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-n, unit);
    }
  }
  return 'just now';
}

export function daysUntil(value) {
  if (!value) return null;
  return Math.ceil((new Date(value) - Date.now()) / 86400000);
}

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';

export const titleCase = (s = '') => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const cx = (...parts) => parts.filter(Boolean).join(' ');
