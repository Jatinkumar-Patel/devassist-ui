/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        altera: {
          blue:  '#0054A6',
          teal:  '#00A3AD',
          dark:  '#1A2B3C',
        },
      },
    },
  },
  plugins: [],
};
