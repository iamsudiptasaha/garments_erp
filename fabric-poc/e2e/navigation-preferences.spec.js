import { expect, test } from '@playwright/test';

test.use({ actionTimeout: 5000 });

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
  let documentsAdministrator = false;

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
            administrator: documentsAdministrator && actor === first,
            permissions: {
              colours: { view: true },
              productionJobs: { view: true },
              productionChallans: { view: true },
              ...(actor === first && {
                jobWorkerBills: { view: true },
                employees: { view: true },
                materialContacts: { view: true },
                finishedProducts: { view: true },
                adminRoles: { view: documentsAdministrator },
                adminAudit: { view: documentsAdministrator },
              }),
            },
          };
          break;
        case 'erp_admin_snapshot':
          json = { roles: [], accounts: [], users: [], audit: [] };
          break;
        case 'erp_fabric_snapshot':
        case 'erp_production_workspace':
        case 'erp_raw_material_transaction_snapshot':
          json = {};
          break;
        case 'erp_finished_stock_valuation':
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
          expect(args.p_owner).toBe(actor);
          expect([first, second]).toContain(actor);
          if (args.p_grid !== 'workspace-navigation') {
            expect(['finished-goods-valuation', 'files-buckets', 'files-upload-routes']).toContain(
              args.p_grid,
            );
            json = {};
            break;
          }
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
  async function sidebarSnapshot(page) {
    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
    await expect(sidebar).toBeVisible();
    return sidebar.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        text: element.textContent,
        groups: [...element.querySelectorAll('details')].map((section) => ({
          key: section.dataset.navSection,
          open: section.open,
        })),
        layout: [style.width, style.padding, style.backgroundImage, style.position],
        brand: getComputedStyle(element.querySelector('.fabric-brand')).textDecorationLine,
      };
    });
  }
  async function sidebarImage(page) {
    await page.mouse.move(800, 10);
    const sidebar = page.getByRole('complementary', { name: 'Workspace navigation' });
    await sidebar.evaluate((element) => {
      document.activeElement?.blur();
      element.querySelector('.sidebar-navigation-scroll').scrollTop = 0;
    });
    return sidebar.screenshot({
      animations: 'disabled',
      style: `
        #workspace-sidebar [aria-current='page'] {
          background: none !important;
          box-shadow: none !important;
          color: inherit !important;
          font-weight: normal !important;
        }
      `,
    });
  }
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
    await desktop.getByRole('link', { name: 'Challans', exact: true }).click();
    await expect(desktop.getByRole('heading', { name: 'Challans', exact: true })).toBeVisible();
    await expect(desktop.getByRole('link', { name: 'Challans', exact: true })).toBeVisible();
    for (const key of ['administration', 'miscellaneous', 'hr']) {
      await expect(disclosure(desktop, key)).toHaveCount(0);
    }
    await expect(
      disclosure(desktop, 'production').getByText('Worker bills', { exact: true }),
    ).toHaveCount(0);
    await disclosure(desktop, 'account').locator('summary').click();
    await desktop.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(desktop.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(desktop, 'first@example.invalid');
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', false);
    await expect(disclosure(desktop, 'account')).toHaveJSProperty('open', true);
    await disclosure(desktop, 'account').locator('summary').click();
    await expect.poll(() => saved.get(first)?.account).toBe(false);
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
    documentsAdministrator = true;
    await desktop.goto('/fabric.html?live=1');
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', false);
    const workspace = await sidebarSnapshot(desktop);
    const workspaceImage = await sidebarImage(desktop);
    const production = disclosure(desktop, 'production');
    await expect(production.getByRole('button').nth(0)).toHaveText('Task Board');
    await expect(production.getByRole('button').nth(1)).toHaveText('Update Tasks');
    await desktop.getByRole('link', { name: 'Challans', exact: true }).click();
    await expect(desktop).toHaveURL(/production-challan[.]html#challans$/);
    for (const page of ['Challans', 'Worker bills']) {
      await expect(desktop.getByRole('link', { name: page, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect.poll(() => sidebarSnapshot(desktop)).toEqual(workspace);
      expect((await sidebarImage(desktop)).equals(workspaceImage)).toBe(true);
      if (page === 'Challans')
        await desktop.getByRole('link', { name: 'Worker bills', exact: true }).click();
    }
    await desktop
      .getByRole('navigation', { name: 'Finished Goods pages' })
      .getByRole('button', { name: 'Stock valuation' })
      .click();
    await expect(desktop).toHaveURL(/finishedGoods=valuation#finishedProducts$/);
    await expect(desktop.getByRole('heading', { name: 'Stock valuation' })).toBeVisible();
    await expect(desktop.getByRole('button', { name: 'Stock valuation' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await desktop.getByRole('button', { name: 'Roles & permissions' }).click();
    await expect(desktop).toHaveURL(/access[.]html#adminRoles$/);
    await expect.poll(() => sidebarSnapshot(desktop)).toEqual(workspace);
    await desktop.getByRole('link', { name: 'Saved-record files' }).click();
    await expect(desktop).toHaveURL(/files[.]html$/);
    await expect.poll(() => sidebarSnapshot(desktop)).toEqual(workspace);
    await expect(desktop.getByRole('link', { name: 'Saved-record files' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await desktop.getByRole('link', { name: 'Bucket groups' }).click();
    await expect(desktop).toHaveURL(/files-admin[.]html$/);
    await expect.poll(() => sidebarSnapshot(desktop)).toEqual(workspace);
    await expect(desktop.getByRole('link', { name: 'Bucket groups' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await phone.reload();
    await expect(disclosure(phone, 'production')).toHaveJSProperty('open', true);
    await expect(disclosure(phone, 'colours')).toHaveJSProperty('open', false);
    await phone.getByRole('button', { name: 'Show menu' }).click();
    const mobile = await sidebarSnapshot(phone);
    await phone.getByRole('link', { name: 'Worker bills', exact: true }).click();
    await expect.poll(() => sidebarSnapshot(phone)).toEqual(mobile);
    await phone.keyboard.press('Escape');
    await expect(phone.getByRole('button', { name: 'Show menu' })).toBeFocused();
    await expect(phone.getByRole('complementary', { name: 'Workspace navigation' })).toBeHidden();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
