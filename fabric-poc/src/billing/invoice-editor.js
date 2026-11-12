import { createElement as h, useMemo, useState } from 'react';
import { BillingTable, useBillingQuery } from './record-workspace.js';

const modes = [
  ['standard', 'Standard'],
  ['exception', 'Exception'],
];
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

const pieceColumns = [
  { key: 'style', label: 'ERP item' },
  { key: 'size', label: 'Size' },
  { key: 'weight', label: 'Pieces per unit' },
  { key: 'available', label: 'Available pieces' },
  { key: 'remaining', label: 'PO allowance' },
  { key: 'quantity', label: 'Billed pieces' },
  { key: 'price', label: 'Invoice price per piece' },
  { key: 'requested', label: 'Requested pieces' },
  { key: 'fcid', label: 'FCID' },
  { key: 'hsn', label: 'HSN code' },
];

function field(label, name, props = {}) {
  return h('label', null, h('span', null, label), h('input', { name, ...props }));
}

function select(label, name, options, props = {}) {
  return h(
    'label',
    null,
    h('span', null, label),
    h(
      'select',
      { name, 'aria-label': label, ...props },
      h('option', { value: '' }, 'Select'),
      options.map(([id, name]) => h('option', { key: id, value: id }, name)),
    ),
  );
}

function makeLines(invoice) {
  return (invoice?.lines ?? []).map((line) => ({
    key: line.id,
    original: line,
    item: invoice.invoice.formal_po_id
      ? line.po_item_id
      : (line.sellable_product_id ?? line.pieces?.[0]?.item_size_list_id ?? ''),
  }));
}

