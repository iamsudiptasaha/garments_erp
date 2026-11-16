import { createElement as h, useEffect, useMemo, useState } from 'react';

import { useGridSearch } from '../fabric/grid-toolbar.js';
import { WorkspaceViewToggle } from '../fabric/view-toggle.js';
import { FinishedCatalogue } from './catalogue.js';
import { ItemCostingPreview } from './costing-preview.js';
import { CostingHistory } from './item-costing.js';
import { FinishedGoodsEditor, FinishedGoodsSheetView } from './sheet-view.js';
import { FinishedGoodsOverview } from './overview.js';
import { finishedGoodsPages } from './pages.js';
import { StockForm } from './stock-form.js';
import './styles.css';

const pageSize = 50;
const emptyRows = [];
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

const descriptions = {
  sizes: 'Compare completed production, verified stock and movements by item size.',
  variations:
    'Available sets are limited by the component size that can make the fewest whole sets.',
  valuation: 'Total pieces in house × item base price.',
  receipt: 'Record actual size quantities once every item part is complete.',
  adjustment: 'Record a verified quantity correction against an existing item size.',
  products: 'Set up sellable products and their size-wise composition.',
  prices: 'Set up price versions for sellable products.',
  priceTypes: 'Maintain the shared price type reference list.',
};

