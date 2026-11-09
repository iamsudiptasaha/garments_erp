import { createElement as h, useEffect, useState } from 'react';

import { RecordSelect } from '../fabric/record-select.js';

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
      h('h2', null, 'One sellable set'),
      h('p', null, recipe.reduce((sum, row) => sum + Number(row.pieces), 0) + ' pieces'),
      table(
        [
          ['item', 'Manufactured item'],
          ['size', 'Size'],
          ['pieces', 'Pieces per set'],
        ],
        recipe,
      ),
    ),
    choice('Verifying employee', 'employee_id', data.employees, ({ label }) => label),
    h('p', null, 'Composition is locked after verification.'),
  );
}

export function FinishedCatalogue({ client, screen, canCreate }) {
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
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

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const entry = Object.fromEntries(new FormData(form));
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
      setProductId('');
      setComponents([emptyComponent]);
      setNotice('Saved.');
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
  const rows = {
    products: data.products.map((row) => ({
      ...row,
      status: (row.active ? 'Active' : 'Retired') + (row.verified ? ' · Verified' : ''),
    })),
    prices: data.prices,
    priceTypes: data.types,
  }[screen];

  return h(
    'div',
    null,
    table(columns[screen], rows),
    !rows.length && h('p', null, 'No records yet.'),
    error && h('p', { role: 'alert' }, error),
    notice && h('p', { role: 'status' }, notice),
    canCreate &&
      h(
        'details',
        { open: true },
        h(
          'summary',
          null,
          {
            products: 'New sellable product',
            prices: 'New price version',
            priceTypes: 'New price type',
          }[screen],
        ),
        h(
          'form',
          { onSubmit: submit },
          h(
            'fieldset',
            { disabled: saving },
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
                  choice(
                    'Sellable product',
                    'product_id',
                    data.products.filter(({ active, verified }) => active && verified),
                    ({ sku, name }) => sku + ' · ' + name,
                    {
                      value: productId,
                      onChange: setProductId,
                    },
                  ),
                  choice('Price type', 'type_id', data.types, ({ name }) => name),
                  field('Version', 'version'),
                  field('Price per piece', 'price_per_piece', {
                    type: 'number',
                    min: 0,
                    step: 'any',
                  }),
                  field('Date', 'date', { type: 'date' }),
                ),
                product &&
                  h(
                    'details',
                    null,
                    h('summary', null, 'View sellable product contents and reference costing'),
                    table(
                      [
                        ['item', 'Item'],
                        ['size', 'Size'],
                        ['pieces', 'Pieces per set'],
                        ['reference_cost', 'Finalized cost per piece'],
                      ],
                      product.components,
                    ),
                  ),
              ),
            h(
              'button',
              { type: 'submit' },
              {
                products: 'Verify composition',
                prices: 'Add price version',
                priceTypes: 'Save price type',
              }[screen],
            ),
          ),
        ),
      ),
  );
}
