import { getAccessClient } from '../access/client.js';
import { liveFileCommands } from '../files/live.js';

export function challanDocuments(client = getAccessClient()) {
  const files = liveFileCommands(client);
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw Error(error.message);
    return data;
  }
  return {
    async authenticate() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return Boolean(data.session);
    },
    async read(billing) {
      const data = await rpc('erp_challan_documents', { p_billing: billing });
      const sortSizes = (sizes) => data.sizeOrder.filter((size) => sizes.includes(size));
      const jobs = Object.fromEntries(
        data.assignments.map((a) => [
          a.id,
          [
            a.style + ' · ' + a.part,
            a.stage,
            a.worker,
            [a.variant],
            sortSizes(Object.keys(a.stock)),
            a.job,
          ],
        ]),
      );
      const stockIn = Object.fromEntries(
        data.assignments.map((a) => [a.id, { [a.variant]: a.stock }]),
      );
      const workers = [
        ...new Map(data.assignments.filter((a) => a.worker).map((a) => [a.worker, a.worker_name])),
      ];
      const employeeNames = new Map(data.employees.map((e) => [e.id, e.name]));
      const challansByLine = new Map();
      const records = data.challans.map((ch) => {
        const lines = ch.lines.map((l) => {
          const job = jobs[l.assignment];
          const variant = job[3][0];
          job[4] = sortSizes([...job[4], ...Object.keys(l.quantities)]);
          challansByLine.set(l.id, ch.key);
          return {
            ...l,
            job: l.assignment,
            part: job[0],
            variant,
            cells: { [variant]: l.quantities },
          };
        });
        return {
          ...ch,
          lines,
          worker: jobs[lines[0]?.job]?.[2] || '',
          employeeName: employeeNames.get(ch.employee) || '',
        };
      });
      const bills = data.bills.map((b) => ({
        ...b,
        items: b.items.map((item) => ({ ...item, challan: challansByLine.get(item.line) })),
      }));
      return {
        jobs,
        stockIn,
        workers,
        employees: data.employees.map((e) => [e.id, e.name]),
        records,
        bills,
        permissions: data.permissions,
        pages: data.pages,
      };
    },
    save(billing, action, document) {
      return rpc('erp_save_challan_document', {
        p_billing: billing,
        p_action: action,
        p_document: document,
      });
    },
    async attach(recordId, file) {
      const [registry, routes] = await Promise.all([files.registry(), files.routes()]);
      await files.store(registry, routes).attach({ targetKey: 'workerBill', recordId, file });
    },
    openAttachment: (attachment) => files.store([]).open(attachment),
  };
}
