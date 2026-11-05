export default {
  content: [
    './src/production-prototype/**/*.{ts,tsx}',
    './src/production-task-board/**/*.{ts,tsx}',
  ],
  corePlugins: { preflight: false },
  theme: {
    extend: { colors: { primary: '#7862da', secondary: '#f6f7fb', background: '#ffffff' } },
  },
};
