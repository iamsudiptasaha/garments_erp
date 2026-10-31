import React from 'react';
import { InventoryCard } from '../inventory/cards.js';
const h = React.createElement;
export function ProductionOverview({
  groups,
  spec,
  page,
  onEdit,
  editable,
  stageDefinitions = [],
}) {
  if (page !== 'productionJobs')
    return h(
      'section',
      { className: 'overview-grid' },
      groups.map((group, index) =>
        h(InventoryCard, { key: group.id, group, spec, page, index, onEdit, editable }),
      ),
    );
  const stages = (
    stageDefinitions.length
      ? stageDefinitions.map((s) => ({ name: s.name, order: s.sort_order }))
      : [
          ...new Map(
            groups.map((g) => [
              g.rows[0].stage,
              { name: g.rows[0].stage, order: g.rows[0].stageOrder },
            ]),
          ).values(),
        ]
  ).sort((a, b) => a.order - b.order);
  return h(
    'section',
    { className: 'production-board' },
    stages.map((stage, index) =>
      h(
        'section',
        { className: `production-lane tone-${index % 4}`, key: stage.name },
        h(
          'header',
          null,
          h('h2', null, stage.name),
          h('span', null, groups.filter((g) => g.rows[0].stage === stage.name).length),
        ),
        groups
          .filter((g) => g.rows[0].stage === stage.name)
          .map((g) => {
            const row = g.rows[0];
            return h(
              'article',
              { className: 'production-job-card', key: g.id },
              h('span', { className: 'production-status' }, row.status),
              h('h3', null, row.name),
              h('p', null, row.part),
              h('small', null, row.code),
              h(
                'div',
                { className: 'production-job-measures' },
                h('span', null, h('strong', null, row.issued), ' pieces sent'),
                h('span', null, h('strong', null, row.received), ' completed / received'),
              ),
              h('p', null, row.worker),
              h('small', null, `Due ${row.due}`),
              editable && h('button', { onClick: () => onEdit(g.id) }, 'Update job →'),
            );
          }),
      ),
    ),
  );
}
