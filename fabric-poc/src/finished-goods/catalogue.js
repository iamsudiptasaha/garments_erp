import { useGridSearch } from '../fabric/grid-toolbar.js';
import { createElement as h, useCallback, useEffect, useState } from 'react';

import { RecordSelect } from '../fabric/record-select.js';
import { FinishedGoodsEditor, FinishedGoodsSheetView } from './sheet-view.js';

import { FinishedGoodsOverview } from './overview.js';

const emptyComponent = { size_id: '', pieces: '1' };

const columns = {
  products: [
    ['sku', 'SKU'],
    ['name', 'Name'],
    ['status', 'Status'],
  ],
  prices: [
    ['product', 'Sellable product'],
    ['type', 'Price type'],
    ['version', 'Version'],
    ['price_per_piece', 'Price per piece'],
    ['date', 'Date'],
  ],
  priceTypes: [
    ['name', 'Name'],
    ['description', 'Description'],
  ],
};

function table(fields, rows) {
  return h(
    'table',
    null,
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        fields.map(([key, label]) => h('th', { key, scope: 'col' }, label)),
      ),
    ),
    h(
      'tbody',
      null,
      rows.map((row) =>
        h(
          'tr',
          { key: row.id },
          fields.map(([key]) => h('td', { key }, row[key] ?? '—')),
        ),
      ),
    ),
  );
}

function productContents(product, includeCosting = false) {
  const fields = [
    ['item', 'Manufactured item'],
    ['size', 'Size'],
    ['pieces', 'Pieces per set'],
  ];
  if (includeCosting) fields.push(['reference_cost', 'Finalized cost per piece']);
  return table(
    fields,
    product.components.map((row) => ({
      ...row,
      reference_cost: row.reference_cost ?? 'No finalized costing',
    })),
  );
}

function field(label, name, options = {}) {
  return h('label', null, label, h('input', { name, required: true, ...options }));
}

function CatalogueChoice({ label, name, entries, render, value, onChange }) {
  const [selected, setSelected] = useState('');
  const current = value ?? selected;
  return h(
    'div',
    null,
    h(RecordSelect, {
      label,
      value: current,
      onChange: onChange ?? setSelected,
      options: entries.map((entry) => ({ value: entry.id, label: render(entry) })),
    }),
    name && h('input', { type: 'hidden', name, value: current }),
  );
}

function choice(label, name, entries, render, props = {}) {
  return h(CatalogueChoice, { label, name, entries, render, ...props });
}

function ProductForm({ data, components, setComponents }) {
  function change(index, field, value) {
    setComponents(components.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  const recipe = components.flatMap((component, index) => {
    const size = data.sizes.find(({ id }) => id === component.size_id);
    return size ? [{ ...size, id: index, pieces: component.pieces }] : [];
  });

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'fg-fields' },
      field('SKU', 'sku'),
      field('Name', 'name'),
      field('Commercial style code', 'style_code', { required: false }),
      field('Date', 'date', { type: 'date', required: false }),
    ),
    h('h2', null, 'Sellable units'),
    components.map((row, index) =>
      h(
        'div',
        { key: index, className: 'fg-fields' },
        choice(
          'Manufactured item and size',
          undefined,
          data.sizes,
          ({ item, size }) => item + ' · ' + size,
          { value: row.size_id, onChange: (value) => change(index, 'size_id', value) },
        ),
        field('Pieces per set (share weight)', undefined, {
          type: 'number',
          min: 1,
          max: 2147483647,
          step: 1,
          value: row.pieces,
          onChange: (e) => change(index, 'pieces', e.target.value),
        }),
        h(
          'button',
          {
            type: 'button',
            disabled: components.length === 1,
            onClick: () => setComponents(components.filter((_, i) => i !== index)),
          },
          'Remove',
        ),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        disabled: components.length >= 100,
        onClick: () => setComponents([...components, emptyComponent]),
      },
      'Add component',
    ),
    h(
      'section',
      { className: 'fg-recipe', 'aria-label': 'One sellable set' },
      h(
        'header',
        null,
        h('strong', null, 'One sellable set'),
        h(
          'span',
          { 'aria-live': 'polite' },
          recipe.reduce((sum, row) => sum + Number(row.pieces), 0) + ' pieces',
        ),
      ),
      h(
        'div',
        { className: 'fg-recipe-sizes' },
        recipe.map(({ id, item, size, pieces }) =>
          h(
            'div',
            { className: 'fg-recipe-size', key: id },
            h('small', null, item + ' · ' + size),
            h('strong', null, pieces),
            h('small', null, Number(pieces) === 1 ? 'piece per set' : 'pieces per set'),
          ),
        ),
      ),
    ),
    choice('Verifying employee', 'employee_id', data.employees, ({ label }) => label),
    h('p', null, 'Composition is locked after verification.'),
  );
}

