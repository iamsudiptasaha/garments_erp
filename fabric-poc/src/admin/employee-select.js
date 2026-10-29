import React from 'react';
import Select from 'react-select';
const h = React.createElement;
export function EmployeeSelect({
  employees,
  value,
  onChange,
  disabled = false,
  label = 'Select employee',
}) {
  const options = employees.map((e) => ({
    value: e.id,
    label: `${e.name || 'Name not set'} · ${e.code || 'Code not set'}`,
    employee: e,
  }));
  return h(
    'div',
    { className: 'employee-picker' },
    h('label', { htmlFor: 'role-employee-select' }, label),
    h(Select, {
      inputId: 'role-employee-select',
      instanceId: 'role-employee-select',
      classNamePrefix: 'employee-select',
      options,
      value: options.find((o) => o.value === value) || null,
      onChange: (o) => onChange(o?.value || null),
      isDisabled: disabled,
      isSearchable: true,
      isClearable: true,
      isMulti: false,
      placeholder: 'Choose an employee…',
      noOptionsMessage: () => 'No matching employees',
      filterOption: (option, input) =>
        [option.data.employee.name, option.data.employee.code, option.data.employee.phone].some(
          (v) =>
            String(v || '')
              .toLowerCase()
              .includes(input.trim().toLowerCase()),
        ),
      formatOptionLabel: (option) =>
        h(
          'div',
          { className: 'employee-option' },
          h('strong', null, option.employee.name || 'Name not set'),
          h('small', null, option.employee.code || 'Employee code not set'),
        ),
      styles: {
        menu: (base) => ({ ...base, zIndex: 20 }),
        control: (base) => ({ ...base, minHeight: 46, borderColor: '#cbdfea', boxShadow: 'none' }),
        option: (base, state) => ({
          ...base,
          backgroundColor: state.isSelected ? '#dceefd' : state.isFocused ? '#eff7fd' : 'white',
          color: '#294457',
        }),
      },
    }),
  );
}
