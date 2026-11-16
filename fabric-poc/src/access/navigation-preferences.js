import { useLayoutEffect, useRef } from 'react';
import { useGridPreferences, waitForGridPreferences } from '../fabric/grid-preferences.js';

const preferenceKey = 'workspace-navigation';

export function useNavigationPreferences(client, root) {
  const { owner, ready, preferences, save, error } = useGridPreferences(client, preferenceKey);
  const defaults = useRef(new WeakMap());
  const pending = useRef({ owner, patch: {} });

  useLayoutEffect(() => {
    const sidebar = root.current;
    if (!client || !sidebar) return;
    if (pending.current.owner !== owner) pending.current = { owner, patch: {} };

    for (const section of sidebar.querySelectorAll('details[data-nav-section]')) {
      if (section.dataset.dismissed === 'true') continue;
      if (!defaults.current.has(section)) defaults.current.set(section, section.open);
      const key = section.dataset.navSection;
      const saved = pending.current.patch[key] ?? preferences[key];
      section.open = typeof saved === 'boolean' ? saved : defaults.current.get(section);
    }

    if (ready && Object.keys(pending.current.patch).length) {
      const patch = pending.current.patch;
      pending.current.patch = {};
      save(patch);
    }

    function toggle(event) {
      const summary = event.target instanceof Element ? event.target.closest('summary') : null;
      const section = summary?.parentElement;
      if (
        event.defaultPrevented ||
        !section?.matches('details[data-nav-section]') ||
        section.firstElementChild !== summary
      )
        return;
      event.preventDefault();
      delete section.dataset.dismissed;
      section.open = !section.open;
      const key = section.dataset.navSection;
      if (ready) save({ [key]: section.open });
      else if (owner) pending.current.patch[key] = section.open;
    }

    sidebar.addEventListener('click', toggle);
    return () => sidebar.removeEventListener('click', toggle);
  });

  return error && error.replace('Grid preferences', 'Navigation preferences');
}

export function flushNavigationPreferences(client) {
  return client.auth
    .getSession()
    .then(({ data }) => waitForGridPreferences(data.session?.user.id, preferenceKey));
}
