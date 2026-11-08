begin;
set local lock_timeout = '10s';

alter table garments_erp.variant_item_per_job
  add column per_piece_billed_price numeric
    check (per_piece_billed_price >= 0 and per_piece_billed_price < 'Infinity'::numeric);

comment on column garments_erp.variant_item_per_job.per_piece_billed_price is
  'Final billed rate per piece for this variant in this stage operation. NULL means the final rate has not been recorded.';

notify pgrst, 'reload schema';
commit;
