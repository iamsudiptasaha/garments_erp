import { FILE_TARGETS, validateRecordId, validateFile, resolveGroup } from './model.js';
export function liveFileCommands(client) {
  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc('erp_' + name, args);
    if (error) throw Error(error.message);
    return data;
  }
  async function invoke(body) {
    const { data, error } = await client.functions.invoke('erp-files', { body });
    if (error) {
      let message = error.message;
      try {
        message = (await error.context.json()).error || message;
      } catch {
        /* A network failure may have no JSON body. */
      }
      throw Error(message);
    }
    if (data?.error) throw Error(data.error);
    return data;
  }
  return {
    registry: () => rpc('file_registry'),
    routes: async () => {
      const rows = await rpc('file_routes');
      return rows.map((r) => ({
        ...r,
        label: FILE_TARGETS.find((t) => t.key === r.key)?.label || `${r.table} / ${r.slot}`,
      }));
    },
    saveRoute: (input) => rpc('save_file_route', input),
    records: (targetKey, query) => rpc('file_records', { p_key: targetKey, p_query: query }),
    saveGroup: (input) => rpc('save_bucket_group', input),
    createGroup: (input) =>
      rpc('create_bucket_group', {
        p_group: input.group,
        p_description: input.description,
        p_mimes: input.mime,
        p_max_bytes: input.max_bytes,
      }),
    removeGroup: (group, confirmation) =>
      invoke({ action: 'removeBucket', groupId: group.id, version: group.version, confirmation }),
    cleanup: () => invoke({ action: 'cleanup' }),
    store: (registry, routes = FILE_TARGETS) => ({
      mode: 'supabase',
      list: (key, id) => rpc('file_list', { p_key: key, p_record_id: validateRecordId(id, true) }),
      async attach({ targetKey, recordId, file }) {
        const target = routes.find((r) => r.key === targetKey);
        if (!target || target.enabled === false)
          throw Error('Uploads are disabled for this field.');
        validateRecordId(recordId, true);
        validateFile(file, target, {
          ...resolveGroup(registry, target.group),
          max_bytes: Math.min(
            resolveGroup(registry, target.group).max_bytes,
            target.max_bytes || 10485760,
          ),
        });
        const body = new FormData();
        body.append('targetKey', targetKey);
        body.append('recordId', recordId);
        body.append('file', file);
        return invoke(body);
      },
      open: (attachment) => invoke({ action: 'read', attachmentId: String(attachment.id) }),
    }),
  };
}
