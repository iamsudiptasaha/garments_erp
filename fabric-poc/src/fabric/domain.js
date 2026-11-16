import { commentText } from './rich-comment.js';
import {
  programContext,
  batchFor,
  previousBatchLabel,
  upgradeFabricRelationships,
} from './relationships.js';
import { upgradeColours, labRows } from '../colours/domain.js';
import {
  initialProduction,
  upgradeProduction,
  productionRows,
  productionOptions,
  validateProduction,
} from '../production/domain.js';
import {
  initialMiscellaneous,
  upgradeMiscellaneous,
  miscellaneousRows,
  miscellaneousOptions,
  validateMiscellaneous,
} from '../miscellaneous/domain.js';
import {
  initialInventory,
  upgradeInventory,
  inventoryRows,
  inventoryOptions,
  validateInventory,
  prepareInventoryEdit,
} from '../inventory/domain.js';
import { pages } from './catalog.js';
const copy = (value) => structuredClone(value);
const uid = () => crypto.randomUUID();
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const list = (values) => [...new Set(values.filter(Boolean))].join(', ');
export function initialFabric() {
  return upgradeFabricRelationships(
    upgradeColours(
      upgradeProduction({
        ...initialInventory(),
        ...initialMiscellaneous(),
        ...initialProduction(),
        flags_list: [],
        contacts: [
          { id: 's7', company_name: 'Trim House' },
          { id: 's1', company_name: 'Shivam Yarns' },
          { id: 's2', company_name: 'Swan Yarns' },
          { id: 's3', company_name: 'Sri Knits' },
          { id: 's4', company_name: 'Metro Knitting' },
          { id: 's5', company_name: 'River Dyeing' },
          { id: 's6', company_name: 'City Processors' },
        ],
        contact_purpose: [
          ...initialInventory().contact_purpose,
          { id: 'purpose-brand', type: 'Brand' },
          { id: 'purpose-yarn', type: 'Yarn supplier' },
          { id: 'purpose-knitter', type: 'Knitter' },
          { id: 'purpose-dyer', type: 'Dyer' },
        ],
        yarn_supplier: [
          { id: 'ys1', contacts_id: 's1', contact_purpose_id: 'purpose-yarn' },
          { id: 'ys2', contacts_id: 's2', contact_purpose_id: 'purpose-yarn' },
        ],
        knitter: [
          { id: 'kn1', contacts_id: 's3', contact_purpose_id: 'purpose-knitter' },
          { id: 'kn2', contacts_id: 's4', contact_purpose_id: 'purpose-knitter' },
        ],
        dyer: [
          { id: 'dy1', contacts_id: 's5', contact_purpose_id: 'purpose-dyer' },
          { id: 'dy2', contacts_id: 's6', contact_purpose_id: 'purpose-dyer' },
        ],
        yarn_type: [
          { id: 'yt1', name: '30S Shivam CCH', yarn_count: '30S' },
          { id: 'yt2', name: '24S Swan CCH', yarn_count: '24S' },
        ],
        fabric_type: [
          { id: 'ft1', name: 'Sinker' },
          { id: 'ft2', name: 'Rib' },
          { id: 'ft3', name: 'Interlock' },
        ],
        color_map: [
          { id: 'cm1', name: 'Navy', pantone_code: '', attached_swatch: false },
          { id: 'cm2', name: 'Sage', pantone_code: '', attached_swatch: false },
        ],
        brand_list: [
          { id: 'br1', brand: 'Core', contacts_id: 's1', contact_purpose_id: 'purpose-brand' },
        ],
        color_map_by_brand: [
          { id: 'co1', color_map_id: 'cm1', brand_list_id: 'br1' },
          { id: 'co2', color_map_id: 'cm2', brand_list_id: 'br1' },
        ],
        yarn_purchase_order: [
          { id: 'po1', purchase_order_number: 'YPO-014', yarn_supplier_id: 'ys1' },
          { id: 'po2', purchase_order_number: 'YPO-018', yarn_supplier_id: 'ys2' },
        ],
        yarn_purchase_order_item: [
          {
            id: 'pol1',
            purchase_order_number_id: 'po1',
            yarn_type_id: 'yt1',
            rate: 240,
            quantity: 1200,
          },
          {
            id: 'pol2',
            purchase_order_number_id: 'po2',
            yarn_type_id: 'yt2',
            rate: 225,
            quantity: 1000,
          },
        ],
        yarn_bill: [
          { id: 'yb1', invoice_number: 'YB-014', invoice_date: '2026-10-24' },
          { id: 'yb2', invoice_number: 'YB-018', invoice_date: '2026-10-25' },
        ],
        yarn_bill_item: [
          {
            id: 'ybi1',
            yarn_bill_id: 'yb1',
            yarn_purchase_order_item_id: 'pol1',
            billed_rate: 240,
            billed_quantity: 1000,
            billed_bags: 20,
          },
          {
            id: 'ybi2',
            yarn_bill_id: 'yb2',
            yarn_purchase_order_item_id: 'pol2',
            billed_rate: 225,
            billed_quantity: 800,
            billed_bags: 16,
          },
        ],
        knitting_bill: [
          { id: 'kb1', invoice_number: 'KB-026', invoice_date: '2026-10-24', knitter_id: 'kn1' },
          { id: 'kb2', invoice_number: 'KB-029', invoice_date: '2026-10-25', knitter_id: 'kn2' },
        ],
        knitting_bill_item: [
          {
            id: 'ki1',
            knitting_bill_id: 'kb1',
            fabric_type_id: 'ft1',
            yarn_bill_item_id: 'ybi1',
            greige_gsm: 180,
            billed_rate: 12,
            consumption: 500,
            billed_quantity: 485,
            billed_rolls: 24,
          },
          {
            id: 'ki2',
            knitting_bill_id: 'kb1',
            fabric_type_id: 'ft2',
            yarn_bill_item_id: 'ybi1',
            greige_gsm: 220,
            billed_rate: 14,
            consumption: 120,
            billed_quantity: 117,
            billed_rolls: 6,
          },
          {
            id: 'ki3',
            knitting_bill_id: 'kb2',
            fabric_type_id: 'ft1',
            yarn_bill_item_id: 'ybi2',
            greige_gsm: 180,
            billed_rate: 12,
            consumption: 300,
            billed_quantity: 294,
            billed_rolls: 15,
          },
        ],
        lab_dip: [
          {
            id: 'seed-navy',
            edition: 1,
            color_map_by_brand_id: 'co1',
            dyer_id: 'dy1',
            date: '',
            updated_at: null,
          },
          {
            id: 'seed-sage',
            edition: 1,
            color_map_by_brand_id: 'co2',
            dyer_id: 'dy1',
            date: '',
            updated_at: null,
          },
          {
            id: 'seed-sage-dy2',
            edition: 1,
            color_map_by_brand_id: 'co2',
            dyer_id: 'dy2',
            date: '',
            updated_at: null,
          },
        ],
        lab_dip_version: [
          ['seed-navy-v1', 'seed-navy'],
          ['seed-sage-v1', 'seed-sage'],
          ['seed-sage-dy2-v1', 'seed-sage-dy2'],
        ].map(([id, lab_dip_id]) => ({
          id,
          lab_dip_id,
          version: 1,
          date: '',
          lab_dip_status_id: null,
          attached_swatch: false,
          created_at: null,
          updated_at: null,
        })),
        batch_no_lab_dip_version_map: [
          {
            id: 'seed-batch-1',
            dyed_fabric_item_id: 'df1',
            batch_no: 'B-104',
            lab_dip_version_id: 'seed-navy-v1',
          },
          {
            id: 'seed-batch-2',
            dyed_fabric_item_id: 'df2',
            batch_no: 'B-106',
            lab_dip_version_id: 'seed-navy-v1',
          },
          {
            id: 'seed-batch-3',
            dyed_fabric_item_id: 'df3',
            batch_no: 'B-105',
            lab_dip_version_id: 'seed-sage-v1',
          },
          {
            id: 'seed-batch-4',
            dyed_fabric_item_id: 'df4',
            batch_no: 'B-109',
            lab_dip_version_id: 'seed-sage-dy2-v1',
          },
        ],
        dyeing_program: [
          { id: 'dp1', program_number: 'DP-031', date: '2026-10-25', dyer_id: 'dy1' },
          { id: 'dp2', program_number: 'DP-032', date: '2026-10-26', dyer_id: 'dy2' },
        ],
        dyeing_program_item: [
          {
            id: 'di1',
            dyeing_program_id: 'dp1',
            fabric_type_id: 'ft1',
            quantity: 300,
            lab_dip_version_id: 'seed-navy-v1',
            comments: 'Match approved navy swatch.',
          },
          {
            id: 'di2',
            dyeing_program_id: 'dp1',
            fabric_type_id: 'ft2',
            quantity: 100,
            lab_dip_version_id: 'seed-navy-v1',
            comments: 'Match approved navy swatch.',
          },
          {
            id: 'di3',
            dyeing_program_id: 'dp1',
            fabric_type_id: 'ft1',
            quantity: 200,
            lab_dip_version_id: 'seed-sage-v1',
            comments: 'Soft finish.',
          },
          {
            id: 'di4',
            dyeing_program_id: 'dp2',
            fabric_type_id: 'ft1',
            quantity: 100,
            lab_dip_version_id: 'seed-sage-dy2-v1',
            comments: 'Soft finish.',
          },
        ],
        dyed_fabric_bill: [
          { id: 'db1', invoice_number: 'DF-031', invoice_date: '2026-10-26' },
          { id: 'db2', invoice_number: 'DF-032', invoice_date: '2026-10-27' },
        ],
        dyed_fabric_item: [
          {
            id: 'df1',
            dyed_fabric_bill_id: 'db1',
            dyeing_program_item_id: 'di1',
            knitting_bill_item_id: 'ki1',
            dyeing_rate: 35,
            gross_quantity: 300,
            billed_quantity: 288,
            final_quantity: 285,
            dyeing_rolls: 15,
          },
          {
            id: 'df2',
            dyed_fabric_bill_id: 'db1',
            dyeing_program_item_id: 'di2',
            knitting_bill_item_id: 'ki2',
            dyeing_rate: 35,
            gross_quantity: 100,
            billed_quantity: 95,
            final_quantity: 94,
            dyeing_rolls: 5,
          },
          {
            id: 'df3',
            dyed_fabric_bill_id: 'db2',
            dyeing_program_item_id: 'di3',
            knitting_bill_item_id: 'ki3',
            dyeing_rate: 32,
            gross_quantity: 200,
            billed_quantity: 192,
            final_quantity: 190,
            dyeing_rolls: 10,
          },
          {
            id: 'df4',
            dyed_fabric_bill_id: 'db2',
            dyeing_program_item_id: 'di4',
            knitting_bill_item_id: 'ki1',
            dyeing_rate: 32,
            gross_quantity: 100,
            billed_quantity: 96,
            final_quantity: 94,
            dyeing_rolls: 5,
          },
        ],
      }),
    ),
  );
}
// Upgrade the earlier local fixture without changing document or mapping IDs.
export function upgradeFabric(data) {
  data = { ...data, flags_list: data.flags_list || [] };
  if (data.color_map && data.brand_list)
    return upgradeFabricRelationships(
      upgradeColours(upgradeProduction(upgradeMiscellaneous(upgradeInventory(data)))),
    );
  const next = copy(data);
  next.color_map = [];
  next.brand_list = [];
  next.color_map_by_brand = next.color_map_by_brand.map((old) => {
    let colour = next.color_map.find((c) => c.name === old.name);
    if (!colour) {
      colour = { id: uid(), name: old.name, pantone_code: '', attached_swatch: false };
      next.color_map.push(colour);
    }
    let brand = next.brand_list.find((b) => b.brand === (old.brand || 'Core'));
    if (!brand) {
      brand = { id: uid(), brand: old.brand || 'Core' };
      next.brand_list.push(brand);
    }
    return {
      id: old.id,
      color_map_id: colour.id,
      brand_list_id: brand.id,
      dyer_id: null,
      shade_card_no: '',
      shade_card_option: '',
      shade_card_image: '',
    };
  });
  next.item = (next.item || []).map((r) => ({
    ...r,
    brand_id: next.brand_list.some((b) => b.id === r.brand_id) ? r.brand_id : null,
  }));
  return upgradeFabricRelationships(
    upgradeColours(upgradeProduction(upgradeMiscellaneous(upgradeInventory(next)))),
  );
}
export function selectors(data) {
  const get = (table, id) => data[table].find((row) => row.id === id);
  const supplier = (table, id) => get('contacts', get(table, id)?.contacts_id)?.company_name || '—';
  const yarn = (line) => {
    const orderLine = get('yarn_purchase_order_item', line.yarn_purchase_order_item_id),
      order = get('yarn_purchase_order', orderLine?.purchase_order_number_id),
      type = get('yarn_type', orderLine?.yarn_type_id),
      bill = get('yarn_bill', line.yarn_bill_id);
    return {
      orderLine,
      order,
      type,
      bill,
      supplier: supplier('yarn_supplier', order?.yarn_supplier_id),
    };
  };
  const knit = (line) => {
    const source = get('yarn_bill_item', line.yarn_bill_item_id),
      y = yarn(source),
      type = get('fabric_type', line.fabric_type_id),
      bill = get('knitting_bill', line.knitting_bill_id);
    return {
      source,
      y,
      type,
      bill,
      name: y.type?.yarn_count ? `${y.type.yarn_count} ${type?.name}` : 'Yarn count missing',
      supplier: supplier('knitter', bill?.knitter_id),
    };
  };
  const color = (id) => {
    const mapping = get('color_map_by_brand', id),
      master = get('color_map', mapping?.color_map_id),
      brand = get('brand_list', mapping?.brand_list_id);
    return { ...master, brand: brand?.brand, mapping };
  };
  const dyed = (line) => {
    const k = knit(get('knitting_bill_item', line.knitting_bill_item_id)),
      programLine = get('dyeing_program_item', line.dyeing_program_item_id),
      program = get('dyeing_program', programLine?.dyeing_program_id),
      shade = color(programContext(data, programLine).mappingId),
      bill = get('dyed_fabric_bill', line.dyed_fabric_bill_id),
      w =
        line.gross_quantity > 0
          ? (line.gross_quantity - line.billed_quantity) / line.gross_quantity
          : null;
    return {
      k,
      programLine,
      program,
      batch: batchFor(data, line.id)?.batch_no,
      color: shade,
      bill,
      w,
      supplier: supplier('dyer', program?.dyer_id),
    };
  };
  return { get, supplier, yarn, knit, dyed, color };
}
export function fabricRows(data, page) {
  const s = selectors(data),
    { get, supplier, yarn, knit, dyed } = s;
  if (['productionFlags', 'productionGenders'].includes(page))
    return (data[pages[page].entity] || []).map((r) => ({ ...r, documentId: r.id }));
  if (page === 'productionItems')
    return productionRows(data, page).map((row) => ({
      ...row,
      batch_number: data.item.find((item) => item.id === row.documentId)?.batch_number || '—',
      ...(data._live
        ? {
            jobs: (data.production_job_counts || [])
              .filter((c) =>
                data.item_part.some((p) => p.id === c.item_part_id && p.item_id === row.documentId),
              )
              .reduce((n, c) => n + c.jobs, 0),
          }
        : {}),
    }));
  if (data._live && page === 'productionWorkers')
    return productionRows(data, page).map((row) => ({
      ...row,
      jobs:
        data.production_worker_counts?.find((c) => c.job_worker_id === row.documentId)?.jobs || 0,
    }));
  if (pages[page]?.production) return productionRows(data, page);
  if (pages[page]?.inventory) return inventoryRows(data, page, s);
  if (pages[page]?.miscellaneous) return miscellaneousRows(data, page);
  if (page === 'yarnTypes')
    return data.yarn_type.map((r) => ({
      id: r.id,
      documentId: r.id,
      name: r.name,
      count: r.yarn_count,
      uses: data.yarn_purchase_order_item.filter((l) => l.yarn_type_id === r.id).length,
    }));
  if (page === 'fabricTypes')
    return data.fabric_type.map((r) => ({
      id: r.id,
      documentId: r.id,
      name: r.name,
      series: r.series,
      knitting: data.knitting_bill_item.filter((l) => l.fabric_type_id === r.id).length,
      programs: data.dyeing_program_item.filter((l) => l.fabric_type_id === r.id).length,
    }));
  if (page === 'brands')
    return data.brand_list.map((r) => ({
      id: r.id,
      documentId: r.id,
      name: r.brand,
      contact: get('contacts', r.contacts_id)?.company_name || 'Not selected',
      purpose: get('contact_purpose', r.contact_purpose_id)?.type || 'Not selected',
      mappings: data.color_map_by_brand.filter((m) => m.brand_list_id === r.id).length,
    }));
  if (page === 'labDips') return labRows(data);
  if (page === 'colours')
    return data.color_map.map((r) => ({
      id: r.id,
      documentId: r.id,
      name: r.name,
      pantone: r.pantone_code || '—',
      mappings: data.color_map_by_brand.filter((m) => m.color_map_id === r.id).length,
    }));
  if (page === 'colourMappings')
    return data.color_map_by_brand.map((r) => {
      const c = s.color(r.id);
      return {
        id: r.id,
        documentId: r.id,
        name: c.name,
        pantone: c.pantone_code || '—',
        brand: c.brand,
      };
    });
  if (page === 'suppliers')
    return ['yarn_supplier', 'knitter', 'dyer'].flatMap((table) =>
      data[table].map((r) => ({
        id: `${table}:${r.id}`,
        documentId: `${table}:${r.id}`,
        name: supplier(table, r.id),
        kind:
          table === 'yarn_supplier' ? 'Yarn supplier' : table === 'knitter' ? 'Knitter' : 'Dyer',
        table,
        purpose: get('contact_purpose', r.contact_purpose_id)?.type || 'Not selected',
        orders: data[
          table === 'yarn_supplier'
            ? 'yarn_purchase_order'
            : table === 'knitter'
              ? 'knitting_bill'
              : 'dyeing_program'
        ].filter((d) => d[table === 'yarn_supplier' ? 'yarn_supplier_id' : `${table}_id`] === r.id)
          .length,
      })),
    );
  if (page === 'orders')
    return data.yarn_purchase_order_item.map((r) => {
      const h = get('yarn_purchase_order', r.purchase_order_number_id),
        received = sum(
          data.yarn_bill_item.filter((x) => x.yarn_purchase_order_item_id === r.id),
          'billed_quantity',
        );
      return {
        id: r.id,
        documentId: h.id,
        bill: h.purchase_order_number || 'Number pending database save',
        supplier: supplier('yarn_supplier', h.yarn_supplier_id),
        name: get('yarn_type', r.yarn_type_id).name,
        quantity: r.quantity,
        received,
        left: r.quantity - received,
        rate: r.rate,
      };
    });
  if (['yarn', 'yarnLeft'].includes(page))
    return data.yarn_bill_item.map((r) => {
      const y = yarn(r),
        linked = data.knitting_bill_item.filter((k) => k.yarn_bill_item_id === r.id),
        consumed = sum(linked, 'consumption');
      return {
        id: r.id,
        documentId: y.bill.id,
        bill: y.bill.invoice_number,
        date: y.bill.invoice_date,
        name: y.type.name,
        supplier: y.supplier,
        source: y.order.purchase_order_number,
        quantity: r.billed_quantity,
        bags: r.billed_bags,
        rate: r.billed_rate,
        consumed,
        left: r.billed_quantity - consumed,
        knitters: list(linked.map((k) => knit(k).supplier)),
        displayValues: { knitters: [...new Set(linked.map((k) => knit(k).supplier))] },
      };
    });
  if (page === 'knitting')
    return data.knitting_bill_item.map((r) => {
      const k = knit(r);
      return {
        id: r.id,
        documentId: k.bill.id,
        bill: k.bill.invoice_number,
        date: k.bill.invoice_date,
        supplier: k.supplier,
        name: k.name,
        gsm: r.greige_gsm,
        consumed: r.consumption,
        quantity: r.billed_quantity,
        rolls: r.billed_rolls,
        rate: r.billed_rate,
        source: k.y.bill.invoice_number,
      };
    });
  if (page === 'programs')
    return data.dyeing_program_item.map((r) => {
      const h = get('dyeing_program', r.dyeing_program_id);
      return {
        id: r.id,
        documentId: h.id,
        bill: h.program_number || 'Number pending database save',
        date: h.date?.slice(0, 10) || '—',
        supplier: supplier('dyer', h.dyer_id),
        color: s.color(programContext(data, r).mappingId).name,
        mapping:
          optionsFor(data, 'colors').find(
            ([id]) => id === programContext(data, r).mappingId,
          )?.[1] || '—',
        labDip: versionLabelForRow(data, r),
        batch: previousBatchLabel(data, r.batch_no),
        name: get('fabric_type', r.fabric_type_id).name,
        quantity: r.quantity,
        comments: commentText(r.comments || ''),
      };
    });
  if (['dyeBills', 'dyed', 'batches'].includes(page))
    return data.dyed_fabric_item.map((r) => {
      const d = dyed(r);
      return {
        id: r.id,
        documentId: d.bill.id,
        bill: d.bill.invoice_number,
        date: d.bill.invoice_date,
        batch: d.batch,
        verified:
          (data.dyed_bill_verifiers || []).find((v) => v.id === d.bill.verified_by_employee_id)
            ?.label ||
          (d.bill.verified_by_employee_id
            ? `Employee ${d.bill.verified_by_employee_id}`
            : 'Not recorded'),
        name: d.k.name,
        color: d.color.name,
        hex: d.color.hex,
        supplier: d.supplier,
        gross: r.gross_quantity,
        quantity: r.billed_quantity,
        final: r.final_quantity,
        wastage: d.w === null ? '—' : Number((d.w * 100).toFixed(2)),
        rate: r.dyeing_rate,
        price:
          d.w === null
            ? '—'
            : Number(
                (
                  (d.k.source.billed_rate +
                    get('knitting_bill_item', r.knitting_bill_item_id).billed_rate +
                    r.dyeing_rate) *
                  (1 + d.w)
                ).toFixed(2),
              ),
        yarnBill: d.k.y.bill.invoice_number,
        yarn: d.k.y.type.name,
        knitBill: d.k.bill.invoice_number,
        knitter: d.k.supplier,
        program: d.program.program_number,
      };
    });
  if (page === 'greige') {
    const groups = new Map();
    for (const k of data.knitting_bill_item) {
      const details = knit(k),
        key = k.knitting_bill_id + '|' + details.name,
        linked = data.dyed_fabric_item.filter((d) => d.knitting_bill_item_id === k.id),
        g = groups.get(key) || {
          id: key,
          bill: details.bill.invoice_number,
          name: details.name,
          suppliers: [],
          dyerNames: [],
          quantity: 0,
          left: 0,
        };
      g.suppliers.push(details.supplier);
      g.dyerNames.push(...linked.map((d) => dyed(d).supplier));
      g.quantity += k.billed_quantity;
      g.left += k.billed_quantity - sum(linked, 'gross_quantity');
      groups.set(key, g);
    }
    return [...groups.values()].map((g) => ({
      ...g,
      supplier: list(g.suppliers),
      dyers: list(g.dyerNames),
      displayValues: { dyers: [...new Set(g.dyerNames)] },
    }));
  }
  return [];
}
function versionLabelForRow(data, row) {
  const { version, lab } = programContext(data, row);
  return version ? `Edition ${lab.edition} · Version ${version.version}` : 'Not selected';
}
export function optionsFor(data, source) {
  const s = selectors(data);
  const production = productionOptions(data, source);
  if (production) return production;
  const miscellaneous = miscellaneousOptions(data, source);
  if (miscellaneous) return miscellaneous;
  const inventory = inventoryOptions(data, source, s);
  if (inventory) return inventory;
  const suppliers = (table) => data[table].map((r) => [r.id, s.supplier(table, r.id)]);
  if (source === 'fabricContacts') return data.contacts.map((r) => [r.id, r.company_name]);
  if (source === 'fabricContactPurposes') return data.contact_purpose.map((r) => [r.id, r.type]);
  if (source === 'yarnSuppliers') return suppliers('yarn_supplier');
  if (source === 'knitters') return suppliers('knitter');
  if (source === 'dyers') return suppliers('dyer');
  if (source === 'yarnTypes') return data.yarn_type.map((r) => [r.id, r.name]);
  if (source === 'fabricTypes') return data.fabric_type.map((r) => [r.id, r.name]);
  if (source === 'colors')
    return data.color_map_by_brand.map((r) => {
      const c = s.color(r.id);
      return [r.id, `${c.name} / ${c.brand}`];
    });
  if (source === 'colourLibrary')
    return data.color_map.map((r) => [
      r.id,
      `${r.name}${r.pantone_code ? ' · ' + r.pantone_code : ''}`,
    ]);
  if (source === 'brands') return data.brand_list.map((r) => [r.id, r.brand]);
  const page = {
    orderLines: 'orders',
    yarnLines: 'yarn',
    knittingLines: 'knitting',
    programLines: 'programs',
  }[source];
  return fabricRows(data, page).map((r) => [
    r.id,
    `${r.bill} · ${r.name}${r.color ? ' · ' + r.color : ''} · ${r.quantity} kg`,
  ]);
}
const required = (value, label) => {
  if (value === undefined || value === null || String(value).trim() === '')
    throw Error(`${label} is required.`);
};
export function validateFabric(data) {
  validateInventory(data);
  validateMiscellaneous(data);
  validateProduction(data);
  const links = {
    color_map_by_brand: { color_map_id: 'color_map', brand_list_id: 'brand_list' },
    yarn_purchase_order: { yarn_supplier_id: 'yarn_supplier' },
    yarn_purchase_order_item: {
      purchase_order_number_id: 'yarn_purchase_order',
      yarn_type_id: 'yarn_type',
    },
    yarn_bill_item: {
      yarn_bill_id: 'yarn_bill',
      yarn_purchase_order_item_id: 'yarn_purchase_order_item',
    },
    knitting_bill: { knitter_id: 'knitter' },
    knitting_bill_item: {
      knitting_bill_id: 'knitting_bill',
      yarn_bill_item_id: 'yarn_bill_item',
      fabric_type_id: 'fabric_type',
    },
    dyeing_program: { dyer_id: 'dyer' },
    dyeing_program_item: {
      dyeing_program_id: 'dyeing_program',
      fabric_type_id: 'fabric_type',
      lab_dip_version_id: 'lab_dip_version',
    },
    dyed_fabric_item: {
      dyed_fabric_bill_id: 'dyed_fabric_bill',
      dyeing_program_item_id: 'dyeing_program_item',
      knitting_bill_item_id: 'knitting_bill_item',
    },
  };
  for (const [table, fields] of Object.entries(links))
    for (const row of data[table])
      for (const [key, target] of Object.entries(fields))
        if (
          !(
            table === 'dyeing_program_item' &&
            key === 'lab_dip_version_id' &&
            row._needsLabDipSelection
          ) &&
          !data[target].some((r) => r.id === row[key])
        )
          throw Error(
            `A linked ${target.replaceAll('_', ' ')} is missing. Restore the line or change its linked records first.`,
          );
  for (const page of Object.values(pages).filter((p) => p.entity && p.lines)) {
    for (const row of data[page.entity])
      for (const field of page.header)
        if (field.required !== false) required(row[field.key], field.label);
    for (const row of data[page.lines])
      for (const field of page.lineFields) {
        if (field.storage) continue;
        if (field.required !== false) required(row[field.key], field.label);
        if (field.type === 'number' && (!Number.isFinite(row[field.key]) || row[field.key] < 0))
          throw Error(`${field.label} must be a non-negative number.`);
      }
  }
  for (const spec of Object.values(pages).filter((p) => p.master))
    for (const row of data[spec.entity])
      for (const f of spec.header)
        if (
          f.required !== false &&
          !(row._needsContactLinks && ['contacts_id', 'contact_purpose_id'].includes(f.key)) &&
          !(spec.entity === 'job' && f.key === 'verify_employee_id' && !row.verify_employee_id) &&
          !(row.reconciliation && f.key === 'check_out_type_id')
        )
          required(row[f.key], f.label);
  for (const table of ['brand_list', 'yarn_supplier', 'knitter', 'dyer'])
    for (const row of data[table])
      for (const [key, target] of [
        ['contacts_id', 'contacts'],
        ['contact_purpose_id', 'contact_purpose'],
      ])
        if (row[key] && !data[target].some((r) => r.id === row[key]))
          throw Error('Choose an existing company/contact and contact purpose.');
  for (const line of data.dyeing_program_item) {
    const { lab } = programContext(data, line),
      program = data.dyeing_program.find((p) => p.id === line.dyeing_program_id);
    if (lab && lab.dyer_id !== program.dyer_id)
      throw Error('The selected lab-dip version belongs to another dyer.');
    if (line.batch_no) {
      const batch = data.batch_no_lab_dip_version_map.find((b) => b.id === line.batch_no);
      if (!batch || batch.lab_dip_version_id !== line.lab_dip_version_id)
        throw Error('Previous batch must use the exact selected lab-dip version.');
      if (
        data.dyed_fabric_item.find((d) => d.id === batch.dyed_fabric_item_id)
          ?.dyeing_program_item_id === line.id
      )
        throw Error('A program cannot use its own output as a previous batch.');
    }
  }
  const mapRows = data.batch_no_lab_dip_version_map || [];
  if (
    new Set(mapRows.map((b) => b.batch_no)).size !== mapRows.length ||
    new Set(mapRows.map((b) => b.dyed_fabric_item_id)).size !== mapRows.length
  )
    throw Error('Batch numbers and dyed-fabric mappings must be unique.');
  for (const b of mapRows) {
    const dyed = data.dyed_fabric_item.find((d) => d.id === b.dyed_fabric_item_id),
      program = data.dyeing_program_item.find((p) => p.id === dyed?.dyeing_program_item_id);
    if (
      !dyed ||
      !b.batch_no?.trim() ||
      b.batch_no !== b.batch_no.trim() ||
      b.lab_dip_version_id !== program?.lab_dip_version_id
    )
      throw Error('Batch mapping must match the dyed fabric and its program lab-dip version.');
  }
  for (const row of data.dyed_fabric_item) {
    if (!batchFor(data, row.id)) throw Error('Every dyed-fabric item requires a batch mapping.');
    const program = data.dyeing_program_item.find((x) => x.id === row.dyeing_program_item_id),
      knitting = data.knitting_bill_item.find((x) => x.id === row.knitting_bill_item_id);
    if (program.fabric_type_id !== knitting.fabric_type_id)
      throw Error('The dyeing program fabric type must match the knitted fabric source.');
  }
  return true;
}
export function documentFor(data, page, id) {
  const spec = pages[page];
  return {
    header: copy(data[spec.entity].find((r) => r.id === id) || {}),
    lines: spec.lines
      ? copy(
          data[spec.lines]
            .filter((r) => r[spec.foreign] === id)
            .map((r) =>
              page === 'dyeBills'
                ? { ...r, batch_no: batchFor(data, r.id)?.batch_no || '' }
                : page === 'programs'
                  ? { ...r, color_map_by_brand_id: programContext(data, r).mappingId }
                  : r,
            ),
        )
      : [],
  };
}
export function saveDocument(data, page, draft) {
  if (page === 'productionJobs')
    throw Error('Job history is read-only. Use Update Tasks for production handovers.');
  const spec = pages[page],
    next = copy(data),
    id = draft.header.id || uid(),
    header = { id };
  for (const field of spec.header) {
    if (field.generated) {
      header[field.key] =
        data[spec.entity].find((r) => r.id === draft.header.id)?.[field.key] ?? null;
      continue;
    }
    const value = draft.header[field.key];
    if (
      field.required !== false &&
      !((draft.reconciliation || draft.header.reconciliation) && field.key === 'check_out_type_id')
    )
      required(value, field.label);
    header[field.key] =
      field.type === 'checkbox'
        ? Boolean(value)
        : field.type === 'number'
          ? value == null || String(value).trim() === ''
            ? null
            : Number(value)
          : value == null
            ? ''
            : String(value).trim();
    if (field.type === 'select' && !header[field.key]) header[field.key] = null;
    if (field.key === 'dyer_id' && !header[field.key]) header[field.key] = null;
  }
  if (data._live && draft.header.id)
    for (const field of spec.header.filter((f) => f.type === 'date')) {
      const stored = data[spec.entity].find((r) => r.id === draft.header.id)?.[field.key];
      if (stored && String(stored).slice(0, 10) === header[field.key]) header[field.key] = stored;
    }
  for (const field of spec.header)
    if (
      field.type === 'number' &&
      header[field.key] != null &&
      (!Number.isFinite(header[field.key]) || header[field.key] < 0)
    )
      throw Error(`${field.label} must be a non-negative number.`);
  if (page === 'materialContacts' && (!header.is_company || !header.gst)) header.gst = null;
  if (spec.inventory) prepareInventoryEdit(next, page, header, draft);
  if (page === 'productionDesigns') header.share_weight = 1;
  if (
    page === 'productionJobs' &&
    draft.header.id &&
    next.job.find((j) => j.id === id)?.stage_id !== header.stage_id
  )
    throw Error('A stage change requires a new job row.');
  if (spec.master) {
    if (draft.header.id && !next[spec.entity].some((r) => r.id === id))
      throw Error('This record no longer exists. Reopen the page before editing.');
    if (
      spec.identity &&
      next[spec.entity].some(
        (r) =>
          r.id !== id &&
          r[spec.identity].trim().toLowerCase() === header[spec.identity].toLowerCase(),
      )
    )
      throw Error('This name already exists. Edit the existing record.');
    const index = next[spec.entity].findIndex((r) => r.id === id);
    if (index >= 0) next[spec.entity][index] = { ...next[spec.entity][index], ...header };
    else next[spec.entity].push(header);
    if (page === 'brands') delete next.brand_list.find((r) => r.id === id)._needsContactLinks;
    if (
      page === 'colours' &&
      next.color_map.some(
        (r) =>
          r.id !== id &&
          r.name.toLowerCase() === header.name.toLowerCase() &&
          (r.pantone_code || '').toLowerCase() === (header.pantone_code || '').toLowerCase(),
      )
    )
      throw Error('This colour and Pantone reference already exist. Edit the existing colour.');
    if (
      page === 'colourMappings' &&
      next.color_map_by_brand.some(
        (r) =>
          r.id !== id &&
          ['color_map_id', 'brand_list_id'].every((k) => (r[k] || '') === (header[k] || '')),
      )
    )
      throw Error('This colour mapping already exists. Edit the existing mapping.');
    if (!data._live) validateFabric(next);
    return next;
  }
  const invoiceKey =
    spec.entity === 'raw_material_purchase_order'
      ? 'purchase_order_number'
      : page === 'orders'
        ? 'purchase_order_number'
        : page === 'programs'
          ? 'program_number'
          : 'invoice_number';
  if (
    header[invoiceKey] &&
    next[spec.entity].some(
      (r) =>
        r.id !== id &&
        r[invoiceKey] === header[invoiceKey] &&
        (page !== 'knitting' || r.knitter_id === header.knitter_id),
    )
  )
    throw Error('This document already exists. Open it and edit its line items instead.');
  const index = next[spec.entity].findIndex((r) => r.id === id);
  if (index >= 0) next[spec.entity][index] = { ...next[spec.entity][index], ...header };
  else next[spec.entity].push(header);
  if (spec.lines) {
    if (!draft.lines.length) throw Error('Add at least one line before saving.');
    const oldIds = new Set(next[spec.lines].filter((r) => r[spec.foreign] === id).map((r) => r.id));
    const incoming = draft.lines.map((line) => {
      if (line.id && !oldIds.has(line.id))
        throw Error('A line cannot be moved from another document.');
      const result = { id: line.id || uid(), [spec.foreign]: id };
      for (const field of spec.lineFields) {
        if (field.required !== false) required(line[field.key], field.label);
        if (!field.storage)
          result[field.key] =
            field.type === 'number'
              ? Number(line[field.key])
              : String(line[field.key] ?? '').trim();
      }
      if (spec.groups) {
        required(line.lab_dip_version_id, 'Lab-dip version');
        result.lab_dip_version_id = line.lab_dip_version_id;
        result.batch_no = line.batch_no ? String(line.batch_no).trim() : null;
        result.comments = line.comments || '';
      }
      return result;
    });
    if (new Set(incoming.map((r) => r.id)).size !== incoming.length)
      throw Error('Duplicate line identity.');
    next[spec.lines] = next[spec.lines].filter((r) => r[spec.foreign] !== id).concat(incoming);
    if (page === 'dyeBills') {
      const oldMaps = next.batch_no_lab_dip_version_map.filter((b) =>
        oldIds.has(b.dyed_fabric_item_id),
      );
      next.batch_no_lab_dip_version_map = next.batch_no_lab_dip_version_map.filter(
        (b) => !oldIds.has(b.dyed_fabric_item_id),
      );
      incoming.forEach((row, i) =>
        next.batch_no_lab_dip_version_map.push({
          id: oldMaps.find((b) => b.dyed_fabric_item_id === row.id)?.id || uid(),
          dyed_fabric_item_id: row.id,
          batch_no: String(draft.lines[i].batch_no || '').trim(),
          lab_dip_version_id: next.dyeing_program_item.find(
            (p) => p.id === row.dyeing_program_item_id,
          )?.lab_dip_version_id,
        }),
      );
    }
  }
  if (!data._live) validateFabric(next);
  return next;
}
export function saveSupplier(data, draft) {
  const next = copy(data),
    table = { yarn: 'yarn_supplier', knitter: 'knitter', dyer: 'dyer' }[draft.kind];
  if (!table) throw Error('Choose a supplier type.');
  if (!next.contact_purpose.some((p) => p.id === draft.contact_purpose_id))
    throw Error('Choose a contact purpose.');
  let contact;
  if (draft.contactMode === 'new') {
    required(draft.name, 'Company name');
    if (
      next.contacts.some((c) => c.company_name?.toLowerCase() === draft.name.trim().toLowerCase())
    )
      throw Error('This company already exists. Select its contact.');
    contact = { id: uid(), company_name: draft.name.trim() };
    next.contacts.push(contact);
  } else {
    contact = next.contacts.find((c) => c.id === draft.contacts_id);
    if (!contact) throw Error('Choose a company/contact.');
    if (draft.name?.trim()) contact.company_name = draft.name.trim();
  }
  if (draft.id) {
    const [existingTable, id] = draft.id.split(':');
    if (existingTable !== table) throw Error('Supplier type cannot be changed after creation.');
    const link = next[table].find((r) => r.id === id);
    if (!link) throw Error('Supplier no longer exists.');
    if (next[table].some((r) => r.id !== id && r.contacts_id === contact.id))
      throw Error('This company already has that supplier type.');
    Object.assign(link, { contacts_id: contact.id, contact_purpose_id: draft.contact_purpose_id });
    delete link._needsContactLinks;
    validateFabric(next);
    return next;
  }
  if (next[table].some((r) => r.contacts_id === contact.id))
    throw Error('This company already has that supplier type.');
  next[table].push({
    id: uid(),
    contacts_id: contact.id,
    contact_purpose_id: draft.contact_purpose_id,
  });
  if (!data._live) validateFabric(next);
  return next;
}
export function fabricTotals(data) {
  return {
    yarnLeft: sum(fabricRows(data, 'yarnLeft'), 'left'),
    greigeLeft: sum(fabricRows(data, 'greige'), 'left'),
    dyed: sum(data.dyed_fabric_item, 'final_quantity'),
    batches: data.dyed_fabric_item.length,
  };
}
