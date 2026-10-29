import React from 'react';
import { overviewMetrics } from './model.js';
import './styles.css';
const h = React.createElement,
  fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
function Chart({ title, note, rows, unit, onNavigate }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return h(
    'section',
    { className: 'analytics-chart' },
    h('h2', null, title),
    h('p', null, note),
    rows.length
      ? h(
          'div',
          { className: 'analytics-bars' },
          rows.map((r, i) =>
            h(
              'button',
              {
                key: r.label,
                className: 'analytics-bar',
                onClick: () => onNavigate(r.key),
                'aria-label': `${r.label}: ${fmt(r.value)} ${unit}. Open records.`,
              },
              h(
                'span',
                { className: 'analytics-bar-caption' },
                h('span', null, r.label),
                h('strong', null, fmt(r.value), h('small', null, ' ' + unit)),
              ),
              h(
                'span',
                { className: 'analytics-track', 'aria-hidden': true },
                h('span', {
                  className: `analytics-fill analytics-fill-${i % 4}`,
                  style: { width: `${(r.value / max) * 100}%` },
                }),
              ),
            ),
          ),
        )
      : h('div', { className: 'analytics-empty' }, 'No records available'),
  );
}
export function OverviewPanel({ data, canView, onNavigate, live }) {
  const metrics = overviewMetrics(data, canView),
    count = metrics.documents.reduce((n, r) => n + r.value, 0);
  return h(
    'section',
    { className: 'analytics-overview' },
    h(
      'header',
      { className: 'analytics-heading' },
      h(
        'div',
        null,
        h('p', { className: 'eyebrow' }, 'YOUR WORKSPACE'),
        h('h1', null, 'Overview'),
        h('p', null, 'A quick look at what’s moving. Choose a chart to open the records.'),
      ),
      h('span', { className: 'analytics-source' }, live ? 'Live database' : 'Preview data'),
    ),
    h(
      'div',
      { className: 'analytics-highlights' },
      h(
        'article',
        null,
        h('span', null, 'Documents'),
        h('strong', null, fmt(count)),
        h('small', null, 'Across the sections you can access'),
      ),
      canView('labDips') &&
        h(
          'article',
          null,
          h('span', null, 'Lab-dip editions'),
          h('strong', null, fmt(metrics.statuses.reduce((n, r) => n + r.value, 0))),
          h('small', null, 'Latest status for each edition'),
        ),
    ),
    h(
      'div',
      { className: 'analytics-grid' },
      h(Chart, {
        title: 'Fabric at a glance',
        note: 'Recorded weights across all dates. These are independent totals, not a weight reconciliation.',
        rows: metrics.weights,
        unit: 'kg',
        onNavigate,
      }),
      h(Chart, {
        title: 'Documents by section',
        note: 'All-time document counts. Each bill or program counts once.',
        rows: metrics.documents,
        unit: 'documents',
        onNavigate,
      }),
      canView('labDips') &&
        h(Chart, {
          title: 'Lab-dip progress',
          note: 'Latest recorded status for each edition.',
          rows: metrics.statuses,
          unit: 'editions',
          onNavigate,
        }),
    ),
    metrics.documents.length === 0 &&
      !canView('labDips') &&
      h(
        'p',
        { className: 'analytics-empty' },
        'Your account is active. An administrator can assign sections for you to access.',
      ),
  );
}
