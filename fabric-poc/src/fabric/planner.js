import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { useGridSearch, WorksheetToolbar } from './grid-toolbar.js';
import { RecordPageHeading, RecordPageStatus } from './record-page.js';
import { ReviewForm, useSaveReview } from './save-review.js';
import { FabricSheet } from './sheet.js';

const measures = [
  ['required_kg', 'Required'],
  ['estimated_ordered_kg', 'Estimated ordered'],
  ['estimated_received_kg', 'Estimated received'],
  ['receipt_shortage_kg', 'Receipt shortage'],
  ['consumed_kg', 'Consumed'],
];
const column = (key, label, numeric = false) => ({ key, label, numeric });
const kg = (value) =>
  value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
const variantLabel = (row) => [row.style_code, row.variant, row.part].filter(Boolean).join(' · ');
const programLabel = (row) =>
  `${row.program_number} · Lab dip v${row.lab_dip_version} · ${kg(row.ordered_kg)} kg ordered`;

async function call(client, name, args) {
  const result = await client.rpc(name, args);
  if (result.error) throw Error(result.error.message);
  return result.data;
}

function picker(id, label, value, rows, onChange, placeholder = 'All') {
  return h(
    'label',
    { htmlFor: id },
    h('span', { id: id + '-label' }, label),
    h(
      'select',
      {
        id,
        'aria-labelledby': id + '-label',
        value,
        onChange: (event) => onChange(event.target.value),
      },
      h('option', { value: '' }, placeholder),
      rows.map(([id, name]) => h('option', { key: id, value: id }, name)),
    ),
  );
}

function FabricPlanEdit({
  client,
  snapshot,
  row,
  initialFabric,
  program,
  canEdit,
  canLink,
  onSave,
  onClose,
}) {
  const dialog = useRef(null);
  const [fabricId, setFabricId] = useState(initialFabric);
  const [consumption, setConsumption] = useState(null);
  const [programId, setProgramId] = useState('');
  const review = useSaveReview();
  const requirement = snapshot.requirements.find(
    (entry) => entry.variant_item_id === row.id && entry.fabric_type_id === fabricId,
  );
  const fabric = snapshot.fabric_types.find(({ id }) => id === fabricId);
  const programs = snapshot.program_items.filter(
    (entry) =>
      row.lab_dip_id &&
      entry.lab_dip_id === row.lab_dip_id &&
      entry.fabric_type_id === fabricId &&
      (!program || program === entry.dyeing_program_id),
  );
  const programItem = programs.find(
    ({ dyeing_program_item_id }) => dyeing_program_item_id === programId,
  );
  const linked = snapshot.links.some(
    (link) =>
      link.item_part_fabric_id === requirement?.id && link.dyeing_program_item_id === programId,
  );
  const value = consumption ?? requirement?.consumption_per_piece_kg ?? '';
  useEffect(() => {
    dialog.current.showModal();
  }, []);

  function prepare(event) {
    const linkChange = event.nativeEvent.submitter?.value === 'link';
    if (linkChange) {
      if (!canLink || !requirement || !programItem) return;
      review.prepare(
        {
          p_requirement: requirement.id,
          p_program_item: programId,
          p_linked: !linked,
          p_screen: program ? 'programs' : 'productionItems',
        },
        [
          ['Variant / part', variantLabel(row)],
          ['Fabric', fabric.name],
          [linked ? 'Unlink program item' : 'Link program item', programLabel(programItem)],
        ],
        async (args) => onSave(await call(client, 'erp_set_fabric_plan_dyeing_link', args)),
        'Review dyeing program link',
      );
      return;
    }
    if (!canEdit || !fabricId || (value !== '' && !(Number(value) > 0))) return;
    const next = value === '' ? null : Number(value);
    review.prepare(
      {
        p_variant: row.id,
        p_fabric_type: fabricId,
        p_expected_kg: requirement?.consumption_per_piece_kg ?? null,
        p_consumption_kg: next,
      },
      [
        ['Variant / part', variantLabel(row)],
        ['Fabric', fabric.name],
        [
          'Consumption per piece · kg',
          `${kg(requirement?.consumption_per_piece_kg)} → ${kg(next)}`,
        ],
      ],
      async (args) => onSave(await call(client, 'erp_save_fabric_requirement', args)),
      'Review fabric requirement',
    );
  }

  return h(
    'dialog',
    {
      ref: dialog,
      className: 'fabric-dialog',
      'aria-labelledby': 'fabric-plan-edit-title',
      onCancel: (event) => {
        event.preventDefault();
        if (!review.busy) onClose();
      },
    },
    h('h2', { id: 'fabric-plan-edit-title' }, variantLabel(row)),
    h(
      ReviewForm,
      { review, onSubmit: prepare },
      h(
        'div',
        { className: 'fabric-fields' },
        picker(
          'planner-edit-fabric-type',
          'Fabric type',
          fabricId,
          snapshot.fabric_types.map(({ id, name }) => [id, name]),
          (id) => {
            setFabricId(id);
            setConsumption(null);
            setProgramId('');
          },
          'Choose fabric',
        ),
        fabric &&
          h(
            'label',
            null,
            'Consumption per piece · kg',
            h('input', {
              type: 'number',
              step: 'any',
              min: '0',
              value,
              disabled: !canEdit || Boolean(program),
              onChange: (event) => setConsumption(event.target.value),
            }),
          ),
        requirement &&
          picker(
            'planner-dyeing-program-item',
            'Dyeing program item',
            programId,
            programs.map((item) => [item.dyeing_program_item_id, programLabel(item)]),
            setProgramId,
            'Choose compatible program item',
          ),
      ),
      h(
        'div',
        { className: 'editor-actions' },
        h('button', { type: 'button', onClick: onClose }, 'Cancel'),
        canEdit &&
          !program &&
          h(
            'button',
            {
              type: 'submit',
              className: 'primary',
              disabled: !fabric || (value === '' && !requirement),
            },
            'Review consumption',
          ),
        canLink &&
          programItem &&
          h(
            'button',
            { type: 'submit', value: 'link', formNoValidate: true },
            linked ? 'Review unlink' : 'Review link',
          ),
      ),
    ),
  );
}

