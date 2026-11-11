import { createElement as h, useEffect, useState } from 'react';

import { FinishedCatalogue } from './catalogue.js';
import { ItemCostingPreview } from './costing-preview.js';
import { CostingHistory } from './item-costing.js';
import { FinishedGoodsSheetView } from './sheet-view.js';
import { StockForm } from './stock-form.js';
import './styles.css';

const pageSize = 50;
const views = {
  receipt: {
    title: 'Stock-in receipts',
    columns: [
      ['id', 'Receipt'],
      ['item', 'Item'],
      ['pieces', 'Actual pieces'],
      ['employee', 'Verified by'],
      ['verified_at', 'Verified at'],
    ],
  },
  adjustment: {
    title: 'Verified adjustments',
    columns: [
      ['item', 'Item · size'],
      ['delta', 'Change'],
      ['reason', 'Reason'],
      ['employee', 'Verified by'],
    ],
  },
  valuation: {
    title: 'Stock valuation',
    columns: [
      ['style_code', 'Style code'],
      ['size', 'Size'],
      ['pieces', 'Total pieces in house'],
      ['base_price', 'Base price per piece'],
      ['stock_value', 'Stock value'],
    ],
  },
  sizes: {
    title: 'Manufactured stock',
    columns: [
      ['style_code', 'Style code'],
      ['size', 'Size'],
      ['total_produced', 'Total produced'],
      ['produced', 'Verified pieces'],
      ['adjusted', 'Pieces adjusted'],
      ['returned', 'Pieces returned'],
      ['held', 'Pieces on bill hold'],
      ['sold', 'Pieces sold'],
      ['available', 'Available pieces'],
    ],
  },
  variations: {
    title: 'Sellable product capacity',
    columns: [
      ['style_code', 'Style code'],
      ['size', 'Size'],
      ['item_type', 'Item type'],
      ['produced_sets', 'Total produced (sets)'],
      ['sold', 'Total sold'],
      ['returned_sets', 'Total returned (sets)'],
      ['held', 'Total billing hold'],
      ['ordered', 'Total ordered'],
      ['delivered', 'Total delivered'],
      ['capacity', 'Total left (sets)'],
      ['available_percent', 'Available %'],
    ],
  },
};

export const finishedGoodsPages = {
  sizes: 'Item stock summary',
  variations: 'Sellable summary',
  valuation: 'Stock valuation',
  receipt: 'Items produced',
  adjustment: 'Stock adjustments',
  products: 'Sellable products',
  prices: 'Item prices',
  priceTypes: 'Price types',
  costing: 'Item costing',
};

export function FinishedGoods({ client, canCreate, capabilities, screen = 'sizes' }) {
  const [command, setCommand] = useState(
    ['receipt', 'adjustment', 'costing'].includes(screen) ? screen : '',
  );
  const [costingItemIds, setCostingItemIds] = useState(null);
  const [notice, setNotice] = useState('');
  const view = Object.hasOwn(views, screen) ? screen : 'sizes';
  const movement = screen === 'receipt' || screen === 'adjustment';
  const [query, setQuery] = useState({ offset: 0, sku: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!client || !Object.hasOwn(views, screen)) return;
    let current = true;
    async function load() {
      try {
        const pagination = { p_limit: pageSize, p_offset: query.offset };
        const { data, error } = movement
          ? await client.rpc('erp_finished_goods_movements', {
              ...pagination,
              p_adjustment: screen === 'adjustment',
            })
          : screen === 'valuation'
            ? await client.rpc('erp_finished_stock_valuation', pagination)
            : await client.rpc('erp_finished_goods_summary', {
                ...pagination,
                p_sku: query.sku || null,
              });
        if (error) throw error;
        if (current) setResult(movement || screen === 'valuation' ? { [screen]: data } : data);
      } catch (error) {
        if (current) setError(error.message || 'Unable to load finished stock.');
      }
    }
    load();
    return () => {
      current = false;
    };
  }, [client, movement, query, screen]);

  function search(next) {
    setResult(null);
    setError('');
    setQuery(next);
  }

  const rows = result?.[view] ?? [];
  const { title, columns } = views[view];
  return h(
    'section',
    { className: 'finished-goods' },
    h('header', { className: 'fabric-page-header' }, h('h1', null, finishedGoodsPages[screen])),
    client &&
      ['products', 'prices', 'priceTypes'].includes(screen) &&
      h(FinishedCatalogue, { client, screen, canCreate, capabilities }),
    client &&
      command === 'costing' &&
      h(
        'div',
        null,
        costingItemIds &&
          h('button', { onClick: () => setCommand('') }, 'Back to sellable summary'),
        h(CostingHistory, {
          client,
          canEdit: canCreate && !costingItemIds,
          itemIds: costingItemIds,
        }),
      ),
    notice && h('p', { role: 'status' }, notice),
    !client && screen === 'costing' && h(ItemCostingPreview),
    Object.hasOwn(views, screen) &&
      (movement || !command) &&
      h(
        'div',
        null,
        !movement &&
          screen !== 'valuation' &&
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
              : h(
                  FinishedGoodsSheetView,
                  { page: screen, title, columns, rows, capabilities },
                  rows.length
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
                              { key: row.id ?? row.size_id ?? row.item_id },
                              columns.map(([key]) => h('td', { key }, row[key] ?? '—')),
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
                                          ...new Set(
                                            row.components.map(({ item_id }) => String(item_id)),
                                          ),
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
                ),
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
      ),
    canCreate &&
      ['receipt', 'adjustment'].includes(command) &&
      h(StockForm, {
        key: notice,
        client,
        adjustment: command === 'adjustment',
        onSaved: (id) => {
          setNotice(
            command === 'adjustment' ? `Correction ${id} verified.` : `Stock-in ${id} verified.`,
          );
          search({ offset: 0, sku: '' });
        },
      }),
  );
}
