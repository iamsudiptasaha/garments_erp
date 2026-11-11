import { useEffect, useRef, useState } from 'react';

const pending = new Map();
const empty = {};

async function request(client, page, owner, patch = null) {
  const { data, error } = await client.rpc('erp_grid_preferences', {
    p_grid: page,
    p_owner: owner,
    p_patch: patch,
  });
  if (error) throw Error(error.message);
  return data;
}

export function useGridPreferences(client, page, defaults = empty) {
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  const [owner, setOwner] = useState(undefined);
  const current = useRef(null);
  const storageKey = 'garments-grid-v1:' + page;

  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setOwner(session?.user.id ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  useEffect(() => {
    let active = true;
    current.current = null;
    setSaved(null);
    setError('');
    if (client && owner === undefined) return;

    async function load() {
      let entry;
      try {
        if (client) {
          if (!owner) throw Error('No authenticated session');
          const queueKey = owner + ':' + page;
          await pending.get(queueKey);
          entry = { owner, queueKey, value: (await request(client, page, owner)) ?? {} };
        } else {
          entry = { value: JSON.parse(localStorage.getItem(storageKey) || '{}') };
        }
      } catch {
        entry = { owner, value: {} };
        if (active) setError('Grid preferences could not be loaded.');
      }
      if (active) {
        current.current = entry;
        setSaved({ owner, page, value: entry.value });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [client, owner, page, storageKey]);

  function save(patch) {
    const entry = current.current;
    if (!entry || entry.owner !== owner) return;
    const value = { ...entry.value, ...patch };
    if (JSON.stringify(value) === JSON.stringify(entry.value)) return;
    entry.value = value;
    setSaved({ owner, page, value });
    if (!client) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        setError('Grid preferences could not be saved.');
      }
      return;
    }
    if (!entry.queueKey) return;
    const previous = pending.get(entry.queueKey);
    const next = Promise.resolve(previous)
      .then(async () => {
        entry.unsaved = { ...entry.unsaved, ...patch };
        await request(client, page, entry.owner, entry.unsaved);
        entry.unsaved = null;
      })
      .then(() => {
        if (current.current === entry) setError('');
      })
      .catch(() => {
        if (current.current === entry) setError('Grid preferences could not be saved.');
      })
      .finally(() => {
        if (pending.get(entry.queueKey) === next) pending.delete(entry.queueKey);
      });
    pending.set(entry.queueKey, next);
  }

  const ready = saved?.owner === owner && saved?.page === page;
  return {
    ready,
    preferences: ready ? { ...defaults, ...saved.value } : defaults,
    save,
    error,
  };
}
