import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Builds the embeddable, self-contained widget bundle → public/form-widget.js
// (React + Ant Design inlined). Loaded by external sites via a single <script>.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  publicDir: false,
  build: {
    lib: {
      entry: 'src/widget/entry.ts',
      name: 'NoCodeFormWidget',
      formats: ['iife'],
      fileName: () => 'form-widget.js',
    },
    outDir: 'public',
    emptyOutDir: false,
    minify: 'esbuild',
  },
});
