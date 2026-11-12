import React, { useEffect, useState } from 'react';
import { getAccessClient } from '../access/client.js';
import { liveFileCommands } from '../files/live.js';

const h = React.createElement;

export function EmployeeAvatar({ name, photoId, className }) {
  const [image, setImage] = useState(null);
  useEffect(() => {
    if (!photoId) return;
    let active = true;
    Promise.resolve()
      .then(() => liveFileCommands(getAccessClient()).open(photoId))
      .then(({ url }) => {
        if (active) setImage({ photoId, url });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [photoId]);
  const initials = (name || 'Employee')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return h(
    'span',
    { className: className + ' employee-avatar', 'aria-hidden': true },
    image && image.photoId === photoId
      ? h('img', { src: image.url, alt: '', onError: () => setImage(null) })
      : initials,
  );
}
