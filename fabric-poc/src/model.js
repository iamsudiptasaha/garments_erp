export const seed = {
  yarn: [
    {
      id: 'y1',
      bill: 'YB-014',
      type: '30S Shivam CCH',
      count: '30S',
      supplier: 'Shivam Yarns',
      quantity: 1000,
      rate: 240,
    },
    {
      id: 'y2',
      bill: 'YB-018',
      type: '24S Swan CCH',
      count: '24S',
      supplier: 'Swan Yarns',
      quantity: 800,
      rate: 225,
    },
  ],
  knitting: [
    {
      id: 'k1',
      bill: 'KB-026',
      date: '2026-10-24',
      knitter: 'Sri Knits',
      yarnId: 'y1',
      fabric: 'Sinker',
      gsm: 180,
      consumption: 500,
      quantity: 485,
      rolls: 24,
      rate: 12,
    },
    {
      id: 'k2',
      bill: 'KB-026',
      date: '2026-10-24',
      knitter: 'Sri Knits',
      yarnId: 'y1',
      fabric: 'Rib',
      gsm: 220,
      consumption: 120,
      quantity: 117,
      rolls: 6,
      rate: 14,
    },
    {
      id: 'k3',
      bill: 'KB-029',
      date: '2026-10-25',
      knitter: 'Metro Knitting',
      yarnId: 'y2',
      fabric: 'Sinker',
      gsm: 180,
      consumption: 300,
      quantity: 294,
      rolls: 15,
      rate: 12,
    },
  ],
  dyed: [
    {
      id: 'd1',
      bill: 'DF-031',
      date: '2026-10-26',
      knittingId: 'k1',
      dyer: 'River Dyeing',
      batch: 'B-104',
      color: 'Navy',
      gross: 300,
      billed: 288,
      final: 285,
      rate: 35,
    },
    {
      id: 'd2',
      bill: 'DF-033',
      date: '2026-10-27',
      knittingId: 'k1',
      dyer: 'City Processors',
      batch: 'B-109',
      color: 'Sage',
      gross: 100,
      billed: 96,
      final: 94,
      rate: 32,
    },
    {
      id: 'd3',
      bill: 'DF-031',
      date: '2026-10-26',
      knittingId: 'k2',
      dyer: 'River Dyeing',
      batch: 'B-104',
      color: 'Navy',
      gross: 100,
      billed: 95,
      final: 94,
      rate: 35,
    },
    {
      id: 'd4',
      bill: 'DF-032',
      date: '2026-10-27',
      knittingId: 'k3',
      dyer: 'River Dyeing',
      batch: 'B-105',
      color: 'Sage',
      gross: 200,
      billed: 192,
      final: 190,
      rate: 32,
    },
  ],
};
export const clone = (v) => structuredClone(v);
export function project(data, page) {
  const yarn = (id) => data.yarn.find((x) => x.id === id),
    knit = (id) => data.knitting.find((x) => x.id === id);
  const fabric = (k) => `${yarn(k.yarnId).count} ${k.fabric}`;
  if (page === 'knitting')
    return data.knitting.map((k) => ({
      ...k,
      fabricName: fabric(k),
      yarnBill: yarn(k.yarnId).bill,
    }));
  if (page === 'dyed')
    return data.dyed.map((d) => {
      const k = knit(d.knittingId),
        y = yarn(k.yarnId),
        w = d.gross > 0 ? (d.gross - d.billed) / d.gross : null;
      return {
        ...d,
        fabricName: fabric(k),
        knittingBill: k.bill,
        wastage: w === null ? null : w * 100,
        finalPrice: w === null ? null : (y.rate + k.rate + d.rate) * (1 + w),
      };
    });
  if (page === 'yarn')
    return data.yarn.map((y) => {
      const linked = data.knitting.filter((k) => k.yarnId === y.id);
      return {
        ...y,
        knitters: [...new Set(linked.map((k) => k.knitter))].join(', '),
        consumed: linked.reduce((a, k) => a + k.consumption, 0),
        left: y.quantity - linked.reduce((a, k) => a + k.consumption, 0),
      };
    });
  if (page === 'greige') {
    const groups = new Map();
    data.knitting.forEach((k) => {
      const key = k.bill + '|' + fabric(k);
      const g = groups.get(key) || {
        id: key,
        bill: k.bill,
        fabricName: fabric(k),
        knitters: new Set(),
        dyers: new Set(),
        quantity: 0,
        consumed: 0,
      };
      g.knitters.add(k.knitter);
      g.quantity += k.quantity;
      data.dyed
        .filter((d) => d.knittingId === k.id)
        .forEach((d) => {
          g.dyers.add(d.dyer);
          g.consumed += d.gross;
        });
      groups.set(key, g);
    });
    return [...groups.values()].map((g) => ({
      ...g,
      knitters: [...g.knitters].join(', '),
      dyers: [...g.dyers].join(', '),
      left: g.quantity - g.consumed,
    }));
  }
  return [];
}
const c = (key, label, opts = {}) => ({ key, label, width: 160, ...opts });
const num = (key, label, editable = false) =>
  c(key, label, { numeric: true, editable, width: 150 });
