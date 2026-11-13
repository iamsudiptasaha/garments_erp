import { FilePanel } from '../files/panel.js';
import { RecordAttachmentField, useRecordAttachments } from '../files/record-attachments.js';
import { ReviewForm, useSaveReview } from '../fabric/save-review.js';
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { FabricSheet } from '../fabric/sheet.js';
import { WorksheetToolbar, useGridSearch } from '../fabric/grid-toolbar.js';
import { WorkspaceViewToggle } from '../fabric/view-toggle.js';
import { FinishedGoodsEditor as DocumentDialog } from '../finished-goods/sheet-view.js';

const columns = [
  ['po_number', 'PO number'],
  ['buyer', 'Buyer'],
  ['issue_date', 'Issue date'],
  ['modes', 'Sale modes'],
  ['line_count', 'Lines'],
];
const spec = {
  title: 'Buyer PO',
  columns: columns.map(([key, label]) => ({ key, label, numeric: key === 'line_count' })),
};
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const title = (value) => (value === 'standard' ? 'Standard' : 'Exception');

function table(columns, rows) {
  return h(
    'div',
    { className: 'lab-record-table-wrap billing-table-frame' },
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          columns.map((label) => h('th', { key: label, scope: 'col' }, label)),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map(({ id, cells }) =>
          h(
            'tr',
            { key: id },
            cells.map((cell, index) => h('td', { key: columns[index] }, cell ?? '—')),
          ),
        ),
      ),
    ),
  );
}

function field(label, name, attrs = {}) {
  return h('label', null, h('span', null, label), h('input', { name, ...attrs }));
}

function select(label, name, options, attrs = {}) {
  return h(
    'label',
    null,
    h('span', null, label),
    h(
      'select',
      { name, 'aria-label': label, ...attrs },
      h('option', { value: '' }, 'Select'),
      options.map(([value, text]) => h('option', { key: value, value }, text)),
    ),
  );
}

