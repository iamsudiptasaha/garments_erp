// Reviewed live Production setup writes. IDs, attachments and job identities are database owned.
export const productionContract = {
  productionItems: {
    item: [
      'style_code',
      'brand_id',
      'story',
      'season',
      'product_type_list_id',
      'product_description',
      'base_price',
      'batch_number',
    ],
    item_part: ['item_id', 'part_list_id', 'parent_item_part_id'],
    item_size_list: ['item_id', 'size_list_id'],
    item_cut_ratio: ['item_size_list_id', 'pieces'],
    variant_item: ['item_part_id', 'variant_id', 'lab_dip_id'],
    item_part_fabric: [
      'variant_item_id',
      'fabric_type_id',
      'sub_part_list_id',
      'sub_part_name',
      'lab_dip_id',
      'consumption_per_piece_kg',
      'item_part_fabric_status_id',
    ],
    production_checklist: [
      'item_id',
      'fpt_gpt_status_id',
      'photoshoot_sample_status_id',
      'shipment_sample_status_id',
      'techpack_aqcuired_status_id',
      'ordersheet_acquired_status_id',
    ],
  },
  productionWorkers: {
    job_worker: ['contacts_id', 'contact_purpose_id'],
  },
  productionDesigns: {
    variant: ['variant_name', 'share_weight'],
  },
  productionStages: {
    stage: ['name', 'abbr', 'sort_order', 'stage_type_id', 'track_pieces', 'pp_stage'],
  },
  productionStageTypes: {
    stage_type: ['name'],
  },
  productionPartTypes: {
    part_list: ['part'],
  },
  productionSizes: {
    size_list: ['size', 'sort_order'],
  },
  productionProductTypes: {
    product_type_list: ['product_type', 'gender_id'],
  },
  productionStatuses: {
    item_status_list: ['status'],
  },
  productionFlags: {
    flags_list: ['name'],
  },
  productionGenders: {
    gender: ['name'],
  },
};
export const liveProductionPage = (key) =>
  Object.hasOwn(productionContract, key) ||
  ['productionTaskBoard', 'productionUpdateTaskStatus'].includes(key);
