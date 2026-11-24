import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../scripts/ci/assert-test-db.mjs';
const clients = await Promise.all(
  [0, 1, 2].map(async () => {
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    return c;
  }),
);
const [setup, a, b] = clients;
try {
  // Synthetic history is deliberately retained in this disposable database;
  // deleting it would contradict the provenance invariant under test.
  const fixture = readFileSync(
    new URL('../../database/tests/dyeing-edition-groups.sql', import.meta.url),
    'utf8',
  )
    .split(' -- Six edition groups')[0]
    .replaceAll('Edition ', 'Concurrency ')
    .replaceAll('EDITION-TEST', 'CONCURRENCY-TEST')
    .replace("values('Concurrency fabric',8)", "values('Concurrency fabric',null)");
  await setup.query(fixture + 'end $$; commit;');
  const row = (
    await setup.query(`select i.id item_id,i.dyeing_program_lab_dip_id group_id,g.lab_dip_id,g.lab_dip_version_id,
    (select v.id from garments_erp.lab_dip_version v where v.lab_dip_id=g.lab_dip_id and v.version=1) version1,
    (select d.id from garments_erp.dyed_fabric_item d join garments_erp.batch_no_lab_dip_version_map bm on bm.dyed_fabric_item_id=d.id where bm.batch_no='CONCURRENCY-TEST-BATCH') receipt_id
    from garments_erp.fabric_plan_dyeing_link l join garments_erp.dyeing_program_item i on i.id=l.dyeing_program_item_id
    join garments_erp.dyeing_program_lab_dip g on g.id=i.dyeing_program_lab_dip_id
    join garments_erp.item_part_fabric f on f.id=l.item_part_fabric_id where f.sub_part_name='Body' and g.lab_dip_version_id<>(select v.id from garments_erp.lab_dip_version v where v.lab_dip_id=g.lab_dip_id and v.version=1) limit 1`)
  ).rows[0];
  assert.ok(row);
  const receive = async (client, item, version, label) => {
    const d = (
      await client.query(
        `insert into garments_erp.dyed_fabric_item(dyed_fabric_bill_id,dyeing_program_item_id,knitting_bill_item_id,gross_quantity,billed_quantity,final_quantity,dyeing_rate)
      select dyed_fabric_bill_id,$1,knitting_bill_item_id,1,1,1,dyeing_rate from garments_erp.dyed_fabric_item where id=$2 returning id`,
        [item, row.receipt_id],
      )
    ).rows[0];
    await client.query(
      'insert into garments_erp.batch_no_lab_dip_version_map(dyed_fabric_item_id,lab_dip_version_id,batch_no) values($1,$2,$3)',
      [d.id, version, label],
    );
  };
  await a.query('begin');
  await b.query('begin');
  await receive(a, row.item_id, row.lab_dip_version_id, 'RACE-RECORDED-OUTPUT');
  const blocked = b
    .query('update garments_erp.dyeing_program_lab_dip set lab_dip_version_id=$1 where id=$2', [
      row.version1,
      row.group_id,
    ])
    .then(
      () => null,
      (e) => e,
    );
  await a.query('commit');
  assert.equal(
    (await blocked)?.code,
    '23514',
    'A version update waiting behind receipt recording must fail',
  );
  await b.query('rollback');
  assert.equal(
    (
      await setup.query(
        'select lab_dip_version_id from garments_erp.dyeing_program_lab_dip where id=$1',
        [row.group_id],
      )
    ).rows[0].lab_dip_version_id,
    row.lab_dip_version_id,
  );
  // Reverse order: a stale receipt's explicit output version cannot survive a
  // committed program change made before receipt recording.
  const fresh = (
    await setup.query(
      `with p as(insert into garments_erp.dyeing_program(dyer_id) select p.dyer_id from garments_erp.dyeing_program p join garments_erp.dyeing_program_item i on i.dyeing_program_id=p.id where i.id=$1 returning id),
    g as(insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) select id,$2,$3 from p returning id,dyeing_program_id)
    insert into garments_erp.dyeing_program_item(dyeing_program_id,dyeing_program_lab_dip_id,fabric_type_id,quantity) select g.dyeing_program_id,g.id,i.fabric_type_id,1 from g cross join garments_erp.dyeing_program_item i where i.id=$1 returning id,dyeing_program_lab_dip_id`,
      [row.item_id, row.lab_dip_id, row.version1],
    )
  ).rows[0];
  await a.query('begin');
  await b.query('begin');
  await a.query(
    'update garments_erp.dyeing_program_lab_dip set lab_dip_version_id=$1 where id=$2',
    [row.lab_dip_version_id, fresh.dyeing_program_lab_dip_id],
  );
  const waiting = receive(b, fresh.id, row.version1, 'RACE-STALE-OUTPUT');
  await a.query('commit');
  await waiting;
  await assert.rejects(b.query('commit'), /same lab-dip version/);
  await b.query('rollback');
  assert.equal(
    (
      await setup.query(
        "select count(*)::int n from garments_erp.batch_no_lab_dip_version_map where batch_no='RACE-STALE-OUTPUT'",
      )
    ).rows[0].n,
    0,
  );
  console.log(
    'PASS concurrent recording locks provenance; reverse-order stale receipt rolls back atomically',
  );
  const requirements = (
    await setup.query(
      `select id from garments_erp.item_part_fabric where lab_dip_id=$1 and sub_part_name in ('Body','Sleeve') order by id`,
      [row.lab_dip_id],
    )
  ).rows;
  const expected = async (req) =>
    (
      await setup.query(
        `select jsonb_build_object('program',garments_erp.fabric_json('dyeing_program',to_jsonb(p)),
    'requirement',(select garments_erp.fabric_json('item_part_fabric',to_jsonb(f)) from garments_erp.item_part_fabric f where f.id=$2)) value
    from garments_erp.dyeing_program p join garments_erp.dyeing_program_item i on i.dyeing_program_id=p.id where i.id=$1`,
        [fresh.id, req],
      )
    ).rows[0].value;
  const actor = async (c) => {
    await c.query('begin');
    await c.query(
      `select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","aal":"aal2","amr":[{"method":"password"}],"session_id":"10000000-0000-4000-8000-000000000001"}',true)`,
    );
    await c.query('set local role authenticated');
  };
  const first = await expected(requirements[0].id),
    second = await expected(requirements[1].id);
  await actor(a);
  await actor(b);
  await a.query(
    `select public.erp_set_fabric_plan_dyeing_link($1,$2,true,'productionItems',$3,5.25)`,
    [requirements[0].id, fresh.id, first],
  );
  const stale = b
    .query(`select public.erp_set_fabric_plan_dyeing_link($1,$2,true,'productionItems',$3,1.25)`, [
      requirements[1].id,
      fresh.id,
      second,
    ])
    .then(
      () => null,
      (e) => e,
    );
  await a.query('commit');
  assert.equal((await stale)?.code, '40001');
  await b.query('rollback');
  assert.equal(
    Number(
      (
        await setup.query('select quantity from garments_erp.dyeing_program_item where id=$1', [
          fresh.id,
        ])
      ).rows[0].quantity,
    ),
    5.25,
  );
  console.log(
    'PASS concurrent standalone planner writers reject the stale complete set without partial links',
  );
} finally {
  await Promise.allSettled(
    clients.map(async (c) => {
      await c.query('rollback');
      await c.end();
    }),
  );
}