export const pages = {
  knitting: {
    title: 'Knitting bills',
    subtitle: 'Source yarn → knitted fabric',
    entity: 'knitting',
    columns: [
      c('bill', 'Knitting bill'),
      c('date', 'Date'),
      c('knitter', 'Knitter'),
      c('fabricName', 'Fabric name', { width: 180 }),
      num('gsm', 'Greige GSM', true),
      num('consumption', 'Yarn consumed · kg', true),
      num('quantity', 'Knitted output · kg', true),
      num('rolls', 'Billed rolls', true),
      num('rate', 'Billed rate / kg', true),
      c('yarnBill', 'Source yarn bill'),
    ],
  },
  dyed: {
    title: 'Dyed fabrics',
    subtitle: 'Linked bills, quantities and derived prices',
    entity: 'dyed',
    columns: [
      c('batch', 'Batch no.'),
      c('fabricName', 'Fabric name', { width: 180 }),
      c('color', 'Colour'),
      c('bill', 'Dyed fabric bill'),
      c('date', 'Date'),
      num('gross', 'Greige consumed · kg', true),
      num('billed', 'Billed quantity · kg', true),
      num('final', 'Final quantity · kg', true),
      num('rate', 'Dyeing rate / kg', true),
      num('wastage', 'Wastage · %'),
      num('finalPrice', 'Final price / kg'),
      c('dyer', 'Dyer'),
      c('knittingBill', 'Knitting bill'),
    ],
  },
  yarn: {
    title: 'Yarn left',
    subtitle: 'One row per source yarn bill item',
    columns: [
      c('bill', 'Yarn bill'),
      c('type', 'Yarn type', { width: 210 }),
      c('supplier', 'Supplier'),
      c('knitters', 'Knitters', { width: 230 }),
      num('quantity', 'Billed yarn · kg'),
      num('consumed', 'Consumed · kg'),
      num('left', 'Yarn left · kg'),
    ],
  },
  greige: {
    title: 'Greige left',
    subtitle: 'One row per knitting bill + fabric name',
    columns: [
      c('bill', 'Knitting bill'),
      c('fabricName', 'Fabric name', { width: 180 }),
      c('knitters', 'Knitter', { width: 180 }),
      c('dyers', 'Dyer', { width: 240 }),
      num('quantity', 'Knitted output · kg'),
      num('consumed', 'Greige consumed · kg'),
      num('left', 'Greige left · kg'),
    ],
  },
};
export function validate(data) {
  for (const [entity, fields] of [
    ['yarn', ['quantity', 'rate']],
    ['knitting', ['gsm', 'consumption', 'quantity', 'rolls', 'rate']],
    ['dyed', ['gross', 'billed', 'final', 'rate']],
  ])
    for (const row of data[entity])
      for (const field of fields)
        if (!Number.isFinite(row[field]) || row[field] < 0)
          return `${row.bill}: ${field} must be a non-negative number.`;
  for (const y of data.yarn)
    if (
      data.knitting.filter((k) => k.yarnId === y.id).reduce((a, k) => a + k.consumption, 0) >
      y.quantity + 1e-8
    )
      return `${y.bill}: knitting consumption exceeds available yarn.`;
  for (const k of data.knitting) {
    if (k.quantity > k.consumption + 1e-8)
      return `${k.bill}: knitted output exceeds yarn consumed.`;
    if (
      data.dyed.filter((d) => d.knittingId === k.id).reduce((a, d) => a + d.gross, 0) >
      k.quantity + 1e-8
    )
      return `${k.bill}: dyeing consumption exceeds knitted quantity.`;
  }
  for (const d of data.dyed) {
    if (d.billed > d.gross + 1e-8) return `${d.bill}: billed weight exceeds gross weight.`;
    if (d.final > d.billed + 1e-8) return `${d.bill}: final weight exceeds billed weight.`;
  }
  return null;
}
export function applyChanges(data, entity, changes) {
  const next = clone(data);
  for (const change of changes) {
    const row = next[entity]?.find((r) => r.id === change.id);
    if (!row) throw Error('Record not found.');
    row[change.key] = change.value;
  }
  const error = validate(next);
  if (error) throw Error(error);
  return next;
}