export function FabricPlanner({ client, canEdit, canLink, program, capabilities }) {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState('Loading fabric plan…');
  const [query, setQuery] = useState('');
  const [item, setItem] = useState('');
  const [colour, setColour] = useState('');
  const [variant, setVariant] = useState('');
  const [fabric, setFabric] = useState('');
  const [selection, setSelection] = useState(null);
  const [open, setOpen] = useState(false);
  const debounced = useGridSearch(query).trim().toLowerCase();
  useEffect(() => {
    let active = true;
    call(client, 'erp_fabric_planner_snapshot').then(
      (data) => {
        if (active) {
          setSnapshot(data);
          setStatus('');
        }
      },
      (error) => {
        if (active) setStatus(error.message);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);
  const programItems = snapshot?.program_items.filter(
    (entry) => entry.dyeing_program_id === program,
  );
  const types = (snapshot?.fabric_types || []).filter(
    ({ id }) =>
      (!fabric || fabric === id) && (!program || programItems.some((p) => p.fabric_type_id === id)),
  );
  const variants = snapshot?.variants || [];
  const compatible = (row) =>
    !program ||
    snapshot.requirements.some(
      (r) =>
        r.variant_item_id === row.id &&
        programItems.some(
          (p) => p.fabric_type_id === r.fabric_type_id && p.lab_dip_id === r.lab_dip_id,
        ),
    );
  const rows = variants.filter(
    (row) =>
      compatible(row) &&
      (!item || item === row.item_id) &&
      (!colour || colour === row.colour) &&
      (!variant || variant === row.variant) &&
      [row.style_code, row.colour, row.variant, row.part].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(debounced),
      ),
  );
  const typesKey = types.map(({ id }) => id).join(',');
  const records = useMemo(
    () =>
      rows.map((row) => {
        const result = {
          id: row.id,
          documentId: row.id,
          colour: row.colour ?? '',
          style: row.style_code ?? '',
          variant: row.variant ?? '',
          part: row.parent_id ? `${row.part} (dependent)` : row.part,
        };
        for (const [key] of measures) result[key] = 0;
        let hasRequirement = false;
        for (const type of types) {
          const entry = snapshot.requirements.find(
            (value) => value.variant_item_id === row.id && value.fabric_type_id === type.id,
          );
          result[`type_${type.id}_consumption`] = entry?.consumption_per_piece_kg ?? '';
          if (entry) hasRequirement = true;
          for (const [key] of measures) {
            result[`type_${type.id}_${key}`] = entry?.[key] ?? '';
            if (entry?.[key] != null) result[key] += Number(entry[key]);
          }
        }
        if (!hasRequirement) for (const [key] of measures) result[key] = '';
        return result;
      }),
    [snapshot, debounced, item, colour, variant, typesKey, program],
  );
  const columns = useMemo(
    () => [
      column('colour', 'Colour'),
      column('style', 'Style code'),
      column('variant', 'Variant'),
      column('part', 'Part'),
      ...types.flatMap(({ id, name }) => [
        column(`type_${id}_consumption`, `${name} · kg / piece`, true),
        ...measures.map(([key, label]) =>
          column(`type_${id}_${key}`, `${name} · ${label} kg`, true),
        ),
      ]),
      ...measures.map(([key, label]) => column(key, `Total · ${label} kg`, true)),
    ],
    [typesKey, snapshot],
  );
  const spec = useMemo(() => ({ title: 'Fabric Planner', columns }), [columns]);
  const record = rows.find(({ id }) => id === selection);
  const initialFabric =
    (program
      ? types.find((type) =>
          snapshot.requirements.some(
            (r) =>
              r.variant_item_id === record?.id &&
              r.fabric_type_id === type.id &&
              programItems.some(
                (entry) => entry.fabric_type_id === type.id && entry.lab_dip_id === r.lab_dip_id,
              ),
          ),
        )?.id
      : fabric) || '';
  const options = (key, label = key) =>
    [
      ...new Map(
        variants.filter((row) => row[key]).map((row) => [row[key], row[label] || row[key]]),
      ),
    ].sort((a, b) => a[1].localeCompare(b[1]));
  function setFilter(change) {
    return (value) => {
      setSelection(null);
      change(value);
    };
  }
  return h(
    'section',
    null,
    h(RecordPageHeading, {
      eyebrow: 'FABRIC',
      title: 'Fabric Planner',
      description: program
        ? `Link compatible requirements to ${programItems?.[0]?.program_number || 'this dyeing program'}.`
        : 'Plan fabric by variant and part. Quantities are in kilograms.',
    }),
    h(
      WorksheetToolbar,
      { label: 'Search fabric plan', value: query, onChange: setFilter(setQuery) },
      h(
        'button',
        {
          type: 'button',
          disabled: !record,
          onClick: () => setOpen(true),
        },
        program
          ? canLink
            ? 'Edit dyeing link'
            : 'View dyeing link'
          : canEdit
            ? 'Edit selected fabric plan'
            : 'View selected fabric plan',
      ),
    ),
    snapshot &&
      h(
        'div',
        { className: 'fabric-fields' },
        picker('planner-item', 'Item', item, options('item_id', 'style_code'), setFilter(setItem)),
        picker('planner-colour', 'Colour', colour, options('colour'), setFilter(setColour)),
        picker('planner-variant', 'Variant', variant, options('variant'), setFilter(setVariant)),
        picker(
          'planner-fabric-type',
          'Fabric type',
          fabric,
          snapshot.fabric_types.map(({ id, name }) => [id, name]),
          setFilter(setFabric),
        ),
      ),
    h(RecordPageStatus, {
      notice: status || 'Estimated coverage is recalculated from current links.',
    }),
    snapshot &&
      h(FabricSheet, {
        page: 'fabricPlanner',
        client,
        spec,
        records,
        onSelect: (row) => setSelection(row?.id ?? null),
        onNotice: setStatus,
        capabilities,
      }),
    types.length > 0 &&
      h(
        'div',
        { className: 'lab-record-table-wrap' },
        h(
          'table',
          null,
          h('caption', null, 'Totals for displayed variants · kg'),
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col' }, 'Fabric type'),
              measures.map(([key, label]) => h('th', { scope: 'col', key }, label)),
            ),
          ),
          h(
            'tbody',
            null,
            types.map(({ id, name }) =>
              h(
                'tr',
                { key: id },
                h('th', { scope: 'row' }, name),
                measures.map(([key]) =>
                  h(
                    'td',
                    { key },
                    kg(
                      records.reduce((sum, row) => sum + Number(row[`type_${id}_${key}`] ?? 0), 0),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    open &&
      record &&
      h(FabricPlanEdit, {
        client,
        snapshot,
        row: record,
        initialFabric,
        program,
        canEdit,
        canLink,
        onClose: () => setOpen(false),
        onSave: (data) => {
          setSnapshot(data);
          setStatus('Fabric plan saved.');
          setOpen(false);
        },
      }),
  );
}
