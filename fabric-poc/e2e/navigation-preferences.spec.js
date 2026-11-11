import { expect, test } from '@playwright/test';

test('navigation disclosures survive refresh, sign-out and separate sessions per account', async ({
  browser,
}) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses local authenticated fixtures');
  const first = '00000000-0000-4000-8000-000000000001';
  const second = '00000000-0000-4000-8000-000000000002';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const saved = new Map();
  const reads = [];
  const contexts = [];

  async function open(viewport) {
    const context = await browser.newContext({ viewport });
    contexts.push(context);
    await context.route('https://example.invalid/**', async (route) => {
      const request = route.request();
      const name = new URL(request.url()).pathname.split('/').at(-1);
      const args = request.postDataJSON();
      const token = request.headers().authorization?.split(' ')[1];
      const payload = token?.split('.')[1];
      const actor = payload ? JSON.parse(Buffer.from(payload, 'base64url').toString()).sub : null;
      let json;
      switch (name) {
        case 'settings':
          json = { external: {} };
          break;
        case 'token': {
          const userId = args.email === 'second@example.invalid' ? second : first;
          const exp = Math.floor(Date.now() / 1000) + 3600;
          json = {
            access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, exp, aal: 'aal2' })}.synthetic`,
            refresh_token: 'synthetic-refresh',
            expires_in: 3600,
            expires_at: exp,
            token_type: 'bearer',
            user: { id: userId, email: args.email, aud: 'authenticated', role: 'authenticated' },
          };
          break;
        }
        case 'logout':
          return route.fulfill({ status: 204 });
        case 'erp_account_security':
          json = { enabled: true, ready: true };
          break;
        case 'erp_access_snapshot':
          json = {
            actor,
            enabled: true,
            permissions: { colours: { view: true }, productionJobs: { view: true } },
          };
          break;
        case 'erp_fabric_snapshot':
        case 'erp_production_workspace':
          json = {};
          break;
        case 'erp_dyed_bill_verifiers':
        case 'erp_file_registry':
        case 'erp_file_routes':
          json = [];
          break;
        case 'erp_challan_documents':
          json = {
            assignments: [],
            employees: [],
            challans: [],
            bills: [],
            permissions: {},
            pages: { challans: true, billing: true },
          };
          break;
        case 'erp_grid_preferences':
          expect(args).toMatchObject({ p_grid: 'workspace-navigation', p_owner: actor });
          expect([first, second]).toContain(actor);
          if (args.p_patch) saved.set(actor, { ...saved.get(actor), ...args.p_patch });
          else reads.push(actor);
          json = saved.get(actor) ?? {};
          break;
        default:
          throw Error('Unexpected navigation fixture request ' + name);
      }
      await route.fulfill({ json });
    });
    return context.newPage();
  }

  async function signIn(page, email) {
    await page.goto('/access.html');
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/fabric[.]html[?]live=1/);
  }

  const disclosure = (page, key) => page.locator(`details[data-nav-section="${key}"]`);
  try {
    const desktop = await open({ width: 1440, height: 900 });
    await signIn(desktop, 'first@example.invalid');
    await expect.poll(() => reads.includes(first)).toBe(true);
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', true);
    await disclosure(desktop, 'colours').locator('summary').press('Enter');
    await disclosure(desktop, 'production').locator('summary').click();
    await expect.poll(() => saved.get(first)).toMatchObject({ colours: false, production: false });
    await desktop.reload();
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', false);
    await expect(disclosure(desktop, 'production')).toHaveJSProperty('open', false);
    await expect(disclosure(desktop, 'files')).toHaveJSProperty('open', true);

    const phone = await open({ width: 390, height: 844 });
    await signIn(phone, 'first@example.invalid');
    await expect(disclosure(phone, 'colours')).toHaveJSProperty('open', false);
    await expect(disclosure(phone, 'production')).toHaveJSProperty('open', false);

    await disclosure(desktop, 'account').locator('summary').click();
    await desktop.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(desktop.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(desktop, 'second@example.invalid');
    await expect.poll(() => reads.includes(second)).toBe(true);
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', true);
    await expect(disclosure(desktop, 'production')).toHaveJSProperty('open', true);
    await expect(disclosure(desktop, 'account')).toHaveJSProperty('open', false);
    await disclosure(desktop, 'account').locator('summary').click();
    await desktop.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(desktop.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(desktop, 'first@example.invalid');
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', false);
    await expect(disclosure(desktop, 'account')).toHaveJSProperty('open', true);
    await desktop.goto('/access.html');
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', false);
    await desktop.goto('/files.html');
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', false);
    await desktop.goto('/production-challan.html#challans');
    await expect(disclosure(desktop, 'production')).toHaveJSProperty('open', false);
    await disclosure(desktop, 'production').locator('summary').click();
    await expect.poll(() => saved.get(first)?.production).toBe(true);
    await expect(desktop.getByRole('link', { name: 'Challans', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await phone.reload();
    await expect(disclosure(phone, 'production')).toHaveJSProperty('open', true);
    await expect(disclosure(phone, 'colours')).toHaveJSProperty('open', false);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
