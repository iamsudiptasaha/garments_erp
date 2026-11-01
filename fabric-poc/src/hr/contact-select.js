import React from 'react';
import Select from 'react-select';
const h = React.createElement;
export function ContactSelect({ link, records, value, onChange, disabled }) {
  const id = 'employee-' + link.key;
  const options = records.map((r) => ({ value: r.id, label: r.company_name || 'Contact ' + r.id }));
  return h(
    'div',
    { className: 'employee-picker' },
    h('label', { htmlFor: id }, link.label),
    h(Select, {
      inputId: id,
      instanceId: id,
      options,
      value: options.find((o) => o.value === value) || null,
      onChange: (o) => onChange(o?.value || ''),
      isDisabled: disabled,
      isSearchable: true,
      menuPlacement: 'auto',
      maxMenuHeight: 200,
      isClearable: !link.required,
      placeholder: 'Select a contact…',
      classNamePrefix: 'employee-select',
      noOptionsMessage: () => 'No matching contacts',
    }),
  );
}
