/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        faint: token('faint'),
        brand: { DEFAULT: token('brand'), soft: token('brand-soft'), ink: token('brand-ink') },
        amber: { DEFAULT: token('amber'), soft: token('amber-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        steel: { DEFAULT: token('steel'), soft: token('steel-soft') },
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        eyebrow: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.12em' }],
      },
      borderRadius: { card: '0.625rem' },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 32 / 0.06), 0 1px 3px rgb(15 23 32 / 0.04)',
        pop: '0 12px 40px -8px rgb(15 23 32 / 0.28)',
      },
      keyframes: {
        'fade-up': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.18s ease-out',
        'sheet-up': 'sheet-up 0.24s cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
};
