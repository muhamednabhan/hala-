/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: {
          50: '#fbf8f0',
          100: '#f5eedb',
          200: '#ebdcb4',
          300: '#dcc283',
          400: '#cfa95a',
          500: '#bf923b',
          600: '#a5782d',
          700: '#855e27',
          800: '#6e4d25',
          900: '#5c4122',
        },
        ink: '#1c1a17',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Noto Sans Arabic', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(28,26,23,0.04), 0 1px 3px rgba(28,26,23,0.06)',
      },
    },
  },
  plugins: [],
};
