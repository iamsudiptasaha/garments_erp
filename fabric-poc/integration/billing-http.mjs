import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

const host = process.env.BILLING_TEST_HOST;
assert.match(host, /^127\.0\.0\.1:[0-9]+$/);
assert.ok(process.env.BILLING_TEST_SECRET, 'Expected a disposable test JWT signing secret');

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(n, aal = 'aal2') {
  const suffix = String(n).padStart(12, '0');
  const data = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: '00000000-0000-4000-8000-' + suffix,
      amr: [{ method: 'password' }],
      session_id: '10000000-0000-4000-8000-' + suffix,
      role: 'authenticated',
      aal,
      exp: Math.floor(Date.now() / 1000) + 120,
    }),
  ].join('.');
  return (
    data +
    '.' +
    createHmac('sha256', process.env.BILLING_TEST_SECRET).update(data).digest('base64url')
  );
}
async function rpc(name, body, jwt) {
  const headers = { 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = 'Bearer ' + jwt;
  const response = await fetch('http://' + host + '/rpc/' + name, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
const admin = token(1);
const unauthorized = token(2);
const list = 'erp_portal_invoice_list';
const save = 'erp_portal_save_invoice';
const request = {
  p_request_id: randomUUID(),
  p_billing_id: null,
  p_commands: [
    { action: 'create', adhoc: true, buyer_list_id: 989001, mode: 'exception', gst_percentage: 5 },
  ],
};
for (const [label, name, payload, jwt, expected] of [
  ['anonymous invoice list', list, {}, null, 401],
  ['authenticated user without page permission', list, {}, unauthorized, 403],
  ['AAL1 administrator', list, {}, token(1, 'aal1'), 403],
  ['authorized invoice list', list, {}, admin, 200],
  [
    'spoofed verifier rejected',
    save,
    { ...request, p_commands: [{ ...request.p_commands[0], employee_id: 900002 }] },
    admin,
    400,
  ],
  [
    'service-only RPC blocked',
    'erp_billing_command',
    { p_request_id: randomUUID(), p_employee_id: 900002, p_command: {} },
    admin,
    403,
  ],
]) {
  const result = await rpc(name, payload, jwt);
  assert.equal(result.status, expected, label + ' ' + JSON.stringify(result.body));
  console.log('PASS HTTP ' + label);
}
const [first, second] = await Promise.all([rpc(save, request, admin), rpc(save, request, admin)]);
assert.equal(first.status, 200, JSON.stringify(first.body));
assert.deepEqual(second, first);
console.log('PASS HTTP concurrent duplicate requests yield one invoice');
const detail = await rpc('erp_portal_invoice', { p_billing_id: first.body }, admin);
assert.equal(detail.status, 200);
assert.equal(detail.body.buyer, 'Billing HTTP Test');
assert.equal(detail.body.status, 'draft');
console.log('PASS HTTP signed-in invoice detail');

const poRead = 'erp_portal_buyer_po';
assert.equal((await rpc(poRead, {}, unauthorized)).status, 403);
const choices = await rpc('erp_portal_buyer_po_choices', {}, admin);
assert.equal(choices.status, 200, JSON.stringify(choices.body));
assert.ok(
  choices.body.products.some(
    (product) => product.id === '982001' && product.pieces[0].weight === 2,
  ),
);
const po = await rpc(poRead, { p_id: 982001 }, admin);
assert.equal(po.status, 200, JSON.stringify(po.body));
assert.deepEqual(
  new Set(po.body[0].lines.map((line) => line.mode)),
  new Set(['standard', 'exception']),
);
console.log('PASS HTTP Buyer PO detail, eligible recipe choices and denied lookup');

async function compete(label, contenders) {
  const outcomes = await Promise.all(
    contenders.map(([poId, lineId, pieces]) =>
      rpc(
        save,
        {
          p_request_id: randomUUID(),
          p_billing_id: null,
          p_commands: [
            { action: 'create', formal_po_id: poId, mode: 'exception', gst_percentage: 5 },
            {
              action: 'save_line',
              po_item_id: lineId,
              pieces: [{ size_id: 982001, pieces, price: 40 }],
            },
          ],
        },
        admin,
      ),
    ),
  );
  assert.deepEqual(
    outcomes.map(({ status }) => status).sort(),
    [200, 400],
    JSON.stringify(outcomes),
  );
  assert.match(
    outcomes.find(({ status }) => status === 400).body.message,
    /Insufficient physical stock or PO allowance/,
  );
  const winner = outcomes.find(({ status }) => status === 200);
  const cancelled = await rpc(
    save,
    { p_request_id: randomUUID(), p_billing_id: winner.body, p_commands: [{ action: 'cancel' }] },
    admin,
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  console.log('PASS HTTP ' + label);
}

await compete('competing drafts cannot exceed a shared PO allowance', [
  [982001, 982003, 2],
  [982001, 982003, 2],
]);
await compete('competing drafts against separate POs cannot exceed shared physical stock', [
  [982001, 982002, 8],
  [982002, 982004, 3],
]);

const finalized = [];
for (const [number, quantity] of [
  ['LOCAL-BILL-PARTIAL-1', 2],
  ['LOCAL-BILL-PARTIAL-2', 1],
]) {
  const invoice = await rpc(
    save,
    {
      p_request_id: randomUUID(),
      p_billing_id: null,
      p_commands: [
        { action: 'create', formal_po_id: 982001, mode: 'exception', invoice_date: '2026-11-12' },
        {
          action: 'save_line',
          po_item_id: 982003,
          pieces: [{ size_id: 982001, pieces: quantity, price: 40 }],
        },
        { action: 'finalize', invoice_number: number, gst_percentage: 5 },
      ],
    },
    admin,
  );
  assert.equal(invoice.status, 200, JSON.stringify(invoice.body));
  finalized.push(invoice.body);
}
const remaining = await rpc(poRead, { p_id: 982001 }, admin);
assert.equal(remaining.body[0].lines.find(({ id }) => id === '982003').pieces[0].remaining, 0);
console.log('PASS HTTP one Buyer PO produces two finalized partial invoices');

const packingRequest = {
  p_request_id: randomUUID(),
  p_billing_id: finalized[0],
  p_date: '2026-11-12',
  p_location: 'KOL',
};
const createPacking = 'erp_portal_create_packing_list';
assert.equal((await rpc(createPacking, packingRequest, unauthorized)).status, 403);
const draftPacking = await rpc(
  createPacking,
  { ...packingRequest, p_request_id: randomUUID(), p_billing_id: first.body },
  admin,
);
assert.equal(draftPacking.status, 400);
assert.match(draftPacking.body.message, /finalized invoice/);
const packing = await rpc(createPacking, packingRequest, admin);
assert.equal(packing.status, 200, JSON.stringify(packing.body));
assert.deepEqual(await rpc(createPacking, packingRequest, admin), packing);
const packingList = await rpc('erp_portal_packing_lists', { p_id: packing.body }, admin);
assert.equal(packingList.status, 200, JSON.stringify(packingList.body));
assert.equal(packingList.body[0].status, 'Packing');
assert.deepEqual(packingList.body[0].cartons, []);
console.log(
  'PASS HTTP packing list requires permission and a finalized invoice and can be retried',
);

const packedInvoice = await rpc('erp_portal_invoice', { p_billing_id: finalized[0] }, admin);
assert.equal(packedInvoice.status, 200);
const line = packedInvoice.body.lines[0];
const cartonRequest = {
  p_request_id: randomUUID(),
  p_packing_list_id: packing.body,
  p_carton_id: null,
  p_barcode: 'HTTP-CTN-1',
  p_allocations: [
    { line_id: line.id, pieces: [{ billed_piece_id: line.pieces[0].id, pieces: 2 }] },
  ],
};
const saveCarton = 'erp_portal_save_carton';
assert.equal((await rpc(saveCarton, cartonRequest, unauthorized)).status, 403);
const carton = await rpc(saveCarton, cartonRequest, admin);
assert.equal(carton.status, 200, JSON.stringify(carton.body));
assert.deepEqual(await rpc(saveCarton, cartonRequest, admin), carton);
const updatedPacking = await rpc('erp_portal_packing_lists', { p_id: packing.body }, admin);
assert.equal(updatedPacking.body[0].status, 'Packed');
assert.equal(updatedPacking.body[0].cartons[0].barcode, 'HTTP-CTN-1');
console.log('PASS HTTP allocate carton with audited retry');

const editCarton = {
  ...cartonRequest,
  p_carton_id: carton.body,
  p_barcode: 'HTTP-CTN-EDITED',
  p_allocations: [
    { line_id: line.id, pieces: [{ billed_piece_id: line.pieces[0].id, pieces: 1 }] },
  ],
};
const editedCarton = await rpc(saveCarton, { ...editCarton, p_request_id: randomUUID() }, admin);
assert.equal(editedCarton.status, 200, JSON.stringify(editedCarton.body));
const extraCarton = await rpc(
  saveCarton,
  {
    ...editCarton,
    p_request_id: randomUUID(),
    p_carton_id: null,
    p_barcode: 'HTTP-CTN-EXTRA',
  },
  admin,
);
assert.equal(extraCarton.status, 200, JSON.stringify(extraCarton.body));
const removeExtra = {
  ...editCarton,
  p_request_id: randomUUID(),
  p_carton_id: extraCarton.body,
  p_allocations: [],
};
const removed = await rpc(saveCarton, removeExtra, admin);
assert.equal(removed.status, 200, JSON.stringify(removed.body));
assert.equal(removed.body, null);
assert.deepEqual(await rpc(saveCarton, removeExtra, admin), removed);
const repacked = await rpc(
  saveCarton,
  {
    ...cartonRequest,
    p_request_id: randomUUID(),
    p_carton_id: carton.body,
    p_barcode: 'HTTP-CTN-EDITED',
  },
  admin,
);
assert.equal(repacked.status, 200, JSON.stringify(repacked.body));
console.log('PASS HTTP edit and delete unshipped cartons and reuse released allocation');

const newTransport = 'erp_portal_create_transport';
const transportRequest = {
  p_request_id: randomUUID(),
  p_transporter_id: 982001,
  p_docket: 'HTTP-DOCKET-1',
  p_date: '2026-11-12',
  p_cartons: [carton.body],
};
assert.equal((await rpc(newTransport, transportRequest, unauthorized)).status, 403);
const transport = await rpc(newTransport, transportRequest, admin);
assert.equal(transport.status, 200, JSON.stringify(transport.body));
assert.deepEqual(await rpc(newTransport, transportRequest, admin), transport);
const reassignment = await rpc(
  newTransport,
  { ...transportRequest, p_request_id: randomUUID() },
  admin,
);
assert.equal(reassignment.status, 400, JSON.stringify(reassignment.body));
console.log(
  'PASS HTTP docket and transport creation without a bill and duplicate assignment rejected',
);

const dispatchRequest = { p_request_id: randomUUID(), p_transport_id: transport.body };
assert.equal(
  (await rpc('erp_portal_dispatch_transport', dispatchRequest, unauthorized)).status,
  403,
);
const dispatch = await rpc('erp_portal_dispatch_transport', dispatchRequest, admin);
assert.equal(dispatch.status, 204, JSON.stringify(dispatch.body));
const shipped = await rpc('erp_portal_invoice', { p_billing_id: finalized[0] }, admin);
assert.equal(shipped.body.status, 'dispatched');
console.log('PASS HTTP confirm pickup and mark invoice dispatched');

const verifyReturn = 'erp_portal_verify_return';
const returnRequest = {
  p_request_id: randomUUID(),
  p_billing_id: finalized[0],
  p_lines: [
    {
      mode: 'piece',
      billing_item_id: line.id,
      pieces_by_size: [{ billed_piece_id: line.pieces[0].id, pieces: 1, price: 20 }],
    },
  ],
};
assert.equal((await rpc(verifyReturn, returnRequest, unauthorized)).status, 403);
const summary = 'erp_portal_billing_summary';
const beforeReturn = await rpc(summary, { p_search: 'Billing test' }, admin);
assert.equal(beforeReturn.status, 200, JSON.stringify(beforeReturn.body));
const beforeStock = beforeReturn.body.stock.find(({ id }) => id === '982001');
assert.equal(beforeStock.available, 7);
const returned = await rpc(verifyReturn, returnRequest, admin);
assert.equal(returned.status, 200, JSON.stringify(returned.body));
const adjusted = await rpc('erp_portal_invoice', { p_billing_id: finalized[0] }, admin);
assert.deepEqual(adjusted.body.totals, {
  original_value: 80,
  verified_credit: 20,
  taxable_value: 60,
  gst_amount: 3,
  total_including_gst: 63,
});
console.log('PASS HTTP return one billed piece and recalculate GST and total');
const afterReturn = await rpc(summary, { p_search: 'Billing test' }, admin);
assert.equal(afterReturn.status, 200);
assert.equal(
  afterReturn.body.stock.find(({ id }) => id === '982001').available,
  beforeStock.available + 1,
);
assert.equal(afterReturn.body.totals.verified_credit, 20);
assert.equal((await rpc(summary, {}, unauthorized)).status, 403);
console.log('PASS HTTP partial quantity return restores exactly one physical piece');

const transportList = await rpc('erp_portal_dispatch_workspace', {}, admin);
assert.equal(transportList.status, 200, JSON.stringify(transportList.body));
assert.ok(
  transportList.body.transports.some(
    (row) =>
      row.id === transport.body &&
      row.status === 'Dispatched' &&
      row.docket_number === 'HTTP-DOCKET-1',
  ),
);
console.log('PASS HTTP Dispatch workspace reads the new independent docket');

const viewOnlyCartons = await rpc('erp_portal_carton_workspace', {}, unauthorized);
assert.equal(viewOnlyCartons.status, 200);
assert.ok(
  viewOnlyCartons.body.cartons.some(
    ({ id, status }) => id === carton.body && status === 'Dispatched',
  ),
);
assert.equal((await rpc('erp_portal_dispatch_workspace', {}, unauthorized)).status, 200);
assert.equal((await rpc('erp_portal_return_workspace', {}, unauthorized)).status, 200);
assert.equal(
  (
    await rpc(
      saveCarton,
      {
        ...cartonRequest,
        p_request_id: randomUUID(),
        p_carton_id: carton.body,
        p_allocations: [],
      },
      unauthorized,
    )
  ).status,
  403,
);
const shippedDelete = await rpc(
  saveCarton,
  {
    ...cartonRequest,
    p_request_id: randomUUID(),
    p_carton_id: carton.body,
    p_allocations: [],
  },
  admin,
);
assert.equal(shippedDelete.status, 400);
assert.match(shippedDelete.body.message, /Dispatched carton is immutable/);
console.log('PASS HTTP view-only fulfillment permissions and shipped carton immutability');
