import pg from 'pg';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import '../../scripts/ci/assert-test-db.mjs';
const clients = await Promise.all(
  [1, 2, 3].map(async () => {
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();
    return client;
  }),
);
const [first, second, observer] = clients;
const ids = [];
try {
  for (const [table, flag] of [
    ['contact_items', 'primary_address'],
    ['contact_items', 'primary_phone'],
    ['contact_bank_account', 'primary_bank_account'],
  ]) {
    const {
      rows: [contact],
    } = await observer.query(
      "insert into garments_erp.contacts(company_name) values ('Synthetic concurrent primary fixture') returning id",
    );
    ids.push(contact.id);
    await first.query('begin');
    await second.query('begin');
    await second.query("set local statement_timeout='5s'");
    await first.query(`insert into garments_erp.${table}(contact_id,${flag}) values($1,true)`, [
      contact.id,
    ]);
    // Capture rejection immediately: the competing insert waits on the unique index.
    const competing = second
      .query(`insert into garments_erp.${table}(contact_id,${flag}) values($1,true)`, [contact.id])
      .then(
        () => null,
        (error) => error.code,
      );
    let blocked = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const { rows } = await observer.query(
        'select wait_event_type from pg_stat_activity where pid=$1',
        [second.processID],
      );
      if (rows[0]?.wait_event_type === 'Lock') {
        blocked = true;
        break;
      }
      await delay(25);
    }
    assert.equal(blocked, true, 'Competing primary insert must wait for the first transaction');
    await first.query('commit');
    assert.equal(await competing, '23505', 'Competing primary must fail uniqueness');
    await second.query('rollback');
    const { rows } = await observer.query(
      `select count(*)::int n from garments_erp.${table} where contact_id=$1 and ${flag}`,
      [contact.id],
    );
    assert.equal(rows[0].n, 1);
  }
  console.log('PASS primary address, phone and bank uniqueness under concurrent writes');
} finally {
  await Promise.all([first.query('rollback'), second.query('rollback')]);
  for (const table of ['contact_items', 'contact_bank_account'])
    await observer.query(`delete from garments_erp.${table} where contact_id=any($1::bigint[])`, [
      ids,
    ]);
  await observer.query('delete from garments_erp.contacts where id=any($1::bigint[])', [ids]);
  await Promise.all(clients.map((client) => client.end()));
}
