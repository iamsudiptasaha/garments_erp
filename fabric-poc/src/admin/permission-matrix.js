import React, { useState } from 'react';
import { pages } from '../fabric/catalog.js';

const h = React.createElement;
export const permissionFlags = ['view', 'create', 'edit', 'delete', 'format', 'export', 'print'];
const sections = {
  fabric: 'Fabric',
  colours: 'Colours',
  production: 'Production',
  inventory: 'Raw Material Inventory',
  miscellaneous: 'Miscellaneous',
  billing: 'Billing',
  finishedGoods: 'Finished Goods',
  hr: 'Employee / HR',
  other: 'Other screens',
};
const standalone = {
  productionChallans: 'production',
  jobWorkerBills: 'production',
  finishedProducts: 'finishedGoods',
  employees: 'hr',
};

export function updateScreenPermissions(permissions, screens, action, checked) {
  const next = { ...permissions };
  for (const { key } of screens) {
    next[key] =
      action === 'view' && !checked
        ? {}
        : { ...next[key], ...(checked && { view: true }), [action]: checked };
  }
  return next;
}

export function PermissionMatrix({ resources, permissions, onChange }) {
  const [expanded, setExpanded] = useState({});
  const screens = resources.filter((r) => r.resource_type === 'screen' && !r.admin_only);
  const groups = Object.entries(sections)
    .map(([id, label]) => ({
      id,
      label,
      children: screens.filter(
        ({ key }) =>
          (standalone[key] ?? pages[key]?.section ?? (pages[key] ? 'fabric' : 'other')) === id,
      ),
    }))
    .filter(({ children }) => children.length);
  function master(label, children, action) {
    const selected = children.filter(({ key }) => permissions[key]?.[action]).length;
    const checked = children.length > 0 && selected === children.length;
    return h('input', {
      type: 'checkbox',
      'aria-label': `${label}: ${action}`,
      ref: (input) => {
        if (input) input.indeterminate = selected > 0 && !checked;
      },
      disabled: action === 'delete' || !children.length,
      checked,
      onChange: (e) => onChange(children, action, e.target.checked),
    });
  }
  return h(
    React.Fragment,
    null,
    h(
      'div',
      { className: 'fabric-actions' },
      h(
        'button',
        {
          type: 'button',
          onClick: () => setExpanded(Object.fromEntries(groups.map(({ id }) => [id, true]))),
        },
        'Expand all',
      ),
      h('button', { type: 'button', onClick: () => setExpanded({}) }, 'Collapse all'),
    ),
    h(
      'div',
      {
        className: 'permission-scroll',
        role: 'region',
        'aria-label': 'Screen permissions',
        tabIndex: 0,
      },
      h(
        'table',
        { className: 'permission-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { scope: 'col' }, 'Screen'),
            permissionFlags.map((action) =>
              h(
                'th',
                { key: action, scope: 'col' },
                h('span', null, action),
                master('All sections', screens, action),
              ),
            ),
          ),
        ),
        groups.map(({ id, label, children }) =>
          h(
            'tbody',
            { key: id },
            h(
              'tr',
              { className: 'permission-section' },
              h(
                'th',
                { scope: 'row' },
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-expanded': !!expanded[id],
                    onClick: () => setExpanded((current) => ({ ...current, [id]: !current[id] })),
                  },
                  label,
                ),
              ),
              permissionFlags.map((action) =>
                h('td', { key: action }, master(label, children, action)),
              ),
            ),
            expanded[id] &&
              children.map(({ id: resourceId, key, name }) =>
                h(
                  'tr',
                  { key: resourceId },
                  h('th', { scope: 'row' }, name),
                  permissionFlags.map((action) =>
                    h(
                      'td',
                      { key: action },
                      h('input', {
                        type: 'checkbox',
                        'aria-label': `${name}: ${action}`,
                        disabled:
                          action === 'delete' || (action !== 'view' && !permissions[key]?.view),
                        checked: !!permissions[key]?.[action],
                        onChange: (e) => onChange([{ key }], action, e.target.checked),
                      }),
                    ),
                  ),
                ),
              ),
          ),
        ),
      ),
    ),
  );
}