function POEntry({ client, onSaved, onClose, canEdit }) {
  const [choices, setChoices] = useState(null);
  const [lines, setLines] = useState([{ id: 0, mode: 'standard', item: '' }]);
  const [error, setError] = useState('');
  const review = useSaveReview();
  const reviewedFiles = useRef(null);
  review.locked = reviewedFiles.current?.saved;
  const attachments = useRecordAttachments(client);
  const { busy } = review;
  useEffect(() => {
    let current = true;
    client.rpc('erp_portal_buyer_po_choices').then(({ data, error }) => {
      if (!current) return;
      if (error) setError(error.message);
      else setChoices(data);
    });
    return () => {
      current = false;
    };
  }, [client]);
  function update(id, change) {
    setLines((previous) =>
      previous.map((line) => (line.id === id ? { ...line, ...change } : line)),
    );
  }
  const components = (line) =>
    line.mode === 'standard'
      ? (choices.products.find((product) => product.id === line.item)?.pieces ?? [])
      : choices.sizes.filter((size) => size.id === line.item);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const get = (key) => String(form.get(key) ?? '').trim();
    const order = Object.fromEntries(
      [
        'number',
        'buyer_id',
        'issue_date',
        'expiry_date',
        'season',
        'billing_address',
        'delivery_address',
      ].map((key) => [key, get(key) || null]),
    );
    order.lines = lines.map((line) => ({
      mode: line.mode,
      [line.mode === 'standard' ? 'sellable_product_id' : 'size_id']: line.item,
      quantity: Number(get(`quantity-${line.id}`)),
      price: get(`price-${line.id}`),
      style_code: get(`style-${line.id}`),
      color: get(`color-${line.id}`),
      codes: Object.fromEntries(
        components(line).map((piece) => [
          piece.id,
          {
            fcid: get(`fcid-${line.id}-${piece.id}`),
            hsn_code: get(`hsn-${line.id}-${piece.id}`),
          },
        ]),
      ),
    }));

    const payload = {
      p_order: order,
    };
    setError('');
    let files;
    try {
      files = attachments.prepare();
      reviewedFiles.current = files;
    } catch (failure) {
      setError(failure.message);
      return;
    }
    review.prepare(
      payload,
      [
        ['PO number', order.number],
        ['Buyer', event.currentTarget.elements.buyer_id.selectedOptions[0]?.text],
        ['Issue date', order.issue_date],
        ['Expiry date', order.expiry_date],
        ['Season', order.season],
        ['Billing address', order.billing_address],
        ['Delivery address', order.delivery_address],
        ...files.rows,
        ...order.lines.flatMap((entry, index) => {
          const line = lines[index];
          const label = event.currentTarget.elements.namedItem('item-' + line.id)
            ?.selectedOptions?.[0]?.text;
          return [
            ['Line ' + (index + 1), [line.mode, label || line.item].join(' · ')],
            [line.mode === 'standard' ? 'Ordered sets' : 'Ordered pieces', entry.quantity],
            ['Unit price', entry.price],
            ['Style code', entry.style_code],
            ['Colour', entry.color],
            ...components(line).flatMap((piece) => [
              [
                [piece.style, piece.size, 'Ordered pieces'].filter(Boolean).join(' · '),
                entry.quantity * Number(piece.weight ?? 1),
              ],
              [(piece.label ?? piece.size ?? piece.id) + ' · FCID', entry.codes[piece.id].fcid],
              [(piece.label ?? piece.size ?? piece.id) + ' · HSN', entry.codes[piece.id].hsn_code],
            ]),
          ];
        }),
      ],
      async (reviewed, requestId) => {
        const id = await files.confirm(async () => {
          const response = await client.rpc('erp_portal_create_buyer_po', {
            ...reviewed,
            p_request_id: requestId,
          });
          if (response.error) throw response.error;
          return response.data;
        });
        onClose();
        onSaved(id);
      },
      'Review buyer PO',
    );
  }
  if (!choices)
    return h('p', { role: error ? 'alert' : 'status' }, error || 'Loading eligible items…');
  return h(
    ReviewForm,
    { review, onSubmit: save },
    h(
      'section',
      { className: 'fabric-line' },
      h('h3', null, 'Order details'),
      h(
        'div',
        { className: 'fabric-fields' },
        field('PO number', 'number', { required: true }),
        select(
          'Buyer',
          'buyer_id',
          choices.buyers.map(({ id, name }) => [id, name]),
          { required: true },
        ),
        field('Issue date', 'issue_date', { type: 'date', required: true }),
        field('Expiry date', 'expiry_date', { type: 'date' }),
        field('Season', 'season'),
        field('Billing address', 'billing_address'),
        field('Delivery address', 'delivery_address'),
      ),
    ),
    lines.map((line, index) => {
      const standard = line.mode === 'standard';
      const options = standard
        ? choices.products.map(({ id, sku, name }) => [id, `${sku} · ${name}`])
        : choices.sizes.map(({ id, style, size }) => [id, `${style} · ${size}`]);
      return h(
        'section',
        { key: line.id, className: 'fabric-line' },
        h('h3', null, `PO item ${index + 1}`),
        h(
          'div',
          { className: 'fabric-fields' },
          select(
            'Sale mode',
            `mode-${line.id}`,
            [
              ['standard', 'Standard'],
              ['exception', 'Exception'],
            ],
            {
              required: true,
              value: line.mode,
              onChange: (event) => update(line.id, { mode: event.target.value, item: '' }),
            },
          ),
          select('ERP item / sellable product', `item-${line.id}`, options, {
            required: true,
            value: line.item,
            onChange: (event) => update(line.id, { item: event.target.value }),
          }),
          field('Style code', `style-${line.id}`, {
            key: line.item,
            defaultValue: components(line)[0]?.style,
          }),
          field('Color', `color-${line.id}`),
          field(standard ? 'Ordered sets' : 'Ordered pieces', `quantity-${line.id}`, {
            type: 'number',
            min: 1,
            step: 1,
            required: true,
          }),
          field('PO unit price', `price-${line.id}`, {
            type: 'number',
            min: 0,
            step: 'any',
            required: true,
          }),
        ),
        line.item &&
          table(
            ['ERP component', 'Size', 'Pieces per unit', 'FCID', 'HSN code'],
            components(line).map((piece) => ({
              id: piece.id,
              cells: [
                piece.style,
                piece.size,
                piece.weight ?? 1,
                h('input', {
                  'aria-label': `FCID · ${piece.style} · ${piece.size}`,
                  name: `fcid-${line.id}-${piece.id}`,
                }),
                h('input', {
                  'aria-label': `HSN code · ${piece.style} · ${piece.size}`,
                  name: `hsn-${line.id}-${piece.id}`,
                }),
              ],
            })),
          ),
        lines.length > 1 &&
          h(
            'button',
            {
              type: 'button',
              onClick: () => setLines(lines.filter((entry) => entry.id !== line.id)),
            },
            'Remove PO item',
          ),
      );
    }),
    h(RecordAttachmentField, { attachments, client, targetKey: 'buyerPO', canWrite: canEdit }),
    error && h('p', { role: 'alert' }, error),
    h(
      'div',
      { className: 'fabric-actions' },
      h(
        'button',
        {
          type: 'button',
          disabled: lines.length >= 100,
          onClick: () =>
            setLines([...lines, { id: lines.at(-1).id + 1, mode: 'standard', item: '' }]),
        },
        'Add PO item',
      ),
      h('button', { type: 'submit', className: 'primary', disabled: busy }, 'Review buyer PO'),
    ),
  );
}

