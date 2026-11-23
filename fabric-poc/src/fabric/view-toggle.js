import { createElement as h } from 'react';

export function WorkspaceViewToggle({ view, onChange, label, sheetLabel = 'Sheet' }) {
  return h(
    'div',
    { className: 'fabric-view-toggle', role: label ? 'group' : undefined, 'aria-label': label },
    ['overview', 'sheet'].map((mode) =>
      h(
        'button',
        {
          key: mode,
          type: 'button',
          'aria-pressed': view === mode,
          onClick: () => onChange(mode),
        },
        mode === 'overview' ? 'Overview' : sheetLabel,
      ),
    ),
  );
}
