import { PrivateImageButton } from '../files/record-attachments.js';
import React, { useEffect, useRef, useState } from 'react';
import { labLabels, versionsFor, statusFor, labClosed } from './domain.js';
import './styles.css';
const h = React.createElement;
const fmt = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Not recorded';
function ProgressDialog({ children, onClose, title }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return h(
    'dialog',
    { ref: dialog, className: 'fabric-dialog lab-progress-dialog', onCancel: onClose },
    h(
      'div',
      { className: 'editor-heading' },
      h('h2', null, title),
      h('button', { onClick: onClose }, 'Close'),
    ),
    children,
  );
}
function Edition({ data, lab, onEdit, editable, creatable, index }) {
  const versions = versionsFor(data, lab.id),
    latest = versions.at(-1),
    labels = labLabels(data, lab),
    status = statusFor(data, latest),
    closed = labClosed(data, lab.id),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState(null),
    detail = versions.find((v) => v.id === selected) || latest,
    reviews = (data.lab_dip_version_item || []).filter(
      (review) => review.lab_dip_version_id === detail?.id,
    );
  const edit = (mode) => {
    setOpen(false);
    onEdit(lab.id, mode);
  };
  return h(
    React.Fragment,
    null,
    h(
      'article',
      { className: `overview-card tone-${index % 4} lab-card` },
      h(
        'button',
        { className: 'lab-card-open', onClick: () => setOpen(true), 'aria-haspopup': 'dialog' },
        h(
          'div',
          { className: 'card-top' },
          h('span', { className: 'card-kicker' }, `LAB DIP · EDITION ${lab.edition}`),
          h('span', { className: 'card-dots', 'aria-hidden': true }, '•••'),
        ),
        h('h2', null, labels.name),
        h('p', { className: 'card-subtitle' }, `${labels.brand} · ${labels.dyer}`),
        h(
          'span',
          { className: 'lab-status ' + (closed ? 'accepted' : '') },
          status
            ? latest.version > 1 && status.sort_order <= 3
              ? `Redo ${latest.version} · ${status.status}`
              : status.status
            : 'Status not recorded',
        ),
        h(
          'p',
          { className: 'lab-card-hint' },
          `Version ${latest?.version || '—'} · View progress →`,
        ),
      ),
    ),
    open &&
      h(
        ProgressDialog,
        { title: `${labels.name} · Edition ${lab.edition}`, onClose: () => setOpen(false) },
        h(
          'div',
          { className: 'lab-expanded' },
          h(
            'div',
            { className: 'lab-map', 'aria-label': 'Version progress' },
            versions.map((v, i) => {
              const s = statusFor(data, v),
                order = s?.sort_order;
              return h(
                React.Fragment,
                { key: v.id },
                i > 0 && h('p', { className: 'lab-redo' }, '↳ New attempt'),
                h(
                  'div',
                  { className: 'lab-version-row' },
                  h('strong', null, `Version ${v.version}`),
                  h(
                    'div',
                    { className: 'lab-path' },
                    !s
                      ? h('button', { onClick: () => setSelected(v.id) }, 'Status not recorded')
                      : h(
                          React.Fragment,
                          null,
                          h(
                            'span',
                            {
                              hidden: order === 4,
                              className: 'lab-node ' + (order === 1 ? 'current' : ''),
                            },
                            order > 1 ? '✓ At Dyer' : '● At Dyer',
                          ),
                          h('span', { 'aria-hidden': true, hidden: order === 4 }, '→'),
                          h(
                            'span',
                            {
                              hidden: order === 4,
                              className: 'lab-node ' + (order === 2 ? 'current' : ''),
                            },
                            order === 4
                              ? 'Buyer review not required'
                              : order > 2
                                ? '✓ Buyer review'
                                : order === 2
                                  ? '● Awaiting buyer comments'
                                  : 'Buyer review',
                          ),
                          h('span', { 'aria-hidden': true, hidden: order === 4 }, '→'),
                          h(
                            'span',
                            {
                              className:
                                'lab-node ' +
                                (order === 3 ? 'failed' : order >= 4 ? 'accepted' : 'future'),
                            },
                            order === 3 ? '× Failed' : order >= 4 ? '✓ ' + s.status : 'Accepted',
                          ),
                        ),
                    h(
                      'button',
                      { 'aria-pressed': detail?.id === v.id, onClick: () => setSelected(v.id) },
                      'Details',
                    ),
                  ),
                ),
              );
            }),
          ),
          detail &&
            h(
              'section',
              { className: 'lab-detail', 'aria-live': 'polite' },
              h(
                'h3',
                null,
                `Version ${detail.version} · ${statusFor(data, detail)?.status || 'Status not recorded'}`,
              ),
              h(
                'dl',
                { className: 'lab-submission-fields' },
                [
                  ['Shade Card No.', detail.shade_card_no],
                  ['Shade Card Option', detail.shade_card_option],
                ].map(([label, value]) =>
                  h(
                    'div',
                    { key: label },
                    h('dt', null, label),
                    h('dd', null, value || 'Not recorded'),
                  ),
                ),
              ),
              h('h4', null, 'Shade Card Attachment'),
              h(
                'p',
                null,
                detail.shade_card_image_attachment
                  ? data.attachments.find((a) => a.id === detail.shade_card_image_attachment)
                      ?.filename || 'Attached'
                  : 'Not attached',
              ),
              data._live &&
                detail.shade_card_image_attachment &&
                h(
                  PrivateImageButton,
                  {
                    targetKey: 'labDipShade',
                    recordId: detail.id,
                    attachmentId: detail.shade_card_image_attachment,
                  },
                  'Open shade-card image',
                ),
              h(
                'small',
                null,
                `Recorded: ${fmt(detail.created_at)} · Last updated: ${fmt(detail.updated_at)}`,
              ),
              h('h4', null, 'Status history'),
              reviews.length
                ? h(
                    'ol',
                    { className: 'lab-review-timeline' },
                    reviews.map((review) => {
                      const decision = data.lab_dip_version_status.find(
                          (entry) => entry.id === review.lab_dip_status_id,
                        ),
                        order = decision?.sort_order;
                      return h(
                        'li',
                        { key: review.id },
                        h(
                          'time',
                          { dateTime: review.date || review.recorded_at },
                          review.date ||
                            (review.recorded_at
                              ? `Recorded ${fmt(review.recorded_at)}`
                              : 'Date not recorded'),
                        ),
                        h(
                          'span',
                          {
                            className:
                              'lab-node ' +
                              (order === 3 ? 'failed' : order >= 4 ? 'accepted' : 'current'),
                          },
                          `Version ${detail.version} · ${decision?.status || 'Status not recorded'}`,
                        ),
                        review.comments && h('p', null, 'Comments: ', review.comments),
                      );
                    }),
                  )
                : h('p', null, 'No review history recorded for this version.'),
            ),
          h(
            'div',
            { className: 'lab-actions' },
            closed
              ? h(
                  React.Fragment,
                  null,
                  h('small', null, 'Completed edition · reusable'),
                  creatable && h('button', { onClick: () => edit('edition') }, '+ New edition'),
                )
              : h(
                  React.Fragment,
                  null,
                  editable &&
                    h(
                      'button',
                      { onClick: () => edit('update') },
                      `Update version ${latest?.version || 1}`,
                    ),
                  editable &&
                    h(
                      'button',
                      { disabled: status?.sort_order !== 3, onClick: () => edit('version') },
                      '+ Add version',
                    ),
                  editable &&
                    status?.sort_order !== 3 &&
                    h('small', null, 'The latest version must be Failed to add another.'),
                ),
          ),
        ),
      ),
  );
}
export function LabOverview({ data, records, onEdit, editable, creatable }) {
  return h(
    'section',
    { className: 'overview-grid lab-cards' },
    records.map((r, index) =>
      h(Edition, {
        key: r.id,
        index,
        lab: data.lab_dip.find((l) => l.id === r.id),
        data,
        onEdit,
        editable,
        creatable,
      }),
    ),
  );
}