function PODetail({ client, id, onBack, createInvoice, canEdit }) {
  const { files, error: fileError } = useRecordAttachments(client);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    client.rpc('erp_portal_buyer_po', { p_id: id }).then(({ data, error }) => {
      if (!current) return;
      if (error || !data?.length) setError(error?.message || 'Buyer PO not found.');
      else setOrder(data[0]);
    });
    return () => {
      current = false;
    };
  }, [client, id]);
  return h(
    'section',
    null,
    h(
      'header',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('h1', null, order?.po_number ?? 'Buyer PO'),
        h('p', null, 'Buyer purchase order'),
      ),
      h(
        'div',
        { className: 'fabric-actions' },
        h('button', { type: 'button', onClick: onBack }, 'Back to Buyer PO'),
        order &&
          createInvoice &&
          h(
            'button',
            { type: 'button', className: 'primary', onClick: () => createInvoice(order.id) },
            'Create invoice',
          ),
      ),
    ),
    error && h('p', { role: 'alert' }, error),
    !order && !error && h('p', { role: 'status' }, 'Loading buyer PO…'),
    order &&
      (files
        ? h(FilePanel, {
            ...files,
            targetKey: 'buyerPO',
            recordId: order.id,
            recordLabel: order.po_number,
            heading: 'PO attachments',
            targetDefinition: files.routes.find(({ key }) => key === 'buyerPO'),
            canWrite: canEdit,
          })
        : fileError && h('p', { role: 'alert' }, fileError)),
    order &&
      h(
        'section',
        { className: 'fabric-line' },
        h('h2', null, 'Order details'),
        h(
          'dl',
          { className: 'billing-meta' },
          [
            ['Buyer', 'buyer'],
            ['Issue date', 'issue_date'],
            ['Expiry date', 'expiry_date'],
            ['Season', 'season'],
            ['Billing address', 'billing_address'],
            ['Delivery address', 'delivery_address'],
          ].map(([label, key]) =>
            h('div', { key }, h('dt', null, label), h('dd', null, order[key] || '—')),
          ),
        ),
      ),
    order &&
      h(
        'section',
        { className: 'fabric-line' },
        h('h2', null, 'PO items'),
        table(
          [
            'Item / sellable product',
            'Style code',
            'Color',
            'Sale mode',
            'Ordered',
            'Remaining allowance',
            'PO unit price',
          ],
          order.lines.map((line) => {
            const standard = line.mode === 'standard';
            const ordered = standard
              ? line.sets
              : line.pieces.reduce((sum, piece) => sum + Number(piece.ordered ?? 0), 0);
            const remaining =
              standard && line.pieces.length
                ? Math.min(
                    ...line.pieces.map(({ remaining, weight }) =>
                      Math.floor(Number(remaining) / Number(weight)),
                    ),
                  )
                : line.pieces.reduce((sum, piece) => sum + Number(piece.remaining ?? 0), 0);
            const prices = new Set(line.pieces.map(({ price }) => price));
            const price = standard
              ? line.unit_price
              : prices.size === 1
                ? line.pieces[0].price
                : null;
            const unit = standard ? ' sets' : ' pieces';
            return {
              id: line.id,
              cells: [
                line.product ?? line.style,
                line.style,
                line.color,
                title(line.mode),
                ordered + unit,
                remaining + unit,
                price == null ? '—' : money.format(price),
              ],
            };
          }),
        ),
      ),
    order &&
      h(
        'section',
        { className: 'fabric-line' },
        h('h2', null, 'PO items by size'),
        table(
          ['PO item', 'ERP component', 'Size', 'Pieces ordered', 'FCID', 'HSN code'],
          order.lines.flatMap((line) =>
            line.pieces.map((piece) => ({
              id: `${line.id}-${piece.id}`,
              cells: [
                line.product ?? line.style,
                piece.style,
                piece.size,
                piece.ordered,
                piece.fcid,
                piece.hsn,
              ],
            })),
          ),
        ),
      ),
  );
}