export function InvoiceEditor({ client, details, onClose, onSaved, formalPO }) {
  const existing = details?.invoice;
  const amended = details?.status === 'finalized';
  const [source, setSource] = useState(
    existing?.formal_po_id || formalPO ? 'formal' : existing?.adhoc_po_id ? 'adhoc' : '',
  );
  const [mode, setMode] = useState(details?.mode ?? '');
  const [po, setPO] = useState(existing?.formal_po_id ?? formalPO ?? '');
  const [lines, setLines] = useState(() => makeLines(details));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [entered, setEntered] = useState({});
  const number = (name, fallback) => Number(entered[name] ?? fallback ?? 0);
  const catalogueArgs = useMemo(() => ({ p_invoice_id: existing?.id ?? null }), [existing?.id]);
  const poArgs = useMemo(
    () => ({ p_po_id: po || null, p_invoice_id: existing?.id ?? null }),
    [po, existing?.id],
  );
  const catalogue = useBillingQuery(client, 'erp_portal_invoice_choices', catalogueArgs);
  const order = useBillingQuery(client, 'erp_portal_invoice_choices', poArgs);
  const availableModes =
    source === 'formal'
      ? modes.filter(([id]) => order.data?.lines?.some((line) => line.mode === id))
      : modes;
  const activeMode = existing ? mode : availableModes.length === 1 ? availableModes[0][0] : mode;
  const standard = activeMode === 'standard';
  const data = catalogue.data;
  const selectedPO = data?.orders.find(({ id }) => id === po);
  const items =
    source === 'formal'
      ? (order.data?.lines ?? []).filter((line) => line.mode === activeMode)
      : standard
        ? (data?.products ?? [])
        : (data?.sizes ?? []);

  function replaceItem(key, item) {
    setLines((previous) => previous.map((line) => (line.key === key ? { ...line, item } : line)));
  }

  function piecesFor(line) {
    const selected = items.find(({ id }) => id === line.item);
    if (selected) return selected.pieces ?? [selected];
    return (line.original?.pieces ?? []).map((piece) => ({
      ...piece,
      id: piece.item_size_list_id,
      weight: piece.share_weight,
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const action = event.nativeEvent.submitter?.value;
    const form = new FormData(event.currentTarget);
    const get = (name) => String(form.get(name) ?? '').trim();
    if (action !== 'cancel' && (!activeMode || !source || (source === 'formal' && !po))) {
      setError('Choose an invoice source and sale mode.');
      return;
    }
    const header = {
      invoice_date: get('date') || null,
      invoice_number: get('number') || null,
      gst_percentage: get('gst') || null,
    };
    const commands = [];
    if (action === 'cancel') commands.push({ action: 'cancel' });
    else {
      if (!existing)
        commands.push({
          action: 'create',
          ...header,
          mode: activeMode,
          adhoc: source === 'adhoc',
          ...(source === 'formal' ? { formal_po_id: po } : { buyer_list_id: get('buyer') }),
        });
      else if (!amended) commands.push({ action: 'save_header', ...header });
      for (const original of details?.lines ?? []) {
        if (!lines.some(({ key }) => key === original.id))
          commands.push({ action: 'remove_line', line_id: original.id });
      }
      for (const line of lines) {
        if (line.original?.frozen) continue;
        const pieces = piecesFor(line);
        const command = { action: 'save_line', line_id: line.original?.id ?? null };
        if (source === 'formal') command.po_item_id = line.item;
        else {
          command.product_type_list_id = get('type-' + line.key);
          command.hsn_by_size = {};
          if (standard) command.variation_id = line.item;
        }
        if (standard) {
          command.sets = Number(get('sets-' + line.key));
          command.unit_price = get('price-' + line.key);
          if (
            line.original?.price_version_id &&
            line.item ===
              (existing.formal_po_id ? line.original.po_item_id : line.original.sellable_product_id)
          ) {
            command.price_version_id = line.original.price_version_id;
          }
        } else {
          command.pieces = pieces
            .map((piece) => ({
              size_id: piece.id,
              pieces: Number(get(`qty-${line.key}-${piece.id}`)),
              price: get(`price-${line.key}-${piece.id}`),
            }))
            .filter(({ pieces }) => pieces > 0);
          if (!command.pieces.length || command.pieces.some(({ price }) => price === '')) {
            setError('Enter a quantity and price for each billed size.');
            return;
          }
        }
        if (source === 'adhoc') {
          for (const piece of pieces) {
            if (standard || command.pieces.some(({ size_id }) => size_id === piece.id))
              command.hsn_by_size[piece.id] = get(`hsn-${line.key}-${piece.id}`);
          }
        }
        commands.push(command);
      }
      if (action === 'finalize') {
        if (!header.invoice_number || header.gst_percentage === null || !lines.length) {
          setError('Enter an invoice number, GST percentage, and at least one line to finalize.');
          return;
        }
        commands.push({
          action: 'finalize',
          invoice_number: header.invoice_number,
          gst_percentage: header.gst_percentage,
        });
      }
    }
    if (!commands.length) {
      onClose();
      return;
    }
    setError('');
    setBusy(true);
    const result = await client.rpc('erp_portal_save_invoice', {
      p_request_id: crypto.randomUUID(),
      p_billing_id: existing?.id ?? null,
      p_commands: commands,
    });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else {
      onClose();
      onSaved(result.data);
    }
  }

  if (!data)
    return h(
      'p',
      { role: catalogue.error ? 'alert' : 'status' },
      catalogue.error || 'Loading invoice choices…',
    );
  const originalValue = lines.reduce((total, line) => {
    if (standard) {
      return (
        total +
        number('sets-' + line.key, line.original?.billed_units) *
          number('price-' + line.key, line.original?.unit_price)
      );
    }
    return piecesFor(line).reduce((subtotal, piece) => {
      const prior = line.original?.pieces?.find(
        ({ item_size_list_id }) => item_size_list_id === piece.id,
      );
      return (
        subtotal +
        number(`qty-${line.key}-${piece.id}`, prior?.billed_pieces) *
          number(`price-${line.key}-${piece.id}`, prior?.price_per_piece)
      );
    }, total);
  }, 0);
  const credit = Number(details?.totals?.verified_credit ?? 0);
  const taxable = originalValue - credit;
  const gst = number('gst', existing?.gst_percentage);
  const tax = (taxable * gst) / 100;
  return h(
    'form',
    {
      className: 'billing-invoice-editor',
      'aria-label': 'Invoice editor',
      onSubmit: save,
      onInput: ({ target }) => {
        if (target.type === 'number') {
          const { name, value } = target;
          setEntered((previous) => ({ ...previous, [name]: value }));
        }
      },
    },
    h(
      'section',
      { className: 'fabric-line' },
      h('h3', null, 'Invoice details'),
      h(
        'div',
        { className: 'fabric-fields' },
        existing
          ? field('Billing source', 'source', {
              value: source === 'formal' ? 'Formal PO' : 'Ad-hoc',
              readOnly: true,
            })
          : select(
              'Billing source',
              'source',
              [
                ['formal', 'Formal PO'],
                ['adhoc', 'Ad-hoc'],
              ],
              {
                value: source,
                required: true,
                onChange: (event) => {
                  setSource(event.target.value);
                  setPO('');
                  setMode('');
                  setLines([]);
                },
              },
            ),
        source === 'formal' &&
          (existing
            ? field('Buyer PO', 'po', { readOnly: true, value: details.po_number })
            : select(
                'Buyer PO',
                'po',
                data.orders.map(({ id, number, buyer }) => [id, number + ' · ' + buyer]),
                {
                  value: po,
                  required: true,
                  onChange: (event) => {
                    setPO(event.target.value);
                    setMode('');
                    setLines([]);
                  },
                },
              )),
        source === 'formal' || existing
          ? field('Buyer', 'buyer', {
              value: details?.buyer ?? selectedPO?.buyer ?? '',
              readOnly: true,
            })
          : source === 'adhoc' &&
              select(
                'Buyer',
                'buyer',
                data.buyers.map(({ id, name }) => [id, name]),
                { required: true },
              ),
        source &&
          (existing || availableModes.length === 1
            ? field('Sale mode', 'mode', {
                disabled: true,
                'aria-describedby':
                  source === 'formal' && availableModes.length === 1
                    ? 'billing-po-mode-help'
                    : undefined,
                value: modes.find(([id]) => id === activeMode)?.[1] ?? '',
              })
            : select('Sale mode', 'mode', availableModes, {
                value: activeMode,
                required: true,
                onChange: (event) => {
                  setMode(event.target.value);
                  setLines([]);
                },
              })),
        source === 'formal' &&
          availableModes.length === 1 &&
          h('small', { id: 'billing-po-mode-help' }, 'Set by the selected buyer PO.'),
        field('Invoice date', 'date', {
          type: 'date',
          required: true,
          defaultValue: existing?.invoice_date ?? new Date().toLocaleDateString('sv-SE'),
          readOnly: amended,
        }),
        field('Invoice number', 'number', {
          placeholder: 'Required at finalization',
          defaultValue: existing?.invoice_number,
          readOnly: amended,
        }),
        field('GST %', 'gst', {
          type: 'number',
          min: 0,
          max: 100,
          step: 'any',
          defaultValue: existing?.gst_percentage,
          readOnly: amended,
        }),
      ),
    ),
    order.error && source === 'formal' && h('p', { role: 'alert' }, order.error),
    lines.map((line, index) => {
      const options = items.map((item) => [
        item.id,
        item.label ?? item.name ?? [item.style, item.size].filter(Boolean).join(' · '),
      ]);
      if (line.item && !options.some(([id]) => id === line.item))
        options.push([
          line.item,
          line.original?.product_name || line.original?.pieces?.[0]?.style || line.item,
        ]);
      const pieces = piecesFor(line);
      const selectedItem = items.find(({ id }) => id === line.item);
      const priorPiece = (id) =>
        line.original?.pieces?.find((piece) => piece.item_size_list_id === id);
      const locked = Boolean(line.original?.frozen);
      const columns = pieceColumns.filter(
        ({ key }) =>
          ((key !== 'quantity' && key !== 'price') || !standard) &&
          (key !== 'requested' || standard) &&
          (key !== 'fcid' || source === 'formal') &&
          (key !== 'remaining' || source === 'formal'),
      );
      return h(
        'section',
        { className: 'fabric-line', key: line.key },
        h('h3', null, 'Invoice line ' + (index + 1)),
        h(
          'div',
          { className: 'fabric-fields' },
          select(
            source === 'formal' ? 'PO item' : 'ERP item / sellable product',
            'item-' + line.key,
            options,
            {
              value: line.item,
              required: true,
              disabled: locked || line.original?.packed,
              onChange: (event) => replaceItem(line.key, event.target.value),
            },
          ),
          standard &&
            field('Billed sets', 'sets-' + line.key, {
              type: 'number',
              step: 1,
              min: 1,
              required: true,
              readOnly: locked,
              defaultValue: line.original?.billed_units,
            }),
          standard &&
            field('Invoice price per set', 'price-' + line.key, {
              type: 'number',
              step: 'any',
              min: 0,
              required: true,
              readOnly: locked,
              defaultValue: line.original?.unit_price,
              placeholder:
                selectedItem?.unit_price == null
                  ? undefined
                  : 'Suggested ' + money.format(selectedItem.unit_price),
            }),
          source === 'adhoc' &&
            select(
              'Product type',
              'type-' + line.key,
              data.types.map(({ id, name }) => [id, name]),
              { required: true, disabled: locked, defaultValue: line.original?.product_type_id },
            ),
        ),
        pieces.length > 0 && h('h3', null, 'Physical composition and stock'),
        pieces.length > 0 &&
          h(BillingTable, {
            key: line.item,
            columns,
            rows: pieces,
            render: (piece, key) => {
              const original = priorPiece(piece.id);
              if (key === 'quantity')
                return h('input', {
                  name: `qty-${line.key}-${piece.id}`,
                  type: 'number',
                  min: 0,
                  step: 1,
                  readOnly: locked,
                  'aria-label': 'Billed pieces · ' + piece.size,
                  defaultValue: original?.billed_pieces ?? 0,
                });
              if (key === 'price')
                return h('input', {
                  name: `price-${line.key}-${piece.id}`,
                  type: 'number',
                  min: 0,
                  step: 'any',
                  readOnly: locked,
                  'aria-label': 'Invoice price · ' + piece.size,
                  defaultValue: original?.price_per_piece,
                  placeholder:
                    piece.price == null ? undefined : 'Suggested ' + money.format(piece.price),
                });
              if (key === 'requested')
                return (
                  number('sets-' + line.key, line.original?.billed_units) *
                  Number(piece.weight ?? 0)
                );
              if (key === 'hsn' && source === 'adhoc')
                return h('input', {
                  name: `hsn-${line.key}-${piece.id}`,
                  required: standard || source === 'adhoc',
                  readOnly: locked,
                  'aria-label': 'HSN · ' + piece.size,
                  defaultValue: original?.hsn,
                });
              if (key === 'available' && source === 'adhoc' && piece.available != null)
                return piece.available + (original?.billed_pieces ?? 0);
              return piece[key];
            },
          }),
        locked
          ? h('p', null, 'A dispatched carton contains this line.')
          : !line.original?.packed &&
              h(
                'button',
                {
                  type: 'button',
                  onClick: () =>
                    setLines((previous) => previous.filter(({ key }) => key !== line.key)),
                },
                'Remove line',
              ),
      );
    }),
    lines.length > 0 &&
      h(
        'section',
        { className: 'fabric-line billing-totals', 'aria-label': 'Invoice totals' },
        h(
          'dl',
          null,
          [
            ['Original billed value', originalValue],
            ['Verified return credits', credit],
            ['Taxable value', taxable],
            [`GST (${gst}%)`, tax],
            ['Total incl. GST', taxable + tax],
          ].map(([label, value]) =>
            h('div', { key: label }, h('dt', null, label), h('dd', null, money.format(value))),
          ),
        ),
      ),
    error && h('p', { role: 'alert' }, error),
    h(
      'div',
      { className: 'editor-actions' },
      activeMode &&
        source &&
        h(
          'button',
          {
            type: 'button',
            disabled: lines.length >= 95,
            onClick: () =>
              setLines((previous) => [...previous, { key: crypto.randomUUID(), item: '' }]),
          },
          'Add invoice line',
        ),
      existing &&
        !amended &&
        h(
          'button',
          { type: 'submit', formNoValidate: true, value: 'cancel', disabled: busy },
          'Cancel draft',
        ),
      h(
        'button',
        { type: 'submit', value: 'save', disabled: busy },
        amended ? 'Save amendment' : 'Save draft',
      ),
      !amended &&
        h(
          'button',
          { type: 'submit', className: 'primary', value: 'finalize', disabled: busy },
          'Finalize invoice',
        ),
    ),
  );
}
