import pg from 'pg';
import assert from 'node:assert/strict';
import '../../scripts/ci/assert-test-db.mjs';
const clients = await Promise.all(
  [0, 1, 2].map(async () => {
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await c.connect();
    return c;
  }),
);
const [setup, a, b] = clients;
let program, dyer, brand, colour, mapping;
const labs = [],
  versions = [];
const scalar = async (sql, args = []) => (await setup.query(sql, args)).rows[0].id;
try {
  brand = await scalar(
    "insert into garments_erp.brand_list(brand,contacts_id,contact_purpose_id) values('Concurrent editions',900001,900001) returning id",
  );
  colour = await scalar(
    "insert into garments_erp.color_map(name) values('Concurrent colour') returning id",
  );
  mapping = await scalar(
    'insert into garments_erp.color_map_by_brand(color_map_id,brand_list_id) values($1,$2) returning id',
    [colour, brand],
  );
  dyer = await scalar(
    'insert into garments_erp.dyer(contacts_id,contact_purpose_id) values(900001,900001) returning id',
  );
  program = await scalar(
    'insert into garments_erp.dyeing_program(dyer_id) values($1) returning id',
    [dyer],
  );
  for (let edition = 1; edition <= 7; edition++) {
    const lab = await scalar(
      'insert into garments_erp.lab_dip(color_map_by_brand_id,dyer_id,edition) values($1,$2,$3) returning id',
      [mapping, dyer, edition],
    );
    labs.push(lab);
    versions.push(
      await scalar(
        'insert into garments_erp.lab_dip_version(lab_dip_id,version) values($1,1) returning id',
        [lab],
      ),
    );
    if (edition <= 5)
      await setup.query(
        'insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) values($1,$2,$3)',
        [program, lab, versions.at(-1)],
      );
  }
  const insert =
    'insert into garments_erp.dyeing_program_lab_dip(dyeing_program_id,lab_dip_id,lab_dip_version_id) values($1,$2,$3)';
  await a.query('begin');
  await b.query('begin');
  await a.query(insert, [program, labs[5], versions[5]]);
  const waiting = b.query(insert, [program, labs[6], versions[6]]);
  await a.query('commit');
  await waiting;
  await assert.rejects(
    b.query('commit'),
    (error) => error.code === '23514' && /six edition/.test(error.message),
  );
  assert.equal(
    (
      await setup.query(
        'select count(*)::integer as n from garments_erp.dyeing_program_lab_dip where dyeing_program_id=$1',
        [program],
      )
    ).rows[0].n,
    6,
  );
  await a.query('begin');
  await b.query('begin');
  await a.query(
    'delete from garments_erp.dyeing_program_lab_dip where dyeing_program_id=$1 and lab_dip_id=$2',
    [program, labs[5]],
  );
  await a.query(insert, [program, labs[6], versions[6]]);
  const duplicate = b.query(insert, [program, labs[6], versions[6]]).then(
    () => null,
    (error) => error,
  );
  await a.query('commit');
  assert.equal((await duplicate).code, '23505');
  await b.query('rollback');
  console.log('PASS concurrent sixth/seventh group writes and duplicate edition serialization');
} finally {
  await Promise.allSettled([a.query('rollback'), b.query('rollback')]);
  await setup.query('begin');
  if (program) {
    await setup.query(
      'delete from garments_erp.dyeing_program_lab_dip where dyeing_program_id=$1',
      [program],
    );
    await setup.query('delete from garments_erp.dyeing_program where id=$1', [program]);
  }
  if (versions.length)
    await setup.query('delete from garments_erp.lab_dip_version where id=any($1::bigint[])', [
      versions,
    ]);
  if (labs.length)
    await setup.query('delete from garments_erp.lab_dip where id=any($1::bigint[])', [labs]);
  if (mapping)
    await setup.query('delete from garments_erp.color_map_by_brand where id=$1', [mapping]);
  if (colour) await setup.query('delete from garments_erp.color_map where id=$1', [colour]);
  if (brand) await setup.query('delete from garments_erp.brand_list where id=$1', [brand]);
  if (dyer) await setup.query('delete from garments_erp.dyer where id=$1', [dyer]);
  await setup.query('commit');
  await Promise.all(clients.map((c) => c.end()));
}
