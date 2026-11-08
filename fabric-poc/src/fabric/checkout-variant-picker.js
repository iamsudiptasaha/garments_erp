import React, { useState } from 'react';

const h = React.createElement;

export function CheckoutVariantPicker({ data, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rows = (data.variant_item || []).map((link) => {
    const part = data.item_part.find((row) => row.id === link.item_part_id);
    return {
      id: link.id,
      item: data.item.find((row) => row.id === part?.item_id)?.style_code || '—',
      part: data.part_list.find((row) => row.id === part?.part_list_id)?.part || '—',
      variant: data.variant.find((row) => row.id === link.variant_id)?.variant_name || '—',
    };
  });
  const selected = rows.find((row) => row.id === value);
  const terms = search.toLowerCase().trim().split(/\s+/);
  const matches = rows.filter(({ item, part, variant }) =>
    terms.every((term) => `${item} ${part} ${variant}`.toLowerCase().includes(term)),
  );
  return h(
    'div',
    { className: 'fabric-record-picker' },
    h('span', null, 'Item variant'),
    h(
      'button',
      { type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open) },
      selected
        ? `${selected.item} / ${selected.part} / ${selected.variant}`
        : 'Browse item variants',
    ),
    selected && h('button', { type: 'button', onClick: () => onChange('') }, 'Clear variant'),
    open &&
      h(
        'section',
        { 'aria-label': 'Choose item variant', className: 'lab-record-table-wrap' },
        h('input', {
          type: 'search',
          'aria-label': 'Search item variants',
          placeholder: 'Search style, part or variant',
          value: search,
          onChange: (event) => setSearch(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') event.preventDefault();
          },
        }),
        matches.length
          ? h(
              'table',
              null,
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  ...['Item', 'Item part', 'Variant', 'Select'].map((label) =>
                    h('th', { key: label, scope: 'col' }, label),
                  ),
                ),
              ),
              h(
                'tbody',
                null,
                ...matches.map((row) =>
                  h(
                    'tr',
                    { key: row.id },
                    h('td', null, row.item),
                    h('td', null, row.part),
                    h('td', null, row.variant),
                    h(
                      'td',
                      null,
                      h(
                        'button',
                        {
                          type: 'button',
                          onClick: () => {
                            onChange(row.id);
                            setOpen(false);
                          },
                        },
                        'Select',
                      ),
                    ),
                  ),
                ),
              ),
            )
          : h(
              'p',
              null,
              rows.length ? 'No matching variants.' : 'No Production item variants are available.',
            ),
      ),
  );
}
