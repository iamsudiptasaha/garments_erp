import { expect, test } from '@playwright/test';

test.use({ actionTimeout: 5000 });

test('navigation disclosures survive refresh, sign-out and separate sessions per account', async ({
  browser,
}, testInfo) => {
  test.skip(!!process.env.E2E_BASE_URL, 'Uses local authenticated fixtures');
  const first = '00000000-0000-4000-8000-000000000001';
  const second = '00000000-0000-4000-8000-000000000002';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const saved = new Map();
  const reads = [];
  const contexts = [];
  let documentsAdministrator = false;
  let securityReady = true;
  const fileRequests = [];
  const documentReads = [];

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
          json = { enabled: true, ready: securityReady, mustChangePassword: !securityReady };
          break;
        case 'erp_access_snapshot':
          json = {
            actor,
            enabled: true,
            administrator: documentsAdministrator && actor === first,
            permissions: {
              colours: { view: true },
              productionJobs: { view: true, edit: actor === first },
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
          expect(actor).toBe(first);
          json = { roles: [], accounts: [], employees: [], users: [], audit: [] };
          break;
        case 'erp_fabric_snapshot':
        case 'erp_production_workspace':
        case 'erp_raw_material_transaction_snapshot':
          json = {};
          break;
        case 'erp_finished_stock_valuation':
        case 'erp_dyed_bill_verifiers':
        case 'erp_file_registry':
          fileRequests.push(actor);
          json = [
            {
              id: 'jobs',
              group: 'jobs',
              bucket_id: 'private-jobs',
              private: true,
              mime: ['application/pdf'],
              max_bytes: 1048576,
              route_count: 1,
            },
          ];
          break;
        case 'erp_file_routes':
          json = [
            {
              key: 'fixture',
              resource: 'productionJobs',
              table: 'job',
              slot: 'attachment',
              group: 'jobs',
              bucket_group_id: 'jobs',
              mime: ['application/pdf'],
              max_bytes: 1048576,
              enabled: true,
            },
          ];
          break;
        case 'erp_file_records':
          expect(args.p_key).toBe('fixture');
          json = [{ id: '7', label: 'Saved production job' }];
          break;
        case 'erp_file_list':
          expect(args).toMatchObject({ p_key: 'fixture', p_record_id: '7' });
          json = [];
          break;
        case 'erp_challan_documents':
          documentReads.push({ actor, billing: args.p_billing });
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
            expect([
              'finished-goods-valuation',
              'administration-accounts',
              'files-buckets',
              'files-upload-routes',
            ]).toContain(args.p_grid);
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
    await phone.goto('/production-challan.html#worker-bills');
    await expect(phone.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(phone, 'first@example.invalid');
    await expect(disclosure(phone, 'colours')).toHaveJSProperty('open', false);
    await expect(disclosure(phone, 'production')).toHaveJSProperty('open', false);

    await disclosure(desktop, 'production').locator('summary').click();
    await desktop.getByRole('link', { name: 'Challans', exact: true }).click();
    await expect(desktop.getByText('No matching challans')).toBeVisible();
    await desktop.getByRole('searchbox', { name: 'Search challans' }).fill('first account only');
    await disclosure(desktop, 'production').locator('summary').click();
    await expect.poll(() => saved.get(first)?.production).toBe(false);
    expect(documentReads).toContainEqual({ actor: first, billing: false });

    await disclosure(desktop, 'account').locator('summary').click();
    await desktop.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(desktop.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await signIn(desktop, 'second@example.invalid');
    await expect.poll(() => reads.includes(second)).toBe(true);
    await expect(disclosure(desktop, 'colours')).toHaveJSProperty('open', true);
    await expect(disclosure(desktop, 'production')).toHaveJSProperty('open', true);
    await expect(disclosure(desktop, 'account')).toHaveJSProperty('open', false);
    await desktop.getByRole('link', { name: 'Challans', exact: true }).click();
    await expect(desktop.getByText('No matching challans')).toBeVisible();
    await expect(desktop.getByRole('searchbox', { name: 'Search challans' })).toHaveValue('');
    expect(documentReads).toContainEqual({ actor: second, billing: false });
    await expect(desktop.getByRole('link', { name: 'Challans', exact: true })).toBeVisible();
    for (const key of ['administration', 'miscellaneous', 'hr']) {
      await expect(disclosure(desktop, key)).toHaveCount(0);
    }
    await expect(
      disclosure(desktop, 'production').getByText('Worker bills', { exact: true }),
    ).toHaveCount(0);
    await desktop.goto('/access.html#adminAccess');
    await expect(desktop.getByText(/Administration is restricted/)).toBeVisible();
    const priorFileRequests = fileRequests.filter((actor) => actor === second).length;
    await desktop.goto('/files-admin.html');
    await expect(desktop.getByText('Administrator access required.')).toBeVisible();
    await expect(desktop.getByRole('link', { name: 'Open files' })).toHaveCount(0);
    expect(fileRequests.filter((actor) => actor === second)).toHaveLength(priorFileRequests);
    await desktop.getByRole('link', { name: 'Saved-record files' }).click();
    await expect(desktop.getByLabel('Document type')).toHaveValue('fixture');
    await desktop.getByRole('combobox', { name: 'Saved record' }).fill('production');
    await desktop.getByRole('option', { name: 'Saved production job · #7' }).click();
    await expect(desktop.locator('input[type=file]')).toHaveCount(0);
    await desktop.goto('/production-challan.html#worker-bills');
    await expect(desktop.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
    expect(documentReads).not.toContainEqual({ actor: second, billing: true });
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
    const shell = await desktop.locator('.fabric-shell').elementHandle();
    const sidebar = await desktop.locator('#workspace-sidebar').elementHandle();
    const documentRequests = [];
    const trackDocuments = (request) => {
      if (request.isNavigationRequest() && request.frame() === desktop.mainFrame())
        documentRequests.push(request.url());
    };
    desktop.on('request', trackDocuments);
    const expectSameShell = async () => {
      expect(documentRequests).toEqual([]);
      expect(await shell.evaluate((node) => node === document.querySelector('.fabric-shell'))).toBe(
        true,
      );
      expect(
        await sidebar.evaluate((node) => node === document.querySelector('#workspace-sidebar')),
      ).toBe(true);
    };
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
      await expect(desktop.getByRole('heading', { name: page, exact: true })).toBeVisible();
      await expectSameShell();
      await expect.poll(() => sidebarSnapshot(desktop)).toEqual(workspace);
      expect((await sidebarImage(desktop)).equals(workspaceImage)).toBe(true);
      if (page === 'Challans') {
        await desktop.getByRole('searchbox', { name: 'Search challans' }).fill('retained search');
        await desktop.getByRole('link', { name: 'Worker bills', exact: true }).click();
      }
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
    await desktop.goBack();
    await expect(desktop).toHaveURL(/production-challan[.]html#worker-bills$/);
    await expect(desktop.getByRole('heading', { name: 'Worker bills', exact: true })).toBeVisible();
    await desktop.goBack();
    await expect(desktop.getByRole('searchbox', { name: 'Search challans' })).toHaveValue(
      'retained search',
    );
    await desktop.goForward();
    await expect(desktop.getByRole('heading', { name: 'Worker bills', exact: true })).toBeVisible();
    await desktop.goForward();
    await expect(desktop).toHaveURL(/finishedGoods=valuation#finishedProducts$/);
    await expect(desktop.getByRole('heading', { name: 'Stock valuation' })).toBeVisible();

    await disclosure(desktop, 'colours').locator('summary').click();
    await disclosure(desktop, 'colours').getByRole('button', { name: 'Colour library' }).click();
    await expect(
      desktop.getByRole('heading', { name: 'Colour library', exact: true }),
    ).toBeVisible();
    await desktop.getByRole('button', { name: 'Fabric overview', exact: true }).click();
    await expect(desktop).toHaveURL(/#fabricOverview$/);
    await desktop.getByRole('link', { name: 'Worker bills', exact: true }).click();
    await expect(desktop.getByRole('heading', { name: 'Worker bills', exact: true })).toBeVisible();
    await expectSameShell();
    await disclosure(desktop, 'colours').locator('summary').click();
    await expect.poll(() => saved.get(first)?.colours).toBe(false);
    const admin = desktop.getByRole('navigation', { name: 'Administration pages' });
    const roles = admin.getByRole('link', { name: 'Roles & permissions' });
    await roles.click();
    await expect(desktop).toHaveURL(/access[.]html#adminRoles$/);
    await expect(desktop.getByRole('heading', { name: 'Roles', exact: true })).toBeVisible();
    const main = desktop.getByRole('main');
    await main.getByRole('button', { name: 'Account access', exact: true }).click();
    await expect(desktop).toHaveURL(/access[.]html#adminAccess$/);
    await expect(main.getByRole('heading', { name: 'Employee account access' })).toBeVisible();
    await main.getByRole('button', { name: 'Activity log', exact: true }).click();
    await expect(desktop).toHaveURL(/access[.]html#adminAudit$/);
    await expect(main.getByText('No access changes recorded.')).toBeVisible();
    await desktop.goBack();
    await expect(main.getByRole('heading', { name: 'Employee account access' })).toBeVisible();
    await desktop.goForward();
    await expect(main.getByRole('button', { name: 'Activity log' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectSameShell();

    const destinations = [
      [roles, '/access.html#adminRoles', 'Roles'],
      [desktop.getByRole('link', { name: 'Saved-record files' }), '/files.html', 'Files'],
      [admin.getByRole('link', { name: 'Bucket groups' }), '/files-admin.html', 'Bucket groups'],
    ];
    for (const [link, path, title] of destinations) {
      await expect(link).toHaveAttribute('href', path);
      await link.click();
      await expect(main.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect.poll(() => sidebarSnapshot(desktop)).toEqual(workspace);
      await expectSameShell();
      await desktop.mouse.move(2, 2);
      await desktop.evaluate(() => document.activeElement?.blur());
      const shotOptions = { animations: 'disabled', caret: 'hide' };
      if (title === 'Files') {
        await expect(main.getByLabel('Document type')).toHaveValue('fixture');
        await expect(main.locator('.employee-select__loading-indicator')).toHaveCount(0);
      }
      if (title === 'Bucket groups')
        await expect(main.getByText('job / attachment', { exact: true })).toBeVisible();
      const fileName = title.toLowerCase().replaceAll(' ', '-');
      const inWorkspace = await main.screenshot({
        ...shotOptions,
        path: testInfo.outputPath(fileName + '-spa-content.png'),
      });
      const [direct] = await Promise.all([
        desktop.context().waitForEvent('page'),
        link.click({ button: 'middle' }),
      ]);
      try {
        await expect(direct).toHaveURL(new URL(path, desktop.url()).href);
        const directMain = direct.getByRole('main');
        await expect(directMain.getByRole('heading', { name: title, exact: true })).toBeVisible();
        if (title === 'Files') {
          await expect(directMain.getByLabel('Document type')).toHaveValue('fixture');
          await expect(directMain.locator('.employee-select__loading-indicator')).toHaveCount(0);
        }
        if (title === 'Bucket groups') {
          await expect(directMain.getByText('job / attachment', { exact: true })).toBeVisible();
        }
        await expect
          .poll(async () =>
            (
              await directMain.screenshot({
                ...shotOptions,
                path: testInfo.outputPath(fileName + '-direct-content.png'),
              })
            ).equals(inWorkspace),
          )
          .toBe(true);
        await direct.screenshot({
          ...shotOptions,
          path: testInfo.outputPath(fileName + '.png'),
        });
        await direct.reload();
        await expect(directMain.getByRole('heading', { name: title, exact: true })).toBeVisible();
      } finally {
        await direct.close();
      }
    }
    await main.getByRole('link', { name: 'Open files' }).click();
    await expect(desktop).toHaveURL(/files[.]html$/);
    await expect(main.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
    await main.getByRole('combobox', { name: 'Saved record' }).fill('production');
    await main.getByRole('option', { name: 'Saved production job · #7' }).click();
    await expect(main.locator('input[type=file]')).toBeEnabled();
    await desktop.goBack();
    await expect(main.getByRole('heading', { name: 'Bucket groups', exact: true })).toBeVisible();
    await expectSameShell();
    desktop.off('request', trackDocuments);
    await phone.reload();
    await expect(disclosure(phone, 'production')).toHaveJSProperty('open', true);
    await expect(disclosure(phone, 'colours')).toHaveJSProperty('open', false);
    await phone.getByRole('button', { name: 'Show menu' }).click();
    const mobile = await sidebarSnapshot(phone);
    await phone.getByRole('link', { name: 'Worker bills', exact: true }).click();
    await expect(phone.getByRole('heading', { name: 'Worker bills', exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Show menu' })).toBeVisible();
    await phone.getByRole('button', { name: 'Show menu' }).click();
    await expect.poll(() => sidebarSnapshot(phone)).toEqual(mobile);
    await phone.getByRole('link', { name: 'Saved-record files' }).click();
    await expect(phone.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
    await expect(phone.getByRole('button', { name: 'Show menu' })).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await phone.screenshot({
      path: testInfo.outputPath('files-mobile.png'),
      animations: 'disabled',
    });
    const phoneShell = await phone.locator('.fabric-shell').elementHandle();
    const phoneDocuments = [];
    phone.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === phone.mainFrame())
        phoneDocuments.push(request.url());
    });
    for (const [linkName, heading, fileName] of [
      ['Roles & permissions', 'Roles', 'roles-mobile.png'],
      ['Bucket groups', 'Bucket groups', 'bucket-groups-mobile.png'],
    ]) {
      await phone.getByRole('button', { name: 'Show menu' }).click();
      await phone.getByRole('link', { name: linkName, exact: true }).click();
      await expect(phone.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(phone.getByRole('button', { name: 'Show menu' })).toBeVisible();
      expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await phone.screenshot({ path: testInfo.outputPath(fileName), animations: 'disabled' });
    }
    expect(phoneDocuments).toEqual([]);
    expect(
      await phoneShell.evaluate((node) => node === document.querySelector('.fabric-shell')),
    ).toBe(true);
    await phone.getByRole('button', { name: 'Show menu' }).click();
    await phone.keyboard.press('Escape');
    await expect(phone.getByRole('button', { name: 'Show menu' })).toBeFocused();
    await expect(phone.getByRole('complementary', { name: 'Workspace navigation' })).toBeHidden();
    securityReady = false;
    await phone.goto('/access.html#adminAccess');
    await expect(phone).toHaveURL(/access[.]html[?]returnTo=/);
    await expect(phone.getByRole('heading', { name: 'Set your password' })).toBeVisible();
    await expect(phone.getByRole('heading', { name: 'Employee account access' })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
