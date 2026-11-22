import { createElement as h, useEffect, useMemo, useRef, useState } from 'react';
import { useGridSearch, WorksheetToolbar } from './grid-toolbar.js';
import { RecordPageHeading, RecordPageStatus } from './record-page.js';
import { ReviewForm, useSaveReview } from './save-review.js';
import { FabricRequirementFields } from './requirement-fields.js';
import { FabricSheet } from './sheet.js';

const measures = [
  ['required_kg', 'Required'],
  ['estimated_ordered_kg', 'Estimated ordered'],
  ['estimated_received_kg', 'Estimated received'],
  ['receipt_shortage_kg', 'Receipt shortage'],
];
const column = (key, label, numeric = false) => ({ key, label, numeric });
const kg = (value) =>
  value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 });
const variantLabel = (row) => [row.style_code, row.variant, row.part].filter(Boolean).join(' · ');
const programLabel = (row) =>
  `${row.program_number} · ${row.program_status} · Lab dip v${row.lab_dip_version} · ${kg(row.ordered_kg)} kg ordered`;

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
  requirement: initialRequirement,
  program,
  canEdit,
  canLink,
  onSave,
  onClose,
}) {
  const dialog = useRef(null);
  const requirement = initialRequirement;
  const [draft, setDraft] = useState(() => ({
    fabric_type_id: requirement?.fabric_type_id ?? '',
    sub_part_list_id: requirement?.sub_part_list_id ?? null,
    sub_part_name: requirement?.sub_part_name ?? '',
    lab_dip_id: requirement?.lab_dip_id ?? row.lab_dip_id,
    consumption_per_piece_kg: requirement?.consumption_per_piece_kg ?? '',
    item_part_fabric_status_id: requirement?.manual_status_id ?? null,
  }));
  const [programId, setProgramId] = useState('');
  const review = useSaveReview();
  const fabric = snapshot.fabric_types.find(({ id }) => id === draft.fabric_type_id);
  const programs = snapshot.program_items.filter(
    (entry) =>
      requirement?.lab_dip_id &&
      entry.lab_dip_id === requirement.lab_dip_id &&
      entry.fabric_type_id === requirement.fabric_type_id &&
      (!program || program === entry.dyeing_program_id),
  );
  const programItem = programs.find(
    ({ dyeing_program_item_id }) => dyeing_program_item_id === programId,
  );
  const linked = snapshot.links.some(
    (link) =>
      link.item_part_fabric_id === requirement?.id && link.dyeing_program_item_id === programId,
  );
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
          ['Fabric', snapshot.fabric_types.find((f) => f.id === requirement.fabric_type_id)?.name],
          [linked ? 'Unlink program item' : 'Link program item', programLabel(programItem)],
        ],
        async (args) => onSave(await call(client, 'erp_set_fabric_plan_dyeing_link', args)),
        'Review dyeing program link',
      );
      return;
    }
    if (!canEdit || !fabric || !(Number(draft.consumption_per_piece_kg) > 0)) return;
    const removing = event.nativeEvent.submitter?.value === 'remove';
    review.prepare(
      {
        p_requirement: requirement?.id ?? null,
        p_variant: row.id,
        p_expected: requirement?.revision ?? null,
        p_values: removing
          ? null
          : {
              ...draft,
              consumption_per_piece_kg: Number(draft.consumption_per_piece_kg),
            },
      },
      [
        ['Variant / part', variantLabel(row)],
        [
          'Sub-part type',
          snapshot.sub_parts.find((p) => p.id === draft.sub_part_list_id)?.part ?? 'Unspecified',
        ],
        ['Sub-part name', draft.sub_part_name || 'Unnamed'],
        ['Fabric', fabric.name],
        [
          'Component lab dip',
          snapshot.lab_dips.find((l) => l.id === draft.lab_dip_id)?.name ?? '—',
        ],
        [
          'Consumption per piece · kg',
          `${kg(requirement?.consumption_per_piece_kg)} → ${removing ? 'Remove' : kg(draft.consumption_per_piece_kg)}`,
        ],
        [
          'Manual status',
          snapshot.statuses.find((s) => s.id === draft.item_part_fabric_status_id)?.type ??
            'Automatic',
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
        h(FabricRequirementFields, {
          prefix: 'planner-component',
          row: draft,
          options: {
            fabrics: snapshot.fabric_types.map((f) => [f.id, f.name]),
            parts: snapshot.sub_parts.map((p) => [p.id, p.part]),
            labs: snapshot.lab_dips.map((l) => [l.id, l.name]),
            statuses: snapshot.statuses.map((s) => [s.id, s.type]),
          },
          onChange: setDraft,
          disabled: !canEdit || Boolean(program),
        }),
        requirement &&
          h(
            'p',
            null,
            'Status: ',
            snapshot.statuses.find((s) => s.id === requirement.item_part_fabric_status_id)?.type,
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
              disabled: !fabric,
            },
            'Review consumption',
          ),
        canEdit &&
          !program &&
          requirement &&
          h('button', { type: 'submit', value: 'remove', formNoValidate: true }, 'Review removal'),
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
      (!variant || variant === row.variant) &&
      [
        row.style_code,
        row.colour,
        row.variant,
        row.part,
        ...(snapshot?.requirements || [])
          .filter((r) => r.variant_item_id === row.id)
          .map((r) => r.sub_part_name),
      ].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(debounced),
      ),
  );
  const visibleRequirements = (snapshot?.requirements || []).filter(
    (r) =>
      rows.some((v) => v.id === r.variant_item_id) &&
      (!debounced ||
        [
          r.sub_part_name,
          snapshot.sub_parts.find((p) => p.id === r.sub_part_list_id)?.part,
          ...Object.values(variants.find((v) => v.id === r.variant_item_id) || {}),
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(debounced),
        )) &&
      (!fabric || fabric === r.fabric_type_id) &&
      (!colour || snapshot.lab_dips.find((l) => l.id === r.lab_dip_id)?.colour === colour) &&
      (!program ||
        programItems.some(
          (p) => p.fabric_type_id === r.fabric_type_id && p.lab_dip_id === r.lab_dip_id,
        )),
  );
  const records = useMemo(
    () =>
      visibleRequirements.map((r) => {
        const row = variants.find((v) => v.id === r.variant_item_id);
        return {
          id: r.id,
          documentId: r.id,
          colour: snapshot.lab_dips.find((l) => l.id === r.lab_dip_id)?.colour ?? '',
          style: row.style_code,
          variant: row.variant,
          part: row.part,
          sub_part:
            r.sub_part_name ||
            snapshot.sub_parts.find((p) => p.id === r.sub_part_list_id)?.part ||
            'Unspecified',
          fabric: snapshot.fabric_types.find((f) => f.id === r.fabric_type_id)?.name ?? '',
          lab: snapshot.lab_dips.find((l) => l.id === r.lab_dip_id)?.name ?? '',
          status: snapshot.statuses.find((s) => s.id === r.item_part_fabric_status_id)?.type ?? '',
          orders: snapshot.links
            .filter((l) => l.item_part_fabric_id === r.id)
            .map((l) =>
              programLabel(
                snapshot.program_items.find(
                  (p) => p.dyeing_program_item_id === l.dyeing_program_item_id,
                ),
              ),
            )
            .join('; '),
          consumption: r.consumption_per_piece_kg,
          ...Object.fromEntries(measures.map(([key]) => [key, r[key]])),
        };
      }),
    [snapshot, debounced, item, colour, variant, fabric, program],
  );
  const columns = useMemo(
    () => [
      column('colour', 'Colour'),
      column('style', 'Style code'),
      column('variant', 'Variant'),
      column('part', 'Production part'),
      column('sub_part', 'Fabric sub-part'),
      column('fabric', 'Fabric type'),
      column('lab', 'Component lab dip'),
      column('status', 'Status'),
      column('orders', 'Linked orders'),
      column('consumption', 'kg / piece', true),
      ...measures.map(([key, label]) => column(key, label + ' kg', true)),
    ],
    [],
  );
  const spec = useMemo(() => ({ title: 'Fabric Planner', columns }), [columns]);
  const selectedRequirement = snapshot?.requirements.find((r) => r.id === selection);
  const record = variants.find((v) => v.id === selectedRequirement?.variant_item_id);
  const [addVariant, setAddVariant] = useState('');
  const editRow = open === 'new' ? variants.find((v) => v.id === addVariant) : record;
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
          onClick: () => setOpen('edit'),
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
        !program &&
          canEdit &&
          picker(
            'planner-add-variant',
            'Variant / production part',
            addVariant,
            rows.map((v) => [v.id, variantLabel(v)]),
            setAddVariant,
            'Choose variant / part',
          ),
        !program &&
          canEdit &&
          h(
            'button',
            { type: 'button', disabled: !addVariant, onClick: () => setOpen('new') },
            'Add fabric sub-part',
          ),
        picker('planner-item', 'Item', item, options('item_id', 'style_code'), setFilter(setItem)),
        picker(
          'planner-colour',
          'Colour',
          colour,
          [...new Set(snapshot.lab_dips.map((l) => l.colour))].sort().map((c) => [c, c]),
          setFilter(setColour),
        ),
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
    snapshot &&
      h(
        'div',
        { className: 'lab-record-table-wrap' },
        h(
          'table',
          null,
          h('caption', null, 'Totals for displayed fabric sub-parts · kg'),
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', { scope: 'col' }, 'Fabric type'),
              ...measures.map(([key, label]) => h('th', { scope: 'col', key }, label)),
            ),
          ),
          h(
            'tbody',
            null,
            snapshot.fabric_types
              .filter((f) => visibleRequirements.some((r) => r.fabric_type_id === f.id))
              .map((f) =>
                h(
                  'tr',
                  { key: f.id },
                  h('th', { scope: 'row' }, f.name),
                  ...measures.map(([key]) =>
                    h(
                      'td',
                      { key },
                      kg(
                        visibleRequirements
                          .filter((r) => r.fabric_type_id === f.id)
                          .reduce((sum, r) => sum + Number(r[key] || 0), 0),
                      ),
                    ),
                  ),
                ),
              ),
          ),
        ),
      ),
    snapshot &&
      h(
        'div',
        { className: 'lab-record-table-wrap' },
        h(
          'table',
          null,
          h('caption', null, 'Actual consumed kg · Variant + Fabric Type'),
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ...['Variant / production part', 'Fabric type', 'Consumed kg'].map((label) =>
                h('th', { key: label, scope: 'col' }, label),
              ),
            ),
          ),
          h(
            'tbody',
            null,
            snapshot.actual_consumption
              .filter(
                (r) =>
                  rows.some((v) => v.id === r.variant_item_id) &&
                  (!fabric || fabric === r.fabric_type_id),
              )
              .map((r) =>
                h(
                  'tr',
                  { key: r.variant_item_id + ':' + r.fabric_type_id },
                  h(
                    'th',
                    { scope: 'row' },
                    variantLabel(variants.find((v) => v.id === r.variant_item_id)),
                  ),
                  h('td', null, snapshot.fabric_types.find((f) => f.id === r.fabric_type_id)?.name),
                  h('td', null, kg(r.consumed_kg)),
                ),
              ),
          ),
        ),
      ),
    open &&
      editRow &&
      h(FabricPlanEdit, {
        client,
        snapshot,
        row: editRow,
        requirement: open === 'new' ? null : selectedRequirement,
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
