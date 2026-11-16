import React, { useEffect, useRef, useState } from 'react';
import { AccountFooter } from './account-footer.js';
import { getAccessClient } from './client.js';
import { useNavigationPreferences } from './navigation-preferences.js';
import { adminPages, allowed, isAdministrator } from '../admin/model.js';
import { otherModules, pages } from '../fabric/catalog.js';
import { finishedGoodsPages } from '../finished-goods/pages.js';
import { hrPages } from '../hr/model.js';
import { sessionAccessModel } from './workspace-gate.js';
import { adminPath, followWorkspaceLink, workspacePath } from './workspace-routes.js';

const h = React.createElement;
const workspaceUrl = '/fabric.html?live=1';
export const productionDocumentPath = '/production-challan.html';
export const productionDocumentRoutes = {
  productionChallans: ['Challans', 'challans'],
  jobWorkerBills: ['Worker bills', 'worker-bills'],
};

const adminDestinations = {
  adminAccess: 'User Access',
  adminRoles: 'Roles & Permissions',
  adminAudit: adminPages.adminAudit,
};
const productionPriority = ['productionTaskBoard', 'productionUpdateTaskStatus'];
const productionRank = (key) =>
  productionPriority.includes(key) ? productionPriority.indexOf(key) : productionPriority.length;

const sidebarIcon = (expanded) =>
  h(
    'svg',
    {
      width: 20,
      height: 20,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
    },
    h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
    h('path', { d: 'M8 4v16' }),
    h('path', { d: expanded ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3' }),
  );
function loadSidebar() {
  try {
    const saved = localStorage.getItem('garments-sidebar-open');
    if (saved !== null) return saved === 'true';
  } catch {
    /* Navigation works without storage. */
  }
  return !window.matchMedia('(max-width:700px)').matches;
}

export function useWorkspaceMenu() {
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebar);
  useEffect(() => {
    try {
      localStorage.setItem('garments-sidebar-open', String(sidebarOpen));
    } catch {
      /* Personal menu preference is optional. */
    }
  }, [sidebarOpen]);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        sidebarOpen &&
        window.matchMedia('(max-width:700px)').matches &&
        !document.querySelector('dialog[open]')
      ) {
        setSidebarOpen(false);
        requestAnimationFrame(() => document.getElementById('navigation-toggle')?.focus());
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);
  return [sidebarOpen, setSidebarOpen];
}

export function WorkspaceMenuToolbar({ open, onToggle }) {
  return h(
    'div',
    { className: 'workspace-toolbar' },
    h(
      'button',
      {
        id: 'navigation-toggle',
        type: 'button',
        className: 'navigation-toggle',
        'aria-controls': 'workspace-sidebar',
        'aria-expanded': open,
        onClick: onToggle,
      },
      sidebarIcon(open),
      open ? 'Hide menu' : 'Show menu',
    ),
    h(
      'div',
      { className: 'workspace-toolbar-context' },
      h('span', null, 'Garment workspace'),
      h('small', null, 'Fabric pilot'),
    ),
  );
}

