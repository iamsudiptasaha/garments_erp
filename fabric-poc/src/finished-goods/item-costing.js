import { createElement as h, useEffect, useState } from 'react';

const sections = [
  'Fabrics',
  'Trims and Accessories',
  'Production',
  'After production',
  'Peripherals',
];
const peripheralOrder = ['overhead', 'rejection', 'discount', 'profit'];
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

function number(value) {
  return value == null || value === '' ? null : Number(value);
}

export function approvedAmount(line) {
  const pieces = number(line.approved_quantity);
  const rate = number(line.approved_rate);
  return pieces == null || rate == null ? null : pieces * rate;
}

export function costingTotals(lines) {
  const base = lines
    .filter((line) => line.section !== 'Peripherals')
    .reduce((sum, line) => sum + (approvedAmount(line) ?? 0), 0);
  let running = base;
  const amounts = {};
  for (const type of peripheralOrder) {
    const rate =
      Number(lines.find((line) => line.peripheral_type === type)?.approved_rate || 0) / 100;
    const next = type === 'discount' ? running * (1 - rate) : running / (1 - rate);
    amounts[type] = next - running;
    running = next;
  }
  return { base, manufacturing: base + amounts.overhead + amounts.rejection, amounts };
}

function amountLabel(value) {
  return value == null ? '—' : currency.format(value);
}

function ItemCosting({ costing, canEdit, onSave, onFinalize }) {
  const [lines, setLines] = useState(costing.lines);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const editable = canEdit && costing.status !== 'finalized';
  const totals = costingTotals(lines);

  function input(line, field, label) {
    const isPercentage = Boolean(line.peripheral_type);
    return h('input', {
      'aria-label': `${line.description} ${label}`,
      type: 'number',
      min: 0,
      step: field === 'approved_quantity' ? 1 : 'any',
      ...(isPercentage ? { max: 99.999999 } : {}),
      required: true,
      disabled: !editable || busy,
      value: line[field] ?? '',
      onChange: (event) => {
        const value = event.target.value;
        setLines((current) =>
          current.map((row) => (row.id === line.id ? { ...row, [field]: value } : row)),
        );
      },
    });
  }

  function table(rows, isPeripheral = false) {
    return h(
      'table',
      { className: 'costing-lines' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          (isPeripheral
            ? ['Component', 'Approved %', 'Calculated amount']
            : [
                'Cost line',
                'Reference pieces',
                'Reference amount',
                'Approved pieces',
                'Approved rate / piece',
                'Approved amount',
              ]
          ).map((label) => h('th', { key: label, scope: 'col' }, label)),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map((line) =>
          h(
            'tr',
            { key: line.id },
            h('th', { scope: 'row' }, line.description),
            ...(isPeripheral
              ? [
                  h('td', null, input(line, 'approved_rate', 'percentage')),
                  h('td', null, amountLabel(totals.amounts[line.peripheral_type])),
                ]
              : [
                  h('td', null, line.reference_quantity ?? '—'),
                  h('td', null, amountLabel(line.reference_amount)),
                  h('td', null, input(line, 'approved_quantity', 'approved pieces')),
                  h('td', null, input(line, 'approved_rate', 'approved rate per piece')),
                  h('td', null, amountLabel(approvedAmount(line))),
                ]),
          ),
        ),
      ),
    );
  }

  function fabricHierarchy(rows) {
    const parts = Map.groupBy(rows, (line) => line.part_id);
    return h(
      'details',
      { open: true },
      h('summary', null, costing.item_label),
      [...parts].map(([partId, partRows]) =>
        h(
          'details',
          { key: partId, open: true },
          h('summary', null, partRows[0].part_label || 'Unassigned part'),
          [...Map.groupBy(partRows, (line) => line.variant_item_id)].map(
            ([variantId, variantRows]) =>
              h(
                'details',
                { key: variantId, open: true },
                h('summary', null, variantRows[0].variant_label || 'Unassigned variant'),
                table(variantRows),
              ),
          ),
        ),
      ),
    );
  }

  async function submit(event) {
    event.preventDefault();
    const action = event.nativeEvent.submitter?.value === 'finalize' ? onFinalize : onSave;
    setBusy(true);
    setMessage('');
    try {
      await action({
        id: costing.id,
        updated_at: costing.updated_at,
        lines: lines.map(({ id, approved_quantity, approved_rate }) => ({
          id,
          approved_quantity: number(approved_quantity),
          approved_rate: number(approved_rate),
        })),
      });
    } catch (error) {
      setMessage(error.message || 'Unable to save costing.');
    } finally {
      setBusy(false);
    }
  }

  return h(
    'form',
    { onSubmit: submit },
    h('h2', null, 'Item costing'),
    h('p', null, `${costing.item_label} · Version ${costing.version} · ${costing.status}`),
    h('p', null, `Accepted Ready to Dispatch pieces: ${costing.completed_units ?? '—'}`),
    sections.map((section) => {
      const rows = lines.filter((line) => line.section === section);
      return h(
        'details',
        { key: section, open: true },
        h('summary', null, section),
        !rows.length
          ? h('p', null, 'No costing lines.')
          : section === 'Fabrics'
            ? fabricHierarchy(rows)
            : table(rows, section === 'Peripherals'),
      );
    }),
    h('p', null, `Manufacturing cost: ${amountLabel(totals.manufacturing)}`),
    h(
      'p',
      null,
      `Cost per accepted unit: ${amountLabel(costing.completed_units > 0 ? totals.manufacturing / costing.completed_units : null)}`,
    ),
    editable && onSave && h('button', { type: 'submit', disabled: busy }, 'Save draft'),
    editable &&
      onFinalize &&
      h('button', { type: 'submit', value: 'finalize', disabled: busy }, 'Finalize costing'),
    message && h('p', { role: 'alert' }, message),
  );
}

