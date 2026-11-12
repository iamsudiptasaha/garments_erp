import { defineConfig, devices } from '@playwright/test';

const localPort = Number(process.env.E2E_LOCAL_PORT || 8771);
if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) {
  throw Error('E2E_LOCAL_PORT must be an unprivileged TCP port.');
}
const localDirectory = process.env.E2E_LOCAL_DIST || 'dist';
if (/['\r\n]/.test(localDirectory))
  throw Error('E2E_LOCAL_DIST contains an unsupported character.');
const localURL = `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || localURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `python3 -m http.server ${localPort} --bind 127.0.0.1 --directory '${localDirectory}'`,
        url: localURL,
        reuseExistingServer: false,
      },
});