export function WorkspaceSidebar({
  live,
  access = sessionAccessModel(live),
  actor = live?.actor,
  page,
  finishedGoodsPage,
  open,
  onClose,
  onPage = (key) => location.assign(workspaceUrl + (key === 'home' ? '' : '#' + key)),
  onFinishedGoods = (key) =>
    location.assign(workspaceUrl + '&finishedGoods=' + key + '#finishedProducts'),
  onProductionDocument,
  onAdmin = (key) => location.assign(adminPath + '#' + key),
  onWorkspaceLink,
  onSignOut,
}) {
  const sidebar = useRef(null);
  const notice = useNavigationPreferences(live ? getAccessClient() : null, sidebar);
  const can = (key) =>
    allowed(access, actor, productionPriority.includes(key) ? 'productionJobs' : key, 'view');
  const current = (key) => (page === key ? 'page' : undefined);
  const button = (key, title, action = onPage, active = current(key)) =>
    h('button', { key, type: 'button', 'aria-current': active, onClick: () => action(key) }, title);
  const link = (key, title, href, navigate = onWorkspaceLink) =>
    h(
      'a',
      {
        key,
        href,
        'aria-current': current(key),
        onClick: (event) => followWorkspaceLink(event, navigate && (() => navigate(key))),
      },
      title,
    );
  const section = (key, title, label, entries, className) =>
    entries.length > 0 &&
    h(
      'details',
      { key, open: true, className, 'data-nav-section': key },
      h('summary', null, title),
      h('nav', { 'aria-label': label }, entries),
    );
  const entries = (group) =>
    Object.entries(pages).filter(([, p]) => (p.section || 'fabric') === group);
  const pageButtons = (group) =>
    entries(group)
      .filter(([key, p]) => can(key) && !p.hiddenNavigation)
      .sort(([a], [b]) => (group === 'production' ? productionRank(a) - productionRank(b) : 0))
      .map(([key, p]) => button(key, p.title));
  const productionLinks = live
    ? Object.entries(productionDocumentRoutes)
        .filter(([key]) => can(key))
        .map(([key, [title, hash]]) =>
          link(key, title, productionDocumentPath + '#' + hash, onProductionDocument ?? null),
        )
    : [];
  const adminLinks = Object.entries(live ? adminDestinations : adminPages)
    .filter(([key]) => key === 'adminAccess' || can(key))
    .map(([key, title]) =>
      live && onWorkspaceLink
        ? link(key, title, workspacePath(key))
        : button(key, title, live ? onAdmin : onPage),
    );

  return h(
    'aside',
    {
      ref: sidebar,
      id: 'workspace-sidebar',
      className: 'fabric-sidebar',
      hidden: !open,
      'aria-label': 'Workspace navigation',
    },
    h(
      'div',
      { className: 'sidebar-top' },
      h(
        'button',
        { type: 'button', className: 'fabric-brand', onClick: () => onPage('home') },
        h('span', null, 'G'),
        h('div', null, 'Garment workspace', h('small', null, 'Fabric pilot')),
      ),
    ),
    h(
      'div',
      { className: 'sidebar-navigation-scroll' },
      h(
        'nav',
        { className: 'overview-navigation', 'aria-label': 'Workspace overview' },
        button('home', 'Overview'),
      ),
      section('fabric', 'Fabric', 'Fabric sections', [
        button('fabricOverview', 'Fabric overview'),
        ...pageButtons('fabric'),
      ]),
      section('colours', 'Colours', 'Colour sections', pageButtons('colours'), 'colour-nav'),
      section(
        'production',
        'Production',
        'Production pages',
        [...pageButtons('production'), ...productionLinks],
        'production-nav',
      ),
      section(
        'inventory',
        'Raw Material Inventory',
        'Raw Material Inventory pages',
        pageButtons('inventory'),
        'inventory-nav',
      ),
      can('finishedProducts') &&
        section(
          'finished-goods',
          'Finished Goods',
          'Finished Goods pages',
          Object.entries(finishedGoodsPages).map(([key, title]) =>
            button(
              key,
              title,
              onFinishedGoods,
              page === 'finishedProducts' && finishedGoodsPage === key ? 'page' : undefined,
            ),
          ),
        ),
      live && section('billing', 'Billing', 'Billing pages', pageButtons('billing')),
      otherModules
        .filter((name) => name !== 'Billing' || !live)
        .map((name) =>
          h(
            'details',
            { key: name, 'data-nav-section': 'preview-' + name },
            h('summary', null, name),
            h('p', { className: 'phase-note' }, 'Next phase · after Fabric'),
          ),
        ),
      section(
        'miscellaneous',
        'Miscellaneous',
        'Miscellaneous pages',
        pageButtons('miscellaneous'),
        'miscellaneous-nav',
      ),
      can('employees') &&
        section(
          'hr',
          'Employee / HR',
          'Employee / HR pages',
          Object.entries(hrPages).map(([key, entry]) => button(key, entry.title)),
          'hr-nav',
        ),
      isAdministrator(access, actor) &&
        section(
          'administration',
          'Administration',
          'Administration pages',
          [...adminLinks, link('files-admin', 'Bucket groups', workspacePath('files-admin'))],
          'admin-nav',
        ),
      section('files', 'File Uploads', 'File Uploads pages', [
        link('files', 'Saved-record files', workspacePath('files')),
      ]),
    ),
    notice && h('p', { role: 'status' }, notice),
    h(AccountFooter, {
      destination: finishedGoodsPage || page,
      name:
        live?.profileName || access.users.find((user) => user.id === actor)?.name || 'My account',
      photoId: live?.profilePhoto,
      role: live ? (live.administrator ? 'Administrator' : 'Signed-in employee') : 'Local preview',
      live: !!live,
      onCollapse: onClose,
      onSignOut,
    }),
  );
}
