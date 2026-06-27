/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#07090f',
          2: '#0c0f18',
          3: '#111520',
          4: '#181d2c',
          5: '#1e2436',
        },
        border: {
          DEFAULT: '#1c2235',
          2: '#252d42',
        },
        ink: {
          DEFAULT: '#cdd3e8',
          muted: '#4a5470',
          dim: '#6b7494',
        },
        brand: {
          green: '#00d4a0',
          red: '#ff3c4e',
          yellow: '#f5a623',
          blue: '#3d9eff',
          purple: '#7c5cfc',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        throb: 'throb 2s ease-in-out infinite',
        'throb-green': 'throb-green 2s ease-in-out infinite',
      },
      keyframes: {
        throb: {
          '0%, 100%': { boxShadow: '0 0 6px 1px rgba(255, 60, 78, 0.4)' },
          '50%': { boxShadow: '0 0 14px 4px rgba(255, 60, 78, 0.7)' },
        },
        'throb-green': {
          '0%, 100%': { boxShadow: '0 0 6px 1px rgba(0, 212, 160, 0.4)' },
          '50%': { boxShadow: '0 0 14px 4px rgba(0, 212, 160, 0.7)' },
        },
      },
    },
  },
  plugins: [],
}