export function CostingHistory({ client, canEdit, itemIds }) {
  const [items, setItems] = useState(null);
  const [itemId, setItemId] = useState('');
  const [history, setHistory] = useState(null);
  const [versionId, setVersionId] = useState('');
  const [revision, setRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    client.rpc('erp_item_costing_read', { p_item_id: null }).then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      else setItems(data);
    });
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!itemId) return;
    let active = true;
    client.rpc('erp_item_costing_read', { p_item_id: itemId }).then(({ data, error }) => {
      if (!active) return;
      if (error) setError(error.message);
      else {
        setHistory(data);
        setVersionId(data[0]?.id ?? '');
      }
    });
    return () => {
      active = false;
    };
  }, [client, itemId, revision]);

  async function start() {
    setStarting(true);
    setError('');
    try {
      const { error } = await client.rpc('erp_item_costing_start', { p_item_id: itemId });
      if (error) throw error;
      setRevision((value) => value + 1);
    } catch (error) {
      setError(error.message);
    } finally {
      setStarting(false);
    }
  }

  async function save(values, finalize) {
    const { error } = await client.rpc('erp_item_costing_save', {
      p_id: values.id,
      p_updated_at: values.updated_at,
      p_lines: values.lines,
      p_finalize: finalize,
    });
    if (error) throw error;
    setRevision((value) => value + 1);
  }

  const costing = history?.find(({ id }) => id === versionId);
  return h(
    'section',
    null,
    h('h2', null, 'Costing history'),
    h(
      'label',
      null,
      'Manufactured item',
      h(
        'select',
        {
          value: itemId,
          disabled: !items,
          onChange: (event) => {
            setError('');
            setHistory(null);
            setVersionId('');
            setItemId(event.target.value);
          },
        },
        h('option', { value: '' }, 'Select…'),
        (items ?? [])
          .filter(({ id }) => !itemIds || itemIds.includes(id))
          .map(({ id, label }) => h('option', { key: id, value: id }, label)),
      ),
    ),
    error && h('p', { role: 'alert' }, error),
    !error && (!items || (itemId && !history)) && h('p', { role: 'status' }, 'Loading costing…'),
    items?.length === 0 &&
      h('p', { role: 'status' }, 'No eligible items. Every item part must reach a complete stage.'),
    history?.length === 0 && h('p', null, 'No costing versions for this item.'),
    Boolean(history?.length) &&
      h(
        'label',
        null,
        'Version',
        h(
          'select',
          {
            value: versionId,
            onChange: (event) => setVersionId(event.target.value),
          },
          history.map(({ id, version, status }) =>
            h('option', { key: id, value: id }, `Version ${version} · ${status}`),
          ),
        ),
      ),
    canEdit &&
      history &&
      !history.some(({ status }) => status === 'draft') &&
      h('button', { type: 'button', onClick: start, disabled: starting }, 'Start costing draft'),
    costing &&
      h(ItemCosting, {
        key: costing.id + ':' + costing.updated_at,
        costing,
        canEdit,
        onSave: (values) => save(values, false),
        onFinalize: (values) => save(values, true),
      }),
  );
}