export function FinishedGoods({ client, canCreate, capabilities, link, screen = 'sizes' }) {
  const [display, setDisplay] = useState(
    ['sizes', 'variations', 'valuation'].includes(screen) ? 'sheet' : 'overview',
  );
  const [command, setCommand] = useState(
    ['receipt', 'adjustment', 'costing'].includes(screen) ? screen : '',
  );
  const [costingItemIds, setCostingItemIds] = useState(null);
  const [notice, setNotice] = useState('');
  const view = Object.hasOwn(views, screen) ? screen : 'sizes';
  const movement = screen === 'receipt' || screen === 'adjustment';
  const [searchText, setSearchText] = useState('');
  const sku = useGridSearch(searchText.trim());
  const exactSearch = screen === 'sizes' || screen === 'variations';
  const [pagination, setPagination] = useState({ offset: 0, sku: '', revision: 0 });
  const [overviewSku, setOverviewSku] = useState('');
  const serverSku = exactSearch ? (display === 'sheet' ? sku : overviewSku) : '';
  const offset = pagination.sku === serverSku ? pagination.offset : 0;
  const revision = pagination.revision;
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(Boolean(client));

  useEffect(() => {
    if (!client || !Object.hasOwn(views, screen)) return;
    let current = true;
    async function load() {
      try {
        setError('');
        setLoading(true);
        const pagination = { p_limit: pageSize, p_offset: offset };
        const { data, error } = movement
          ? await client.rpc('erp_finished_goods_movements', {
              ...pagination,
              p_adjustment: screen === 'adjustment',
            })
          : screen === 'valuation'
            ? await client.rpc('erp_finished_stock_valuation', pagination)
            : await client.rpc('erp_finished_goods_summary', {
                ...pagination,
                p_sku: serverSku || null,
              });
        if (error) throw error;
        if (current) setResult(movement || screen === 'valuation' ? { [screen]: data } : data);
      } catch (error) {
        if (current) setError(error.message || 'Unable to load finished stock.');
      } finally {
        if (current) setLoading(false);
      }
    }
    load();
    return () => {
      current = false;
    };
  }, [client, movement, offset, revision, screen, serverSku]);

  function loadPage(nextOffset) {
    setPagination({ offset: nextOffset, sku: serverSku, revision: revision + 1 });
  }

  const rawRows = result?.[view] ?? emptyRows;
  const { title, columns } = views[view];
  const rows = useMemo(
    () =>
      exactSearch || !sku
        ? rawRows
        : rawRows.filter((row) =>
            columns.some(([key]) =>
              String(row[key] ?? '')
                .toLowerCase()
                .includes(sku.toLowerCase()),
            ),
          ),
    [exactSearch, sku, rawRows, columns],
  );
  const add =
    canCreate &&
    ['receipt', 'adjustment'].includes(command) &&
    h(
      FinishedGoodsEditor,
      {
        label: command === 'adjustment' ? '+ Add adjustment' : '+ Record stock-in',
        title: command === 'adjustment' ? 'New adjustment' : 'New stock-in',
      },
      (close) =>
        h(StockForm, {
          key: notice,
          client,
          adjustment: command === 'adjustment',
          onSaved: (id) => {
            close();
            setNotice(
              command === 'adjustment' ? `Correction ${id} verified.` : `Stock-in ${id} verified.`,
            );
            setSearchText('');
            loadPage(0);
          },
        }),
    );
  const search = {
    label: exactSearch ? 'Exact SKU' : 'Search this page',
    value: searchText,
    onChange: setSearchText,
  };
  const source = movement
    ? {
        label: screen === 'receipt' ? 'Open selected stock-in' : 'Open selected adjustment',
        title,
        resolve: (row) =>
          row.id &&
          h(
            'dl',
            { className: 'fg-card-fields' },
            columns.map(([key, label]) =>
              h('div', { key }, h('dt', null, label), h('dd', null, row[key] ?? '—')),
            ),
          ),
      }
    : {
        label: 'View selected costing history',
        title: 'Item costing history',
        resolve(row) {
          const ids =
            screen === 'variations' ? row.components?.map(({ item_id }) => item_id) : [row.item_id];
          const itemIds = [...new Set((ids ?? []).filter(Boolean).map(String))];
          return itemIds.length > 0 && h(CostingHistory, { client, itemIds, canEdit: false });
        },
      };
  const pageTitle = finishedGoodsPages[screen];
  return h(
    'section',
    { className: 'finished-goods' },
    h(
      'header',
      { className: 'fabric-page-header' },
      h(
        'div',
        null,
        h('p', { className: 'eyebrow' }, 'FINISHED GOODS / ' + pageTitle.toUpperCase()),
        h('h1', null, pageTitle),
        descriptions[screen] && h('p', null, descriptions[screen]),
      ),
      client &&
        screen !== 'costing' &&
        h(WorkspaceViewToggle, {
          view: display,
          onChange: setDisplay,
          label: pageTitle + ' view',
        }),
    ),
    client &&
      ['products', 'prices', 'priceTypes'].includes(screen) &&
      h(FinishedCatalogue, { client, screen, canCreate, capabilities, view: display, link }),
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
    display === 'overview' && add,
    Object.hasOwn(views, screen) &&
      (movement || !command) &&
      h(
        'div',
        null,
        loading && result && h('p', { role: 'status' }, 'Updating finished stock…'),
        !client
          ? h('p', { role: 'status' }, 'Local preview. Connect to the ERP to load finished stock.')
          : error
            ? h(
                'div',
                null,
                h('p', { role: 'alert' }, error),
                h('button', { onClick: () => loadPage(offset) }, 'Retry'),
              )
            : !result
              ? h('p', { role: 'status' }, 'Loading finished stock…')
              : h(FinishedGoodsSheetView, {
                  page: screen,
                  title,
                  columns,
                  rows,
                  capabilities,
                  view: display,
                  client,
                  paged: true,
                  search,
                  add,
                  source,
                  searchPending: loading || searchText.trim() !== sku,
                }),
        client &&
          display === 'overview' &&
          h(FinishedGoodsOverview, {
            client,
            screen,
            title: pageTitle,
            columns,
            rows: error ? emptyRows : rawRows,
            link,
            searchLabel: search.label,
            onSearch: exactSearch ? setOverviewSku : undefined,
            onCosting:
              view === 'variations'
                ? (row) => {
                    setCostingItemIds([
                      ...new Set(row.components.map(({ item_id }) => String(item_id))),
                    ]);
                    setCommand('costing');
                  }
                : undefined,
          }),
        h(
          'button',
          {
            disabled: loading || offset === 0,
            onClick: () => loadPage(offset - pageSize),
          },
          'Previous',
        ),
        h(
          'button',
          {
            disabled: loading || rawRows.length < pageSize,
            onClick: () => loadPage(offset + pageSize),
          },
          'Next',
        ),
      ),
  );
}
