import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  envDir: process.env.DEPLOY_BUILD === '1' ? false : undefined,
  build: {
    rollupOptions: {
      input: {
        fileAdmin: fileURLToPath(new URL('./files-admin.html', import.meta.url)),
        files: fileURLToPath(new URL('./files.html', import.meta.url)),
        access: fileURLToPath(new URL('./access.html', import.meta.url)),
        univer: fileURLToPath(new URL('./univer.html', import.meta.url)),
        fabric: fileURLToPath(new URL('./fabric.html', import.meta.url)),
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        fortune: fileURLToPath(new URL('./fortune.html', import.meta.url)),
        tabulator: fileURLToPath(new URL('./tabulator.html', import.meta.url)),
      },
    },
  },
});
