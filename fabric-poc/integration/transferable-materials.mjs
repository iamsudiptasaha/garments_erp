import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function verifyTransferableConcurrency(url) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw Error('Local tests only');
  const clients = await Promise.all(
    [0, 1, 2].map(async () => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      return c;
    }),
  );
  const [a, b, observer] = clients;
  const actor = async (c) => {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(
      "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        '00000000-0000-4000-8000-000000000001',
        JSON.stringify({
          sub: '00000000-0000-4000-8000-000000000001',
          aal: 'aal2',
          amr: [{ method: 'password' }],
          session_id: '10000000-0000-4000-8000-000000000001',
        }),
      ],
    );
  };
  async function waiting(c) {
    const pid = (await c.query('select pg_backend_pid() pid')).rows[0].pid;
    return async () => {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const row = (
          await observer.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])
        ).rows[0];
        if (row.wait_event_type === 'Lock') return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error('Concurrent operation did not wait for inventory lock');
    };
  }
  try {
    await observer.query('begin');
    if (
      !(await observer.query('select 1 from garments_erp.raw_material_check_in where id=995001'))
        .rowCount
    )
      await observer.query(
        readFileSync(
          new URL('../../database/tests/transferable-materials-fixture.sql', import.meta.url),
          'utf8',
        ),
      );
    await observer.query('commit');
    const stamp = (
      await observer.query(
        'select updated_at::text from garments_erp.raw_material_check_in where id=995001',
      )
    ).rows[0].updated_at;
    // Transfer and transfer, then Return and Discard: loser must reject the reviewed revision.
    let expected = null;
    for (const [winnerType, loserType] of [
      [1, 1],
      [2, 3],
      [3, 1],
      [4, 4],
    ]) {
      await actor(a);
      await actor(b);
      const blocked = await waiting(b);
      const args = [
        995001,
        expected,
        stamp,
        winnerType,
        winnerType === 1 ? 995001 : null,
        winnerType === 1 ? 995001 : null,
        900001,
        'Concurrency verification',
      ];
      const sql = 'select public.erp_record_transferable_movement($1,$2,$3,$4,$5,$6,$7,$8) row';
      const winner = (await a.query(sql, args)).rows[0].row;
      const outcome = b
        .query(sql, [
          ...args.slice(0, 3),
          loserType,
          loserType === 1 ? 995002 : null,
          loserType === 1 ? 995001 : null,
          ...args.slice(6),
        ])
        .then(
          () => 'accepted',
          (e) => e.code,
        );
      await blocked();
      await a.query('commit');
      assert.equal(await outcome, '40001');
      await b.query('rollback');
      expected = winner.id;
    }
    // Ordinary issue wins over a simultaneous flag enable, even through direct writes.
    await actor(a);
    await a.query(
      'select public.erp_save_raw_material_transaction(\'materialIssues\',null,null,\'{"raw_material_check_in_id":995003,"date":"2026-11-22","quantity":1,"check_out_type_id":995001}\')',
    );
    await b.query('begin');
    await b.query(
      'select set_config(\'request.jwt.claim.sub\',\'00000000-0000-4000-8000-000000000001\',true),set_config(\'request.jwt.claims\',\'{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}\',true)',
    );
    const blocked = await waiting(b);
    const flag = b
      .query('update garments_erp.raw_material_check_in set is_transferable=true where id=995003')
      .then(
        () => 'accepted',
        (e) => e.code,
      );
    await blocked();
    await a.query('commit');
    assert.equal(await flag, '23514');
    await b.query('rollback');
    // Inverse race: enabling transferability wins, waiting direct issue is rejected.
    await b.query('begin');
    await b.query(
      'select set_config(\'request.jwt.claim.sub\',\'00000000-0000-4000-8000-000000000001\',true),set_config(\'request.jwt.claims\',\'{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}\',true)',
    );
    await b.query(
      'update garments_erp.raw_material_check_in set is_transferable=true where id=995004',
    );
    await a.query('begin');
    const waitA = await waiting(a);
    const issue = a
      .query(
        'insert into garments_erp.raw_material_check_out(raw_material_check_in_id,date,quantity) values(995004,current_date,1)',
      )
      .then(
        () => 'accepted',
        (e) => e.code,
      );
    await waitA();
    await b.query('commit');
    assert.equal(await issue, '23514');
    await a.query('rollback');
    assert.equal(
      (
        await observer.query(
          'select count(*)::int n from garments_erp.transferable_item_movement where raw_material_check_in_id=995001',
        )
      ).rows[0].n,
      4,
    );
    console.log(
      'PASS six independent-session races: Transfer/Transfer, Return/Discard, Discard/Transfer, Restore/Restore, Stock Out/flag and flag/Stock Out',
    );
  } finally {
    await Promise.all(
      clients.map(async (c) => {
        await c.query('rollback').catch(() => {});
        await c.end();
      }),
    );
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('../../scripts/ci/assert-test-db.mjs');
  await verifyTransferableConcurrency(process.env.TEST_DATABASE_URL);
}
