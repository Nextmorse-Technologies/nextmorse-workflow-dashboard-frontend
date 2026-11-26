import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths so the static build works from any subfolder on
// nextmorse.com (e.g. /dashboard/). The site shell assets (css/style.css,
// images/logo.svg) are referenced root-absolute in index.html — the site
// itself lives at the domain root, so they resolve from any subfolder.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
