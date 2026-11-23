import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { FabricPlanner } from '../../src/fabric/planner-workspace.js';
import '../../src/fabric/styles.css';
import '../../src/colours/styles.css';
const snapshot = {
  variants: [
    { id: '101', variant: 'Summer', style_code: 'STYLE-A', part: 'Top' },
    { id: '102', variant: 'Summer', style_code: 'STYLE-B', part: 'Top' },
  ],
  lab_dips: [
    { id: '41', name: 'Red · Edition 1 · 41', colour: 'Red' },
    { id: '42', name: 'Blue · Edition 2 · 42', colour: 'Blue' },
  ],
  fabric_types: [
    { id: '7', name: 'Dynamic knit' },
    { id: '8', name: 'Dynamic rib' },
  ],
  sub_parts: [],
  statuses: [{ id: '1', type: 'Not ordered' }],
  program_items: [],
  links: [],
  actual_consumption: [],
  requirements: [
    {
      id: '1',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: '7',
      lab_dip_id: '41',
      sub_part_name: 'Body',
      required_kg: 14,
      consumption_per_piece_kg: 0.14,
      item_part_fabric_status_id: '1',
    },
    {
      id: '2',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: '7',
      lab_dip_id: '41',
      sub_part_name: 'Sleeve',
      required_kg: 2,
      consumption_per_piece_kg: 0.02,
      item_part_fabric_status_id: '1',
    },
    {
      id: '3',
      variant_item_id: '101',
      variant_id: '9',
      fabric_type_id: '8',
      lab_dip_id: '42',
      sub_part_name: 'Neck Rib',
      required_kg: 5.5,
      consumption_per_piece_kg: 0.055,
      item_part_fabric_status_id: '1',
    },
    {
      id: '4',
      variant_item_id: '102',
      variant_id: '9',
      fabric_type_id: '7',
      lab_dip_id: '41',
      sub_part_name: 'Body',
      required_kg: 3.25,
      consumption_per_piece_kg: 0.0325,
      item_part_fabric_status_id: '1',
    },
  ],
};
const owner = new URLSearchParams(location.search).get('account') || 'operator';
const client = {
  auth: {
    onAuthStateChange(fn) {
      queueMicrotask(() => fn('SIGNED_IN', { user: { id: owner } }));
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
  async rpc(name, args) {
    if (name === 'erp_fabric_planner_snapshot') return { data: snapshot };
    if (name === 'erp_grid_preferences') {
      const key = 'fixture:' + args.p_owner + ':' + args.p_grid;
      const value = { ...JSON.parse(localStorage.getItem(key) || '{}'), ...args.p_patch };
      localStorage.setItem(key, JSON.stringify(value));
      return { data: value };
    }
    throw Error('Unexpected mutation ' + name);
  },
};
window.refreshPlannerFixture = () => {
  snapshot.requirements[1].required_kg = 3;
  render(1);
};
function render(key = 0) {
  root.render(
    h(
      'main',
      { className: 'fabric-main' },
      h(FabricPlanner, {
        key,
        client,
        canEdit: false,
        canLink: false,
        capabilities: { format: false, export: false, print: false },
      }),
    ),
  );
}
const root = createRoot(document.getElementById('root'));
render();
