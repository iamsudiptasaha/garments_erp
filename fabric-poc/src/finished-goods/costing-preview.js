import { createElement as h, useState } from 'react';
import { ItemCosting } from './item-costing.js';

const line = (id, section, description, quantity, referenceRate, approvedRate) => ({
  id,
  section,
  description,
  reference_quantity: quantity,
  reference_amount: quantity * referenceRate,
  approved_quantity: quantity,
  approved_rate: approvedRate,
});

const fabric = {
  part_id: 'body',
  part_label: 'Body',
  variant_item_id: 'navy',
  variant_label: 'Navy',
};

const sample = {
  id: 'sample-2',
  item_label: 'KT-042 · Rib tee',
  version: 2,
  status: 'draft',
  completed_units: 74,
  lines: [
    { ...line('1', 'Fabrics', 'Navy cotton rib', 74, 68, 70), ...fabric },
    line('2', 'Trims and Accessories', 'Care label and neck tape', 74, 8, 8),
    line('3', 'Production', 'Printing', 80, 14, 15),
    line('4', 'Production', 'Stitching', 78, 22, 23),
    line('5', 'After production', 'Press and pack', 74, 5, 6),
    ...[
      ['overhead', 'Overhead', 5],
      ['rejection', 'Rejection allowance', 2],
      ['discount', 'Discount', 0],
      ['profit', 'Profit', 10],
    ].map(([type, description, rate]) => ({
      id: type,
      section: 'Peripherals',
      peripheral_type: type,
      description,
      approved_rate: rate,
    })),
  ],
};

const previous = {
  ...sample,
  id: 'sample-1',
  version: 1,
  status: 'finalized',
  lines: sample.lines.map((row) => (row.id === '3' ? { ...row, approved_rate: 14 } : row)),
};

export function ItemCostingPreview() {
  const [version, setVersion] = useState('draft');
  const costing = version === 'draft' ? sample : previous;
  return h(
    'section',
    { 'aria-label': 'Item Costing mockup' },
    h('p', { role: 'status' }, 'Design preview · Sample data · Edits are temporary'),
    h(
      'label',
      null,
      'Sample version',
      h(
        'select',
        { value: version, onChange: (event) => setVersion(event.target.value) },
        h('option', { value: 'draft' }, 'Version 2 · Draft'),
        h('option', { value: 'finalized' }, 'Version 1 · Finalized'),
      ),
    ),
    h(ItemCosting, { key: costing.id, costing, canEdit: true }),
  );
}
