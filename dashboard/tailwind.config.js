/**
 * Dubai Silicon Oasis Design System (concept v0.1, Nov 2026).
 * Colour: Midnight, Oasis Navy, Signal Blue, Circuit Cyan, Slate, Sky Mist, Cloud.
 * Type: Barlow Condensed (headlines, eyebrows, numbers) + Oxygen (body).
 * Radius: 6 px controls, 12 px cards, full pills for chips.
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Oasis Navy scale: 50 = Sky Mist (tinted panels), 600 = Oasis Navy (primary brand), 900 = Midnight (ink)
        navy: {
          50: '#EBF1F9',
          100: '#DCE6F3',
          200: '#BBCDE6',
          300: '#8DAAD2',
          400: '#5677AB',
          500: '#2C5590',
          600: '#194176',
          700: '#133461',
          800: '#0B264A',
          900: '#011530',
        },
        midnight: '#011530',
        signal: { DEFAULT: '#2F6BF6', 600: '#2459D9', 50: '#EAF0FE' }, // actions, links (white text 4.6:1)
        cyan: { DEFAULT: '#00C2FF' }, // accent on dark, data
        mist: '#EBF1F9',
        cloud: '#F8F9FA',
        ink: '#011530',
        // Slate for large text and lines; Slate Deep #5B677D for small text on white (5.7:1)
        slate: {
          50: '#F8F9FA',
          100: '#EEF1F5',
          200: '#DFE4EB',
          300: '#C5CDD8',
          400: '#94A1B2',
          500: '#748497',
          600: '#5B677D',
          700: '#46516A',
          800: '#2A3550',
          900: '#011530',
        },
      },
      fontFamily: {
        sans: ['Oxygen', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Noto Sans Arabic', 'Arial', 'sans-serif'],
        display: ['"Barlow Condensed"', '"Arial Narrow"', 'ui-sans-serif', 'sans-serif'],
      },
      borderRadius: {
        control: '6px',
        card: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(1,21,48,0.04), 0 2px 8px rgba(1,21,48,0.05)',
      },
    },
  },
  plugins: [],
};
