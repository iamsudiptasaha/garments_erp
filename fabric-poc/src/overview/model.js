import { versionsFor, statusFor } from '../colours/domain.js';
const total = (rows, key) =>
  rows.reduce((n, r) => n + (r[key] == null ? 0 : Number(r[key]) || 0), 0);
export function overviewMetrics(data, canView) {
  const documents = [
    ['orders', 'Yarn orders', 'yarn_purchase_order'],
    ['yarn', 'Yarn bills', 'yarn_bill'],
    ['knitting', 'Knitting bills', 'knitting_bill'],
    ['programs', 'Dyeing programs', 'dyeing_program'],
    ['dyeBills', 'Dyed fabric bills', 'dyed_fabric_bill'],
  ]
    .filter(([key]) => canView(key))
    .map(([key, label, table]) => ({ key, label, value: (data[table] || []).length }));
  const weights = [
    ['yarn', 'Yarn received', 'yarn_bill_item'],
    ['knitting', 'Knitted fabric', 'knitting_bill_item'],
    ['dyeBills', 'Dyed fabric billed', 'dyed_fabric_item'],
  ]
    .filter(([key]) => canView(key))
    .map(([key, label, table]) => ({
      key,
      label,
      value: total(data[table] || [], 'billed_quantity'),
    }));
  const statusCounts = new Map();
  if (canView('labDips'))
    for (const lab of data.lab_dip || []) {
      const latest = versionsFor(data, lab.id).at(-1),
        label = statusFor(data, latest)?.status || 'Status not recorded';
      statusCounts.set(label, (statusCounts.get(label) || 0) + 1);
    }
  const statuses = [...statusCounts].map(([label, value]) => ({ key: 'labDips', label, value }));
  return { documents, weights, statuses };
}
