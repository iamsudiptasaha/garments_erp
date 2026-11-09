import { createElement as h, useEffect, useRef, useState } from 'react';

const maxPieces = 2147483647;

function selector(label, name, choices, props = {}) {
  return h(
    'label',
    null,
    label,
    h(
      'select',
      { name, required: true, ...props },
      h('option', { value: '' }, 'Select…'),
      choices.map(({ id, label }) => h('option', { key: id, value: id }, label)),
    ),
  );
}

export function StockForm({ client, adjustment, onSaved }) {
  const [choices, setChoices] = useState(null);
  const [itemId, setItemId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef(null);

  useEffect(() => {
    let current = true;
    async function load() {
      try {
        const { data, error } = await client.rpc('erp_finished_goods_choices', {
          p_adjustment: adjustment,
        });
        if (error) throw error;
        if (current) setChoices(data);
      } catch (error) {
        if (current) setError(error.message || 'Unable to load stock choices.');
      } finally {
        if (current) setLoading(false);
      }
    }
    load();
    return () => {
      current = false;
    };
  }, [client, adjustment, reload]);

  const item = choices?.items.find(({ id }) => id === itemId);

  const blockedByCosting = !adjustment && item && !item.costing_finalized;

  async function save(event) {
    event.preventDefault();
    if (inFlight.current || !item || blockedByCosting) return;
    const values = new FormData(event.currentTarget);
    const args = { p_item_id: itemId, p_employee_id: values.get('employee') };
    if (adjustment) {
      args.p_size_id = values.get('size');
      args.p_delta = Number(values.get('delta'));
      args.p_reason = values.get('reason').trim();
      if (!args.p_delta || !args.p_reason) {
        setError('Enter a nonzero quantity and a reason.');
        return;
      }
    } else {
      args.p_job_id = item.jobs[0]?.id;
      if (!args.p_job_id) {
        setError('No current completed job found. Reload stock-in choices.');
        return;
      }
      args.p_pieces = Object.fromEntries(
        item.sizes
          .filter(({ id }) => values.get(id) !== '')
          .map(({ id }) => [id, Number(values.get(id))]),
      );
      if (!Object.values(args.p_pieces).some((quantity) => quantity > 0)) {
        setError('Enter a positive quantity for at least one size.');
        return;
      }
    }
    const payload = JSON.stringify(args);
    if (attempt.current?.payload !== payload) {
      attempt.current = { payload, id: crypto.randomUUID() };
    }
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const { data, error } = await client.rpc(
        adjustment ? 'erp_adjust_finished_stock' : 'erp_create_finished_production',
        { ...args, p_request_id: attempt.current.id },
      );
      if (error) throw error;
      onSaved(data);
    } catch (error) {
      setError(error.message || 'Unable to verify stock.');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  if (loading) return h('p', { role: 'status' }, 'Loading stock choices…');
  if (!choices)
    return h(
      'div',
      null,
      h('p', { role: 'alert' }, error),
      h(
        'button',
        {
          onClick: () => {
            setLoading(true);
            setReload(reload + 1);
          },
        },
        'Retry choices',
      ),
    );
  if (!choices.items.length || !choices.employees.length) {
    return h('p', null, 'Verification requires an eligible item and an active employee.');
  }
  return h(
    'form',
    { onSubmit: save },
    h(
      'fieldset',
      { disabled: saving },
      h('legend', null, adjustment ? 'Verify stock correction' : 'Verify stock-in'),
      selector('Manufactured item', 'item', choices.items, {
        value: itemId,
        onChange: (event) => setItemId(event.target.value),
      }),
      blockedByCosting &&
        h('p', { role: 'status' }, 'Complete item costing to finalize production pieces'),
      !blockedByCosting && selector('Verifying employee', 'employee', choices.employees),
      item &&
        !blockedByCosting &&
        h(
          'div',
          { key: itemId },
          adjustment
            ? [
                selector('Size', 'size', item.sizes, { key: 'size' }),
                h(
                  'label',
                  { key: 'delta' },
                  'Quantity change',
                  h('input', {
                    name: 'delta',
                    type: 'number',
                    step: 1,
                    min: -2147483648,
                    max: maxPieces,
                    required: true,
                  }),
                ),
                h(
                  'label',
                  { key: 'reason' },
                  'Reason',
                  h('textarea', { name: 'reason', required: true }),
                ),
              ]
            : [
                h(
                  'details',
                  { key: 'jobs' },
                  h('summary', null, `Current completed jobs (${item.jobs.length})`),
                  h(
                    'ul',
                    null,
                    item.jobs.map(({ id, label }) => h('li', { key: id }, label)),
                  ),
                ),
                ...item.sizes.map(({ id, label }) =>
                  h(
                    'label',
                    { key: id },
                    `Actual pieces · ${label}`,
                    h('input', { name: id, type: 'number', step: 1, min: 0, max: maxPieces }),
                  ),
                ),
              ],
        ),
      error && h('p', { role: 'alert' }, error),
      h(
        'button',
        { type: 'submit', disabled: !item || blockedByCosting },
        saving ? 'Verifying…' : 'Verify',
      ),
    ),
  );
}
