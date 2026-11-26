import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './',
  plugins: [svelte(), viteStaticCopy({
    targets: ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map(dir => ({
      src: 'node_modules/pdfjs-dist/' + dir,
      dest: 'pdfjs',
    })),
  })],
});
