import { latestStatusItem, statusFor } from '../colours/domain.js';
import React from 'react';
import { RecordSelect, labOptions } from './record-select.js';
import { versionsForMapping } from './relationships.js';
const h = React.createElement;
export function labRecordRows(data, mappingId, dyerId) {
  return versionsForMapping(data, mappingId, dyerId).map((v) => {
    const lab = data.lab_dip.find((l) => l.id === v.lab_dip_id),
      status = statusFor(data, v),
      swatch = Boolean(v.attached_swatch);
    return {
      id: v.id,
      edition: lab.edition,
      version: v.version,
      date: latestStatusItem(data, v)?.date || null,
      shade: swatch ? null : v.shade_card_no || null,
      option: swatch ? null : v.shade_card_option || null,
      status: status?.status || 'Status not recorded',
    };
  });
}
export function LabRecordSelect({
  data,
  mappingId,
  dyerId,
  value,
  onChange,
  editionId,
  disabled = false,
  label = 'Lab dip',
}) {
  return h(RecordSelect, {
    label,
    options: labOptions(data, mappingId, dyerId).filter(
      (o) =>
        !editionId || data.lab_dip_version.find((v) => v.id === o.value)?.lab_dip_id === editionId,
    ),
    value,
    onChange,
    disabled: disabled || !mappingId || !dyerId,
  });
}
