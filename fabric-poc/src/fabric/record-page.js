import { createElement as h } from 'react';
import { GridSearch } from './grid-toolbar.js';
import { WorkspaceViewToggle } from './view-toggle.js';

export const liveRecordNotice = 'Live Supabase records · saved changes are shared';

export function WorkspaceConnectionBanner({ ready }) {
  return h(
    'div',
    { className: 'access-info' },
    ready
      ? 'Signed in · Fabric, Colours and Production connected to Supabase'
      : 'Signed in · loading database records',
  );
}

export function RecordPageHeading({
  eyebrow,
  title,
  description,
  view,
  onView,
  viewLabel,
  sheetLabel,
  action,
}) {
  return h(
    'header',
    { className: 'fabric-page-header' + (action === undefined ? '' : ' erp-overview-heading') },
    h(
      'div',
      null,
      h('p', { className: 'eyebrow' }, eyebrow),
      h('h1', null, title),
      description && h('p', null, description),
    ),
    onView &&
      (action !== undefined
        ? h(
            'div',
            { className: 'erp-overview-heading-actions' },
            h(WorkspaceViewToggle, { view, onChange: onView, label: viewLabel, sheetLabel }),
            action,
          )
        : h(WorkspaceViewToggle, { view, onChange: onView, label: viewLabel, sheetLabel })),
  );
}

export function RecordPageActions({ view, label, placeholder, value, onSearch, children }) {
  return h(
    'div',
    { className: view === 'sheet' ? 'fabric-actions worksheet-actions' : 'fabric-actions' },
    h(GridSearch, { label, placeholder, value, onChange: onSearch, sheet: view === 'sheet' }),
    children,
  );
}

export function RecordPageStatus({ notice, onRefresh }) {
  return h(
    'div',
    { className: 'fabric-status', role: 'status', 'aria-live': 'polite' },
    notice,
    onRefresh && h('button', { onClick: onRefresh }, 'Refresh records'),
  );
}

export function RecordPageEmpty({ query, prompt }) {
  return h(
    'div',
    { className: 'empty-state' },
    h('h2', null, 'Nothing here yet'),
    h('p', null, query ? 'Try a different search.' : prompt),
  );
}