export function BuyerPO({
  client,
  capabilities,
  canCreate,
  canEdit,
  createInvoice,
  poToOpen,
  onPOOpened,
}) {
  const [view, setView] = useState('overview');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState(null);
  const [id, setId] = useState(poToOpen);
  useEffect(() => {
    if (poToOpen) onPOOpened();
  }, [poToOpen, onPOOpened]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const query = useGridSearch(search.trim());
  useEffect(() => {
    if (id) return;
    let current = true;
    setRows(null);
    setError('');
    client
      .rpc('erp_portal_buyer_po', { p_search: query, p_offset: offset })
      .then(({ data, error }) => {
        if (!current) return;
        if (error) setError(error.message);
        else setRows(data);
      });
    return () => {
      current = false;
    };
  }, [client, query, offset, id]);
  const records = useMemo(() => (rows ?? []).slice(0, 50), [rows]);
  if (id) return h(PODetail, { client, id, onBack: () => setId(null), createInvoice, canEdit });
  const canOpen = search.trim() === query && records.some((row) => row.id === selected);
  const add =
    canCreate &&
    h(DocumentDialog, { title: 'New buyer PO', label: 'New buyer PO', defer: true }, (onClose) =>
      h(POEntry, { client, onClose, onSaved: setId, canEdit }),
    );
  return h(
    'section',
    null,
    h(
      'div',
      { className: 'editor-heading' },
      h(
        'div',
        null,
        h('h1', null, 'Buyer PO'),
        h('p', null, 'Select existing ERP items with recorded production stock-in.'),
      ),
      h(WorkspaceViewToggle, {
        label: 'Buyer PO view',
        view,
        onChange: (next) => {
          setSelected(null);
          setView(next);
        },
      }),
    ),
    h(
      WorksheetToolbar,
      {
        label: 'Search PO number or buyer',
        value: search,
        onChange: (value) => {
          setSelected(null);
          setSearch(value);
          setOffset(0);
        },
      },
      add,
      view === 'sheet' &&
        h(
          'button',
          { type: 'button', disabled: !canOpen, onClick: () => setId(selected) },
          'Open selected document',
        ),
    ),
    error && h('p', { role: 'alert' }, error),
    notice && h('p', { role: 'status' }, notice),
    !rows && !error && h('p', { role: 'status' }, 'Loading buyer POs…'),
    rows &&
      (view === 'sheet'
        ? h(FabricSheet, {
            client,
            page: 'billing-buyer-po',
            spec,
            records,
            capabilities,
            paged: offset > 0 || rows.length > 50,
            onSelect: (row) => setSelected(row?.id ?? null),
            onNotice: setNotice,
          })
        : table(
            columns.map(([, label]) => label),
            records.map((record) => ({
              id: record.id,
              cells: columns.map(([key]) =>
                key === 'po_number'
                  ? h(
                      'button',
                      {
                        className: 'open-document',
                        type: 'button',
                        onClick: () => setId(record.id),
                      },
                      record[key],
                    )
                  : record[key],
              ),
            })),
          )),
    rows && records.length === 0 && h('p', null, 'No buyer POs found.'),
    (offset > 0 || rows?.length > 50) &&
      h(
        'div',
        { className: 'fabric-actions' },
        h(
          'button',
          { type: 'button', disabled: offset === 0, onClick: () => setOffset(offset - 50) },
          'Previous',
        ),
        h(
          'button',
          {
            type: 'button',
            disabled: !rows || rows.length <= 50,
            onClick: () => setOffset(offset + 50),
          },
          'Next',
        ),
      ),
  );
}