export function FinishedCatalogue({ client, screen, canCreate, capabilities, view, link }) {
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
  const [searchText, setSearchText] = useState('');
  const query = useGridSearch(searchText.trim().toLowerCase());
  const [openId, setOpenId] = useState(null);
  const closeContents = useCallback(() => setOpenId(null), []);
  const [productId, setProductId] = useState('');
  const [components, setComponents] = useState([emptyComponent]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    async function load() {
      try {
        const result = await client.rpc('erp_finished_goods_catalogue');
        if (result.error) throw result.error;
        if (active) setData(result.data);
      } catch (failure) {
        if (active) setError(failure.message);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [client, revision]);

  async function submit(event, close) {
    event.preventDefault();
    const form = event.currentTarget;
    const entry = Object.fromEntries(new FormData(form));
    if (screen === 'prices') entry.product_id = productId;
    if (screen === 'products')
      entry.components = components.map(({ size_id, pieces }) => ({
        size_id,
        pieces: Number(pieces),
      }));
    setError('');
    setNotice('');
    const missingSelection =
      (screen === 'prices' && (!entry.product_id || !entry.type_id)) ||
      (screen === 'products' && (!entry.employee_id || components.some(({ size_id }) => !size_id)));
    if (missingSelection) {
      setError('Complete the required selections.');
      return;
    }
    setSaving(true);
    try {
      const result = await client.rpc('erp_create_finished_catalogue_entry', {
        p_kind: screen,
        p_entry: entry,
      });
      if (result.error) throw result.error;
      form.reset();
      setComponents([emptyComponent]);
      setNotice('Saved.');
      close();
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  }

  if (!data)
    return h('p', { role: error ? 'alert' : 'status' }, error || 'Loading Finished Goods…');
  const product = data.products.find(({ id }) => id === productId);
  const overviewRows = {
    products: data.products.map((row) => ({
      ...row,
      status: (row.active ? 'Active' : 'Retired') + (row.verified ? ' · Verified' : ''),
    })),
    prices: data.prices,
    priceTypes: data.types,
  }[screen];
  const rows = overviewRows.filter(
    (row) =>
      !query ||
      columns[screen].some(([key]) =>
        String(row[key] ?? '')
          .toLowerCase()
          .includes(query),
      ),
  );
  const title = { products: 'Sellable products', prices: 'Item prices', priceTypes: 'Price types' }[
    screen
  ];

  const costingLookup =
    screen === 'prices' &&
    h(
      'section',
      { className: 'fg-recipe', 'aria-label': 'Item Costing lookup' },
      h('h2', null, 'Item Costing lookup'),
      choice(
        'Sellable product',
        undefined,
        data.products.filter(({ active, verified }) => !canCreate || (active && verified)),
        ({ sku, name }) => sku + ' · ' + name,
        { value: productId, onChange: setProductId },
      ),
      h(
        'p',
        null,
        product
          ? 'Finalized manufacturing costs are shown for reference. Enter the selling price manually.'
          : 'Select a sellable product to see its components and finalized manufacturing costs.',
      ),
      product && productContents(product, true),
    );

  const add =
    canCreate &&
    h(
      FinishedGoodsEditor,
      {
        label: {
          products: '+ Add sellable product',
          prices: '+ Add price version',
          priceTypes: '+ Add price type',
        }[screen],
        title: {
          products: 'New sellable product',
          prices: 'New price version',
          priceTypes: 'New price type',
        }[screen],
      },
      (close) =>
        h(
          'form',
          { key: revision, onSubmit: (event) => submit(event, close) },
          h(
            'fieldset',
            { disabled: saving },
            costingLookup,
            screen === 'products' && h(ProductForm, { data, components, setComponents }),
            screen === 'priceTypes' &&
              h(
                'div',
                { className: 'fg-fields' },
                field('Name', 'name'),
                field('Description', 'description', { required: false }),
              ),
            screen === 'prices' &&
              h(
                'div',
                null,
                h(
                  'div',
                  { className: 'fg-fields' },
                  choice('Price type', 'type_id', data.types, ({ name }) => name),
                  field('Version', 'version'),
                  field('Price per piece', 'price_per_piece', {
                    type: 'number',
                    min: 0,
                    step: 'any',
                  }),
                  field('Date', 'date', { type: 'date' }),
                ),
              ),
            h(
              'button',
              { type: 'submit', className: 'primary' },
              {
                products: 'Verify composition',
                prices: 'Add price version',
                priceTypes: 'Save price type',
              }[screen],
            ),
          ),
          error && h('p', { role: 'alert' }, error),
        ),
    );
  const search = {
    label: 'Search ' + title.toLowerCase(),
    value: searchText,
    onChange: setSearchText,
  };
  const source = {
    label: screen === 'priceTypes' ? 'Open selected price type' : 'View selected contents',
    title: screen === 'priceTypes' ? 'Price type' : 'Sellable product contents',
    resolve(row) {
      if (screen === 'priceTypes')
        return h('div', null, h('h3', null, row.name), h('p', null, row.description || '—'));
      const record =
        screen === 'products' ? row : data.products.find(({ sku }) => sku === row.product);
      return (
        record &&
        h(
          'div',
          null,
          h('p', null, record.sku + ' · ' + record.name),
          productContents(record, screen === 'prices'),
        )
      );
    },
  };

  const opened = openId === null ? null : overviewRows.find(({ id }) => id === openId);
  return h(
    'div',
    null,
    view === 'overview' &&
      opened &&
      h(
        FinishedGoodsEditor,
        {
          key: opened.id,
          record: true,
          title: source.title,
          onDismiss: closeContents,
        },
        () => source.resolve(opened),
      ),
    view === 'overview' && add,
    h(
      FinishedGoodsSheetView,
      {
        page: screen,
        title,
        columns: columns[screen],
        rows,
        capabilities,
        client,
        view,
        search,
        add,
        source,
        searchPending: searchText.trim().toLowerCase() !== query,
      },
      h(FinishedGoodsOverview, {
        client,
        screen,
        title,
        columns:
          screen === 'prices'
            ? [columns.prices[2], ...columns.prices.filter(([key]) => key !== 'version')]
            : columns[screen],
        rows: overviewRows,
        link,
        onOpen: screen === 'priceTypes' ? undefined : setOpenId,
        canOpen:
          screen === 'prices'
            ? (row) => data.products.some(({ sku }) => sku === row.product)
            : undefined,
      }),
    ),
    notice && h('p', { role: 'status' }, notice),
    !canCreate && costingLookup,
  );
}
