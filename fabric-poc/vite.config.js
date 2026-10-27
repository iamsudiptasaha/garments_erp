import {defineConfig} from 'vite';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({build:{rollupOptions:{input:{univer:fileURLToPath(new URL('./univer.html',import.meta.url)),fabric:fileURLToPath(new URL('./fabric.html',import.meta.url)),main:fileURLToPath(new URL('./index.html',import.meta.url)),fortune:fileURLToPath(new URL('./fortune.html',import.meta.url)),tabulator:fileURLToPath(new URL('./tabulator.html',import.meta.url))}}}});
