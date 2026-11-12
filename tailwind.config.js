/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./site/**/*.{html,js}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Homoarakhn', 'Orbitron', 'system-ui', 'sans-serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [require('daisyui')],
  daisyui: {
    logs: false,
    darkTheme: 'psn',
    themes: [
      {
        psn: {
          'color-scheme': 'dark',
          'base-100': '#000000',
          'base-200': '#0a0a0b',
          'base-300': '#15161a',
          'base-content': '#e8eaf0',
          primary: '#4b7bf5',
          'primary-content': '#ffffff',
          secondary: '#e0a33e',
          'secondary-content': '#1a1205',
          accent: '#7aa2ff',
          'accent-content': '#050810',
          neutral: '#171921',
          'neutral-content': '#c7cbd6',
          info: '#4b7bf5',
          'info-content': '#ffffff',
          success: '#4ade80',
          'success-content': '#04150a',
          warning: '#e0a33e',
          'warning-content': '#1a1205',
          error: '#e05c5c',
          'error-content': '#ffffff',
          '--rounded-box': '0.9rem',
          '--rounded-btn': '0.55rem',
          '--rounded-badge': '999px',
          '--animation-btn': '0.15s',
          '--btn-text-case': 'none',
          '--border-btn': '1px',
          '--tab-radius': '0.5rem',
        },
      },
    ],
  },
};
