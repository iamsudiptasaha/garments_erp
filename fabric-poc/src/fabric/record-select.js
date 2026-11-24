import React, { useId, useRef, useLayoutEffect, useState } from 'react';
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
      lab = labDetails(data, programContext(data, line).version?.id),
      name = `${program?.program_number || 'Program'} · ${fabric?.name || 'Fabric'} · ${lab.name}`,
      lineNumber =
        data.dyeing_program_item
          .filter((r) => r.dyeing_program_id === line.dyeing_program_id)
          .findIndex((r) => r.id === line.id) + 1,
      details = `${lab.details} · Batch No. ${previousBatchLabel(data, programContext(data, line).group?.batch_no)} · ${line.quantity ?? 'Unknown'} kg · Program line ${lineNumber}`;
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
  const picker = useRef(null);
  const [portalTarget, setPortalTarget] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menu, setMenu] = useState({ placement: 'auto', height: 300 });
  useLayoutEffect(() => {
    // A body portal is behind a modal's top layer and inert. Keep the menu in
    // its owning dialog, but fixed to the viewport to escape overflow clipping.
    setPortalTarget(picker.current.closest('dialog') || document.body);
  }, []);
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const control = picker.current.querySelector('.fabric-record__control');
    const viewport = window.visualViewport;
    const update = () => {
      const rect = control.getBoundingClientRect();
      const top = viewport?.offsetTop || 0;
      const above = rect.top - top;
      const below = top + (viewport?.height || window.innerHeight) - rect.bottom;
      const placement = below >= Math.min(300, above) ? 'bottom' : 'top';
      // Allow for menu margins and MenuList padding as well as option content.
      const height = Math.max(1, Math.min(300, (placement === 'bottom' ? below : above) - 16));
      setMenu((old) =>
        old.placement === placement && old.height === height ? old : { placement, height },
      );
    };
    update();
    document.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    const observer = new ResizeObserver(update);
    observer.observe(control);
    return () => {
      document.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [menuOpen]);
  return h(
    'div',
    { className: 'fabric-record-picker', ref: picker },
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
      menuPortalTarget: portalTarget,
      menuPosition: 'fixed',
      menuShouldScrollIntoView: false,
      styles: { menuPortal: (base) => ({ ...base, zIndex: 20 }) },
      onMenuOpen: () => setMenuOpen(true),
      onMenuClose: () => setMenuOpen(false),
      menuPlacement: menu.placement,
      minMenuHeight: Math.min(140, menu.height),
      maxMenuHeight: menu.height,
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
