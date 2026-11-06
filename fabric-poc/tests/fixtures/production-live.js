export function productionFixture() {
  const item = {
    id: '9007199254740993',
    style_code: 'LIVE-101',
    product_description: 'Cotton polo',
    batch_number: '000123',
  };
  const part = { id: '21', item_id: item.id, part_list_id: '22' };
  const production = { id: '31', item_part_id: part.id };
  const job = {
    id: '41',
    production_id: production.id,
    stage_id: '1',
    latest: true,
    job_code: 'CUT/0001',
    start_date: '2026-11-01',
    due_date: null,
    complete_date: null,
  };
  const status = {
    id: '51',
    job_id: job.id,
    item_status_list_id: '61',
    updated_at: '2026-11-01T00:00:00Z',
  };
  return {
    _live: true,
    item: [item],
    item_part: [part],
    production: [production],
    job: [job],
    job_item_status_list: [status],
    part_list: [{ id: '22', part: 'Body' }],
    stage: [
      { id: '1', name: 'Cutting', sort_order: 1, track_pieces: true, stage_type_id: '10' },
      { id: '2', name: 'Printing', sort_order: 2, track_pieces: true, stage_type_id: '10' },
      { id: '3', name: 'Stitching', sort_order: 3, track_pieces: true, stage_type_id: '10' },
    ],
    stage_type: [{ id: '10', name: 'Work in progress' }],
    employee: [
      { id: '71', name: 'Asha Das', employee_code: 'EMP-71', is_active: true },
      { id: '72', name: 'Asha Das', employee_code: 'EMP-72', is_active: true },
    ],
    item_status_list: [
      { id: '61', status: 'In process' },
      { id: '62', status: 'Complete' },
    ],
    flags_list: [{ id: '81', name: 'Rush' }],
    production_checklist: [],
    item_size_list: [{ id: '91', item_id: item.id, size_list_id: '92' }],
    size_list: [{ id: '92', size: 'M', sort_order: 1 }],
    item_cut_ratio: [{ id: '93', item_size_list_id: '91', pieces: 100 }],
    variant: [
      { id: '101', variant_name: 'Navy', share_weight: 1 },
      { id: '102', variant_name: 'Ivory', share_weight: 1 },
    ],
    variant_item: [
      { id: '111', item_part_id: part.id, variant_id: '101' },
      { id: '112', item_part_id: part.id, variant_id: '102' },
    ],
    variant_item_per_job: [
      { id: '121', variant_item_id: '111', job_id: job.id },
      { id: '122', variant_item_id: '112', job_id: job.id },
    ],
    stage_pieces: [
      {
        id: '131',
        variant_item_per_job_id: '121',
        item_size_list_id: '91',
        pieces_stock_in: 50,
        pieces_stock_out: 0,
      },
      {
        id: '132',
        variant_item_per_job_id: '122',
        item_size_list_id: '91',
        pieces_stock_in: 50,
        pieces_stock_out: 0,
      },
    ],
    brand_list: [],
    contacts: [],
    job_worker: [],
    gender: [],
    product_type_list: [],
    attachments: [],
    lab_dip: [],
    color_map_by_brand: [],
    production_records: [
      {
        production,
        item,
        item_part: part,
        jobs: [job],
        statuses: [status],
        assignees: [],
        flags: [],
        movements: [],
        current_path: [job.id],
        revision: 'revision-1',
      },
    ],
  };
}
