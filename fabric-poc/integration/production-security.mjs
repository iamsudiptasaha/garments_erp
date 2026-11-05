import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import '../../scripts/ci/assert-test-db.mjs';
const admin = '00000000-0000-4000-8000-000000000001';
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const a = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
const b = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await Promise.all([c.connect(), a.connect(), b.connect()]);
async function actor(db) {
  await db.query('set local role authenticated');
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [
      admin,
      JSON.stringify({
        sub: admin,
        aal: 'aal2',
        session_id: '10000000-0000-4000-8000-000000000001',
        amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
      }),
    ],
  );
}
try {
  // Synthetic fixtures persist only in the disposable CI database. No transition
  // history is bypassed or deleted to clean up a committed concurrency test.
  await c.query('begin');
  const label = 'Production concurrency ' + randomUUID();
  const type = (
    await c.query('insert into garments_erp.stage_type(name) values($1) returning id', [label])
  ).rows[0].id;
  const stages = (
    await c.query(
      `insert into garments_erp.stage(name,abbr,sort_order,stage_type_id)
       values($1,'RCUT',-910,$2),($1||' next','RSEW',-900,$2) returning id,sort_order`,
      [label, type],
    )
  ).rows.sort((x, y) => x.sort_order - y.sort_order);
  const item = (
    await c.query('insert into garments_erp.item(style_code) values($1) returning id', [label])
  ).rows[0].id;
  const partType = (
    await c.query('insert into garments_erp.part_list(part) values($1) returning id', [label])
  ).rows[0].id;
  const part = (
    await c.query(
      'insert into garments_erp.item_part(item_id,part_list_id) values($1,$2) returning id',
      [item, partType],
    )
  ).rows[0].id;
  const production = (
    await c.query('insert into garments_erp.production(item_part_id) values($1) returning id', [
      part,
    ])
  ).rows[0].id;
  await c.query('insert into garments_erp.task_board_data(production_id) values($1)', [production]);
  const source = (
    await c.query(
      `insert into garments_erp.job(production_id,stage_id,job_code,latest)
       values($1,$2,garments_erp.generate_job_code($2),true) returning id`,
      [production, stages[0].id],
    )
  ).rows[0].id;
  await c.query('insert into garments_erp.job_item_status_list(job_id) values($1)', [source]);
  await c.query('commit');
  const payload = {
    action: 'advance',
    production_id: production,
    from_job_id: source,
    to_stage_id: stages[1].id,
    verified_by: '900001',
    expected_transition_id: '0',
    pieces: [],
  };
  await a.query('begin');
  await b.query('begin');
  await actor(a);
  await actor(b);
  const pidB = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
  await b.query("set local lock_timeout='5s'");
  await a.query('select public.erp_move_production($1,$2)', [payload, null]);
  const second = b.query('select public.erp_move_production($1,$2)', [payload, null]).then(
    () => null,
    (error) => error.code,
  );
  let blocked = false;
  for (let n = 0; n < 50; n++) {
    blocked = (await c.query('select cardinality(pg_blocking_pids($1))>0 blocked', [pidB])).rows[0]
      .blocked;
    if (blocked) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(blocked, 'the second operator waits for the production lock');
  await a.query('commit');
  assert.equal(await second, '40001', 'the second movement rejects its stale source');
  await b.query('rollback');
  const counts = (
    await c.query(
      `select count(*)::int jobs,count(*) filter(where latest)::int current
       from garments_erp.job where production_id=$1`,
      [production],
    )
  ).rows[0];
  assert.deepEqual(counts, { jobs: 2, current: 1 });
  assert.equal(
    (
      await c.query(
        'select count(*)::int n from garments_erp.job_transition_log where production_id=$1',
        [production],
      )
    ).rows[0].n,
    1,
  );
  console.log('PASS concurrent production advances serialize and reject the stale second move');
} finally {
  await Promise.allSettled([a.query('rollback'), b.query('rollback'), c.query('rollback')]);
  await Promise.all([a.end(), b.end(), c.end()]);
}
