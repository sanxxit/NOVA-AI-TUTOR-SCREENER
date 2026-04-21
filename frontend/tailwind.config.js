/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream:            '#09090B',
        'cream-dark':     '#27272A',
        charcoal:         '#FAFAFA',
        'charcoal-light': '#A1A1AA',
        amber:            '#8B5CF6',
        'amber-light':    'rgba(139,92,246,0.10)',
        'warm-gray':      '#71717A',
        sage:             '#10B981',
        lavender:         '#A78BFA',
      },
      fontFamily: {
        serif: ['Inter', 'system-ui', 'sans-serif'],
        sans:  ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'warm-sm':    '0 1px 3px rgba(0,0,0,0.5)',
        'warm-md':    '0 4px 24px rgba(0,0,0,0.6)',
        'warm-lg':    '0 10px 40px rgba(0,0,0,0.7)',
        'glow-violet':'0 0 20px rgba(139,92,246,0.35)',
        'glow-white': '0 0 15px rgba(255,255,255,0.15)',
      },
      keyframes: {
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
      },
      animation: {
        'fade-in':    'fade-in 0.45s ease-out forwards',
        'pulse-slow': 'pulse-slow 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
