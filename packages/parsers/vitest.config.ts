import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom', // Provides DOMParser in Node — Amd-6
    passWithNoTests: true,    // M0: no parser tests yet — added in M1
  },
});

