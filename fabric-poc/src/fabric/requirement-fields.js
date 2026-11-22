import { createElement as h } from 'react';

// Shared component inputs; the owning form controls review, authorization and saving.
export function FabricRequirementFields({ prefix, row, options, onChange, disabled = false }) {
  function field(key, label, choices) {
    const id = `${prefix}-${key}`;
    return h(
      'div',
      { key },
      h('label', { htmlFor: id }, label),
      choices
        ? h(
            'select',
            {
              id,
              value: row[key] ?? '',
              disabled,
              required: key === 'fabric_type_id',
              onChange: (e) => onChange({ ...row, [key]: e.target.value || null }),
            },
            h(
              'option',
              { value: '' },
              key === 'item_part_fabric_status_id' ? 'Automatic' : 'Choose…',
            ),
            choices.map(([value, text]) => h('option', { key: value, value }, text)),
          )
        : h('input', {
            id,
            value: row[key] ?? '',
            disabled,
            type: key === 'consumption_per_piece_kg' ? 'number' : 'text',
            ...(key === 'consumption_per_piece_kg'
              ? { min: '0', step: 'any', required: true }
              : {}),
            onChange: (e) => onChange({ ...row, [key]: e.target.value }),
          }),
    );
  }
  return h(
    'div',
    { className: 'fabric-fields' },
    field('sub_part_list_id', 'Sub-part type', options.parts),
    field('sub_part_name', 'Sub-part name'),
    field('fabric_type_id', 'Fabric type', options.fabrics),
    field('lab_dip_id', 'Component lab dip', options.labs),
    field('consumption_per_piece_kg', 'Consumption per piece · kg'),
    field(
      'item_part_fabric_status_id',
      'Manual status',
      options.statuses.filter(([id]) => ['4', '5'].includes(String(id))),
    ),
  );
}
