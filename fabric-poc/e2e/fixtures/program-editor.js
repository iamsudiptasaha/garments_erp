import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { ProgramEditor } from '../../src/fabric/program-editor.js';
import { initialFabric } from '../../src/fabric/domain.js';
import '../../src/fabric/styles.css';
import '../../src/colours/styles.css';
const data = initialFabric();
const lab = data.lab_dip_version.find((v) => v.id === 'seed-navy-v1').lab_dip_id;
const otherLab = data.lab_dip_version.find((v) => v.id === 'seed-sage-v1').lab_dip_id;
data.lab_dip.push({ ...data.lab_dip.find((l) => l.id === lab), id: 'second-navy', edition: 2 });
data.lab_dip_version.push({ id: 'unapproved-navy', lab_dip_id: 'second-navy', version: 1 });
data.lab_dip_version.push({ id: 'navy-second-version', lab_dip_id: lab, version: 2 });
for (let edition = 3; edition <= 7; edition++) {
  data.lab_dip.push({
    ...data.lab_dip.find((l) => l.id === lab),
    id: 'navy-edition-' + edition,
    edition,
  });
  data.lab_dip_version.push({
    id: 'navy-version-' + edition,
    lab_dip_id: 'navy-edition-' + edition,
    version: 1,
  });
}
data.dyeing_program.push({
  id: 'program-fixture',
  program_number: 'DP-REVIEW',
  date: '2026-11-23',
  dyer_id: 'dy1',
  dyeing_program_status_id: '1',
});
data.dyeing_program_lab_dip.push({
  id: 'group-fixture',
  dyeing_program_id: 'program-fixture',
  lab_dip_id: lab,
  lab_dip_version_id: 'seed-navy-v1',
  batch_no: null,
});
data.dyeing_program_item.push({
  id: 'item-fixture',
  dyeing_program_id: 'program-fixture',
  dyeing_program_lab_dip_id: 'group-fixture',
  fabric_type_id: 'ft1',
  quantity: 99,
  comments: 'Existing instructions',
});
data.fabric_plan_dyeing_link = [
  { item_part_fabric_id: 'requirement-body', dyeing_program_item_id: 'item-fixture' },
];
const snapshot = {
  variants: [
    { id: '101', style_code: 'STYLE-A', variant: 'Shared Navy', part: 'Top' },
    { id: '102', style_code: 'STYLE-B', variant: 'Contrast', part: 'Top' },
  ],
  lab_dips: [
    { id: lab, name: 'Navy Edition 1', colour: 'Navy' },
    { id: otherLab, name: 'Sage Edition 1', colour: 'Sage' },
    { id: 'second-navy', name: 'Navy Edition 2', colour: 'Navy' },
  ],
  fabric_types: data.fabric_type,
  sub_parts: [],
  statuses: [
    { id: '1', type: 'Not ordered' },
    { id: '2', type: 'Ordered' },
  ],
  requirements: [
    {
      id: 'requirement-body',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: 'ft1',
      lab_dip_id: lab,
      sub_part_name: 'Body',
      required_kg: 14,
      consumption_per_piece_kg: 0.14,
      item_part_fabric_status_id: '2',
    },
    {
      id: 'requirement-sleeve',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: 'ft1',
      lab_dip_id: lab,
      sub_part_name: 'Sleeve',
      required_kg: 2,
      consumption_per_piece_kg: 0.02,
      item_part_fabric_status_id: '1',
    },
    {
      id: 'requirement-rib',
      variant_item_id: '102',
      variant_id: '10',
      fabric_type_id: 'ft2',
      lab_dip_id: lab,
      sub_part_name: 'Neck Rib',
      required_kg: 5.5,
      consumption_per_piece_kg: 0.055,
      item_part_fabric_status_id: '1',
    },
    {
      id: 'requirement-other-edition',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: 'ft1',
      lab_dip_id: 'second-navy',
      sub_part_name: 'Body edition 2',
      required_kg: 3,
      consumption_per_piece_kg: 0.03,
      item_part_fabric_status_id: '1',
    },
  ],
  links: [],
  program_items: [],
  actual_consumption: [],
};
// Large reference lists exercise the real editor without altering business rules.
if (new URLSearchParams(location.search).has('longOptions')) {
  const navy = data.lab_dip.find((l) => l.id === lab);
  const mapping = data.color_map_by_brand.find((m) => m.id === navy.color_map_by_brand_id);
  for (let n = 8; n <= 50; n++) {
    data.lab_dip.push({ ...navy, id: 'long-edition-' + n, edition: n });
    data.lab_dip_version.push({
      id: 'long-version-' + n,
      lab_dip_id: 'long-edition-' + n,
      version: 1,
    });
    data.color_map.push({ id: 'long-colour-' + n, name: 'Colour ' + n });
    data.color_map_by_brand.push({
      ...mapping,
      id: 'long-mapping-' + n,
      color_map_id: 'long-colour-' + n,
    });
    data.lab_dip.push({
      ...navy,
      id: 'long-colour-lab-' + n,
      color_map_by_brand_id: 'long-mapping-' + n,
    });
  }
}
const client = {
  auth: {
    onAuthStateChange(fn) {
      queueMicrotask(() => fn('SIGNED_IN', { user: { id: 'operator' } }));
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
  async rpc(name, args) {
    if (name === 'erp_fabric_planner_snapshot') return { data: snapshot };
    if (name === 'erp_grid_preferences') {
      const key = 'program-fixture:' + args.p_grid;
      const value = { ...JSON.parse(localStorage.getItem(key) || '{}'), ...args.p_patch };
      localStorage.setItem(key, JSON.stringify(value));
      return { data: value };
    }
    throw Error('Unexpected fixture RPC ' + name);
  },
};
window.programSaves = [];
createRoot(document.getElementById('root')).render(
  h(
    'main',
    { className: 'fabric-main' },
    h(ProgramEditor, {
      data,
      id: 'program-fixture',
      client,
      onSave: async (after) => {
        window.programSaves.push(after);
      },
      onClose: () => {
        document.body.dataset.closed = 'yes';
      },
    }),
  ),
);
