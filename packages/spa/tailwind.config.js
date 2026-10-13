/** @type {import('tailwindcss').Config} */
// LIGHT THEME via palette inversion: the codebase was written dark-first
// (bg-gray-950 = darkest surface, text-gray-100 = brightest text).
// Each scale below is the default Tailwind palette mirrored (50<->950, 100<->900, ...)
// so existing class names render light without touching ~1,500 usages.
// Semantics: gray-950 = card/white surface, gray-700 = hairline border, gray-100 = primary text.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        altera: {
          blue:  '#0054A6',
          teal:  '#008A93',
          dark:  '#1A2B3C',
        },
        gray: {
          50:  '#0b1220',
          100: '#1f2937',
          200: '#2e3847',
          300: '#3f4a5a',
          400: '#5b6472',
          500: '#6e7786',
          600: '#d1d5db',
          700: '#e5e7eb',
          800: '#f3f4f6',
          900: '#f9fafb',
          950: '#ffffff',
        },
        slate: {
          50:  '#0f172a',
          100: '#1e293b',
          200: '#334155',
          300: '#475569',
          400: '#5a6b82',
          500: '#64748b',
          600: '#cbd5e1',
          700: '#e2e8f0',
          800: '#f1f5f9',
          900: '#f8fafc',
          950: '#ffffff',
        },
        red: {
          50:  '#450a0a', 100: '#7f1d1d', 200: '#991b1b', 300: '#b91c1c',
          400: '#dc2626', 500: '#ef4444', 600: '#f87171', 700: '#fca5a5',
          800: '#fecaca', 900: '#fee2e2', 950: '#fef2f2',
        },
        orange: {
          50:  '#431407', 100: '#7c2d12', 200: '#9a3412', 300: '#c2410c',
          400: '#ea580c', 500: '#f97316', 600: '#fb923c', 700: '#fdba74',
          800: '#fed7aa', 900: '#ffedd5', 950: '#fff7ed',
        },
        amber: {
          50:  '#451a03', 100: '#78350f', 200: '#92400e', 300: '#b45309',
          400: '#d97706', 500: '#f59e0b', 600: '#fbbf24', 700: '#fcd34d',
          800: '#fde68a', 900: '#fef3c7', 950: '#fffbeb',
        },
        yellow: {
          50:  '#422006', 100: '#713f12', 200: '#854d0e', 300: '#a16207',
          400: '#ca8a04', 500: '#eab308', 600: '#facc15', 700: '#fde047',
          800: '#fef08a', 900: '#fef9c3', 950: '#fefce8',
        },
        green: {
          50:  '#052e16', 100: '#14532d', 200: '#166534', 300: '#15803d',
          400: '#16a34a', 500: '#22c55e', 600: '#4ade80', 700: '#86efac',
          800: '#bbf7d0', 900: '#dcfce7', 950: '#f0fdf4',
        },
        emerald: {
          50:  '#022c22', 100: '#064e3b', 200: '#065f46', 300: '#047857',
          400: '#059669', 500: '#10b981', 600: '#34d399', 700: '#6ee7b7',
          800: '#a7f3d0', 900: '#d1fae5', 950: '#ecfdf5',
        },
        teal: {
          50:  '#042f2e', 100: '#134e4a', 200: '#115e59', 300: '#0f766e',
          400: '#0d9488', 500: '#14b8a6', 600: '#2dd4bf', 700: '#5eead4',
          800: '#99f6e4', 900: '#ccfbf1', 950: '#f0fdfa',
        },
        cyan: {
          50:  '#083344', 100: '#164e63', 200: '#155e75', 300: '#0e7490',
          400: '#0891b2', 500: '#06b6d4', 600: '#22d3ee', 700: '#67e8f9',
          800: '#a5f3fc', 900: '#cffafe', 950: '#ecfeff',
        },
        sky: {
          50:  '#082f49', 100: '#0c4a6e', 200: '#075985', 300: '#0369a1',
          400: '#0284c7', 500: '#0ea5e9', 600: '#38bdf8', 700: '#7dd3fc',
          800: '#bae6fd', 900: '#e0f2fe', 950: '#f0f9ff',
        },
        blue: {
          50:  '#172554', 100: '#1e3a8a', 200: '#1e40af', 300: '#1d4ed8',
          400: '#2563eb', 500: '#3b82f6', 600: '#60a5fa', 700: '#93c5fd',
          800: '#bfdbfe', 900: '#dbeafe', 950: '#eff6ff',
        },
        fuchsia: {
          50:  '#4a044e', 100: '#701a75', 200: '#86198f', 300: '#a21caf',
          400: '#c026d3', 500: '#d946ef', 600: '#e879f9', 700: '#f0abfc',
          800: '#f5d0fe', 900: '#fae8ff', 950: '#fdf4ff',
        },
        rose: {
          50:  '#4c0519', 100: '#881337', 200: '#9f1239', 300: '#be123c',
          400: '#e11d48', 500: '#f43f5e', 600: '#fb7185', 700: '#fda4af',
          800: '#fecdd3', 900: '#ffe4e6', 950: '#fff1f2',
        },
      },
    },
  },
  plugins: [],
};
