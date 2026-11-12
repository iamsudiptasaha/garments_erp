import React, { useEffect, useRef, useState } from 'react';
import { getAccessClient } from './client.js';
import { liveFileCommands } from '../files/live.js';
import { PasswordSettings } from './security.js';

const h = React.createElement;

async function rpc(name, args) {
  const { data, error } = await getAccessClient().rpc(name, args);
  if (error) throw error;
  return data;
}

export function MyProfile() {
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState({ name: '', phone: '' });
  const [photo, setPhoto] = useState('');
  const [source, setSource] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState([0, 0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const canvas = useRef(null);
  const drag = useRef(null);
  const files = () => liveFileCommands(getAccessClient());

  async function reload() {
    const row = await rpc('erp_my_profile');
    setProfile(row);
    setDraft({ name: row?.name || '', phone: row?.phone || '' });
    setPhoto('');
    if (row?.photo) {
      try {
        setPhoto((await files().open(row.photo)).url);
      } catch (e) {
        setError(e.message);
      }
    }
    window.dispatchEvent(
      new CustomEvent('erp-profile-updated', {
        detail: row && { name: row.name, photo: row.photo },
      }),
    );
  }

  useEffect(() => {
    reload()
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!source || !canvas.current) return;
    const context = canvas.current.getContext('2d');
    const scale = (384 * zoom) / Math.min(source.width, source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    context.fillStyle = 'white';
    context.fillRect(0, 0, 384, 384);
    context.drawImage(
      source,
      ((384 - width) * (1 - position[0])) / 2,
      ((384 - height) * (1 - position[1])) / 2,
      width,
      height,
    );
  }, [source, zoom, position]);

  async function perform(operation) {
    setError('');
    setBusy(true);
    try {
      await operation();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    await perform(async () => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10485760)
        throw Error('Choose a JPEG, PNG or WebP image up to 10 MB.');
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 40000000) {
        bitmap.close();
        throw Error('Choose an image under 40 megapixels.');
      }
      source?.close();
      setSource(bitmap);
      setZoom(1);
      setPosition([0, 0]);
    });
  }

  function closeCrop() {
    source?.close();
    setSource(null);
  }

  function savePhoto() {
    return perform(async () => {
      const blob = await new Promise((resolve) =>
        canvas.current.toBlob(resolve, 'image/jpeg', 0.86),
      );
      if (!blob) throw Error('The photo could not be prepared.');
      await files().upload(
        'employeePhoto',
        profile.employeeId,
        new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' }),
      );
      closeCrop();
      await reload();
    });
  }

  if (!profile)
    return h(
      'p',
      { role: error ? 'alert' : 'status' },
      error || (loaded ? 'My Profile is unavailable.' : 'Loading profile…'),
    );

  return h(
    'section',
    { className: 'admin-personal-settings fabric-line profile-settings' },
    error && h('p', { role: 'alert', className: 'form-error' }, error),
    h('h2', null, 'Personal details'),
    h(
      'form',
      {
        className: 'profile-details-form',
        onSubmit: (event) => {
          event.preventDefault();
          perform(async () => {
            await rpc('erp_save_my_profile', { p_name: draft.name, p_phone: draft.phone });
            await reload();
          });
        },
      },
      h(
        'label',
        null,
        'Name',
        h('input', {
          required: true,
          maxLength: 160,
          autoComplete: 'name',
          value: draft.name,
          onChange: (event) => setDraft({ ...draft, name: event.target.value }),
        }),
      ),
      h(
        'label',
        null,
        'Primary phone',
        h('input', {
          type: 'tel',
          maxLength: 32,
          autoComplete: 'tel',
          value: draft.phone,
          onChange: (event) => setDraft({ ...draft, phone: event.target.value }),
        }),
      ),
      h(
        'button',
        { className: 'primary', disabled: busy, type: 'submit' },
        'Save personal details',
      ),
    ),
    h(
      'dl',
      { className: 'admin-details' },
      h('dt', null, 'Login email'),
      h('dd', null, profile.email),
      h('dt', null, 'Roles'),
      h('dd', null, (profile.roles || []).join(', ') || 'No roles assigned'),
    ),
    h('h2', null, 'Profile photo'),
    photo && h('img', { className: 'profile-avatar', src: photo, alt: 'Profile photo' }),
    h(
      'label',
      null,
      profile.photo ? 'Replace photo' : 'Upload photo',
      h('input', {
        type: 'file',
        accept: 'image/jpeg,image/png,image/webp',
        disabled: busy,
        onChange: choosePhoto,
      }),
    ),
    profile.photo &&
      !source &&
      h(
        'button',
        {
          type: 'button',
          disabled: busy,
          onClick: () =>
            perform(async () => {
              await rpc('erp_remove_my_photo', { p_expected: profile.photo });
              await reload();
            }),
        },
        'Remove photo',
      ),
    source &&
      h(
        'div',
        { className: 'profile-crop-controls' },
        h('canvas', {
          ref: canvas,
          className: 'profile-avatar profile-crop',
          width: 384,
          height: 384,
          'aria-label': 'Circular crop preview',
          onPointerDown: (event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = [event.clientX, event.clientY];
          },
          onPointerMove: (event) => {
            if (!drag.current) return;
            const movement = [event.clientX - drag.current[0], event.clientY - drag.current[1]];
            drag.current = [event.clientX, event.clientY];
            setPosition((old) =>
              old.map((value, index) => Math.max(-1, Math.min(1, value + movement[index] / 64))),
            );
          },
          onLostPointerCapture: () => {
            drag.current = null;
          },
        }),
        h(
          'label',
          null,
          'Zoom',
          h('input', {
            type: 'range',
            min: 1,
            max: 3,
            step: 0.05,
            value: zoom,
            onChange: (event) => setZoom(Number(event.target.value)),
          }),
        ),
        h(
          'div',
          { className: 'profile-crop-actions' },
          h(
            'button',
            { className: 'primary', type: 'button', disabled: busy, onClick: savePhoto },
            'Save photo',
          ),
          h('button', { type: 'button', disabled: busy, onClick: closeCrop }, 'Cancel crop'),
        ),
      ),
    h('h2', null, 'Sign-in settings'),
    h(PasswordSettings),
    h('p', null, 'Authenticator app verification is active.'),
  );
}
