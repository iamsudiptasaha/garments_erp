import React, { useId } from 'react';
import Select from 'react-select';
import { latestStatusItem, statusFor } from '../colours/domain.js';
import { programContext, previousBatchLabel, versionsForMapping } from './relationships.js';
const h = React.createElement;
function labDetails(data, versionId) {
  const { version, lab, mappingId } = programContext(data, { lab_dip_version_id: versionId }),
    mapping = data.color_map_by_brand.find((r) => r.id === mappingId),
    colour = data.color_map.find((r) => r.id === mapping?.color_map_id),
    brand = data.brand_list.find((r) => r.id === mapping?.brand_list_id),
    dyer = data.dyer.find((r) => r.id === lab?.dyer_id),
    contact = data.contacts.find((r) => r.id === dyer?.contacts_id),
    review = latestStatusItem(data, version);
  return {
    name: [colour?.name, brand?.brand, contact?.company_name].filter(Boolean).join(' · '),
    details: version
      ? `Edition ${lab.edition} · Version ${version.version} · ${statusFor(data, version)?.status || 'Status not recorded'} · ${review?.date || 'Review date not recorded'} · ${version.attached_swatch ? 'Attached swatch' : [version.shade_card_no, version.shade_card_option].filter(Boolean).join(' / ') || 'Shade not recorded'}`
      : 'Lab dip unavailable',
  };
}
export function labOptions(data, mappingId, dyerId) {
  return versionsForMapping(data, mappingId, dyerId).map((v) => {
    const details = labDetails(data, v.id);
    return { value: v.id, label: `${details.name} · ${details.details}`, ...details };
  });
}
export function programOptions(data) {
  return data.dyeing_program_item.map((line) => {
    const program = data.dyeing_program.find((r) => r.id === line.dyeing_program_id),
      fabric = data.fabric_type.find((r) => r.id === line.fabric_type_id),
      lab = labDetails(data, line.lab_dip_version_id),
      name = `${program?.program_number || 'Program'} · ${fabric?.name || 'Fabric'} · ${lab.name}`,
      lineNumber =
        data.dyeing_program_item
          .filter((r) => r.dyeing_program_id === line.dyeing_program_id)
          .findIndex((r) => r.id === line.id) + 1,
      details = `${lab.details} · Previous batch ${previousBatchLabel(data, line.batch_no)} · ${line.quantity ?? 'Unknown'} kg · Program line ${lineNumber}`;
    return { value: line.id, label: `${name} · ${details}`, name, details };
  });
}
export function RecordSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  clearable = false,
  placeholder = 'Type a name to find a record…',
}) {
  const id = useId();
  return h(
    'div',
    { className: 'fabric-record-picker' },
    h('label', { htmlFor: id }, label),
    h(Select, {
      inputId: id,
      instanceId: id,
      options,
      value: options.find((o) => o.value === value) || null,
      onChange: (o) => onChange(o?.value || ''),
      isDisabled: disabled,
      isClearable: clearable,
      isSearchable: true,
      placeholder,
      menuPlacement: 'auto',
      maxMenuHeight: 300,
      classNamePrefix: 'fabric-record',
      noOptionsMessage: () => 'No matching records',
      formatOptionLabel: (o) =>
        h(
          'div',
          null,
          h('strong', null, o.name || o.label),
          o.details && h('small', { className: 'fabric-record-details' }, o.details),
        ),
    }),
  );
}
