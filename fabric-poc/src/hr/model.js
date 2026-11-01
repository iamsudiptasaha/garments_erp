export const employeeFields = [
  ['date_of_joining', 'Date of joining', 'date'],
  ['date_of_birth', 'Date of birth', 'date'],
  ['gender_id', 'Gender', 'gender'],
  ['blood_group_id', 'Blood group', 'blood_group'],
  ['type_of_employment_id', 'Employment type', 'type_of_employment'],
  ['employee_photo', 'Photo reference', 'text'],
  ['supporting_document_1_title', 'Document 1 title', 'text'],
  ['supporting_document_2_title', 'Document 2 title', 'text'],
];
export const employeeReferences = {
  gender: 'Gender',
  blood_group: 'Blood groups',
  type_of_employment: 'Employment types',
};
export const hrPages = {
  employees: { title: 'Employees', table: 'employees' },
  employeeGender: { title: 'Gender', table: 'gender' },
  employeeBloodGroups: { title: 'Blood groups', table: 'blood_group' },
  employeeEmploymentTypes: { title: 'Employment types', table: 'type_of_employment' },
};
export const employeeLinks = [
  { key: 'contacts_id', label: 'Employee contact', source: 'contacts', required: true },
  {
    key: 'contact_purpose_id',
    label: 'Contact purpose',
    source: 'contact_purpose',
    required: true,
  },
  { key: 'contacts_emergency_id', label: 'Emergency contact', source: 'contacts', required: false },
  {
    key: 'contact_purpose_emergency_id',
    label: 'Emergency contact purpose',
    source: 'contact_purpose',
    required: false,
  },
];
export const employeeRelations = {
  employee: [
    ...employeeLinks.map((x) => x.key),
    'verified_by_employee_id',
    ...employeeFields.map(([key]) => key),
  ],
};
export function employeeDraft(record) {
  return {
    employee: Object.fromEntries(
      [...employeeFields.map(([key]) => key), ...employeeLinks.map((x) => x.key)].map((key) => [
        key,
        record?.employee[key] ?? '',
      ]),
    ),
  };
}
export function validateEmployeeDraft(draft) {
  for (const link of employeeLinks)
    if (link.required && !draft.employee[link.key])
      throw Error('Select ' + link.label.toLowerCase() + '.');
  if (draft.employee.contact_purpose_emergency_id && !draft.employee.contacts_emergency_id)
    throw Error('Select an emergency contact before its purpose.');
  if (
    draft.employee.date_of_birth &&
    draft.employee.date_of_birth > new Date().toISOString().slice(0, 10)
  )
    throw Error('Date of birth cannot be in the future.');
}
export function employeeRows(records, query = '') {
  return records
    .map((record) => ({
      id: record.employee.id,
      name: record.contact.company_name || 'Name not set',
      code: record.employee.employee_code,
      phone: record.contacts
        .map((c) => c.phone)
        .filter(Boolean)
        .join(', '),
      joined: record.employee.date_of_joining || '',
      verified: record.verifier_name || 'Not verified',
      updated: record.employee.updated_at || '',
      record,
    }))
    .filter((r) =>
      [r.name, r.code, r.phone].some((x) => x.toLowerCase().includes(query.toLowerCase())),
    );
}
