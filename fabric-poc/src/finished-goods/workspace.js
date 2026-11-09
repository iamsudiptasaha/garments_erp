import { createElement as h, useEffect, useState } from 'react';

import { CostingHistory } from './item-costing.js';
import { StockForm } from './stock-form.js';

const pageSize = 50;
const views = {
  sizes: {
    title: 'Manufactured stock',
    columns: [
      ['item_id', 'Manufactured item ID'],
      ['size_id', 'Item-size ID'],
      ['produced', 'Verified pieces'],
      ['adjusted', 'Adjustments'],
      ['available', 'Available pieces'],
    ],
  },
  variations: {
    title: 'Sellable product capacity',
    columns: [
      ['sku', 'SKU'],
      ['name', 'Sellable product'],
      ['capacity', 'Available sets'],
    ],
  },
};

export function FinishedGoods({ client, canCreate }) {
  const [command, setCommand] = useState('');
  const [costingItemIds, setCostingItemIds] = useState(null);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState('sizes');
  const [query, setQuery] = useState({ offset: 0, sku: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!client) return;
    let current = true;
    async function load() {
      try {
        const { data, error } = await client.rpc('erp_warehouse_stock', {
          p_sku: query.sku || null,
          p_limit: pageSize,
          p_offset: query.offset,
        });
        if (error) throw error;
        if (current) setResult(data);
      } catch (error) {
        if (current) setError(error.message || 'Unable to load finished stock.');
      }
    }
    load();
    return () => {
      current = false;
    };
  }, [client, query]);

  function search(next) {
    setResult(null);
    setError('');
    setQuery(next);
  }

  const rows = result?.[view] ?? [];
  const { title, columns } = views[view];
  return h(
    'section',
    null,
    h('header', { className: 'fabric-page-header' }, h('h1', null, 'Finished Goods')),
    client &&
      !command &&
      h(
        'button',
        {
          onClick: () => {
            setCostingItemIds(null);
            setCommand('costing');
          },
        },
        'Item costing',
      ),
    command === 'costing' &&
      h(
        'div',
        null,
        h('button', { onClick: () => setCommand('') }, 'Back to finished stock'),
        h(CostingHistory, {
          client,
          canEdit: canCreate && !costingItemIds,
          itemIds: costingItemIds,
        }),
      ),
    canCreate &&
      !command &&
      h(
        'div',
        null,
        h('button', { onClick: () => setCommand('receipt') }, 'Record stock-in'),
        h('button', { onClick: () => setCommand('adjustment') }, 'Correct stock'),
      ),
    canCreate &&
      ['receipt', 'adjustment'].includes(command) &&
      h(StockForm, {
        client,
        adjustment: command === 'adjustment',
        onSaved: (id) => {
          setNotice(
            command === 'adjustment' ? `Correction ${id} verified.` : `Stock-in ${id} verified.`,
          );
          setCommand('');
          search({ ...query, offset: 0 });
        },
      }),
    notice && h('p', { role: 'status' }, notice),
    h(
      'label',
      null,
      'Stock view ',
      h(
        'select',
        {
          value: view,
          onChange: (event) => {
            setView(event.target.value);
            if (query.offset) search({ ...query, offset: 0 });
          },
        },
        Object.entries(views).map(([key, { title }]) => h('option', { key, value: key }, title)),
      ),
    ),
    h(
      'form',
      {
        onSubmit: (event) => {
          event.preventDefault();
          search({ sku: new FormData(event.currentTarget).get('sku').trim(), offset: 0 });
        },
      },
      h('label', null, 'Exact SKU ', h('input', { name: 'sku', defaultValue: query.sku })),
      h('button', { type: 'submit' }, 'Search'),
    ),
    h('h2', null, title),
    !client
      ? h('p', { role: 'status' }, 'Local preview. Connect to the ERP to load finished stock.')
      : error
        ? h(
            'div',
            null,
            h('p', { role: 'alert' }, error),
            h('button', { onClick: () => search({ ...query }) }, 'Retry'),
          )
        : !result
          ? h('p', { role: 'status' }, 'Loading finished stock…')
          : rows.length
            ? h(
                'table',
                null,
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    columns.map(([key, label]) => h('th', { key, scope: 'col' }, label)),
                    view === 'variations' && h('th', { scope: 'col' }, 'Costing'),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  rows.map((row) =>
                    h(
                      'tr',
                      { key: row.id ?? row.size_id },
                      columns.map(([key]) => h('td', { key }, row[key])),
                      view === 'variations' &&
                        h(
                          'td',
                          null,
                          h(
                            'button',
                            {
                              disabled: !row.components?.length,
                              onClick: () => {
                                setCostingItemIds([
                                  ...new Set(row.components.map(({ item_id }) => String(item_id))),
                                ]);
                                setCommand('costing');
                              },
                            },
                            'Costing history',
                          ),
                        ),
                    ),
                  ),
                ),
              )
            : h('p', null, 'No finished stock records on this page.'),
    h(
      'button',
      {
        disabled: query.offset === 0,
        onClick: () => search({ ...query, offset: query.offset - pageSize }),
      },
      'Previous',
    ),
    h(
      'button',
      {
        disabled: rows.length < pageSize,
        onClick: () => search({ ...query, offset: query.offset + pageSize }),
      },
      'Next',
    ),
  );
}
