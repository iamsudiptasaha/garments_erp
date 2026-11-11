begin;

insert into garments_access.app_resource(key,name,resource_type,parent_resource_id,route,sort_order)
select spec.key,spec.name,'screen',parent.id,spec.route,spec.sort_order
from (values ('productionChallans','Challans','/production-challan.html#challans',140),
             ('jobWorkerBills','Worker bills','/production-challan.html#worker-bills',141))
  spec(key,name,route,sort_order)
left join garments_access.app_resource parent on parent.key='section:production'
on conflict(key) do update set parent_resource_id=excluded.parent_resource_id,route=excluded.route;

-- Only the reviewed aggregate RPCs and private attachment service write these records.
revoke select,insert,update,delete,truncate on garments_erp.challan,garments_erp.challan_job_item,
  garments_erp.challan_job_item_pieces,garments_erp.job_worker_bill,garments_erp.job_worker_bill_items
  from public,anon,authenticated;

create sequence garments_erp.challan_document_number;

create function garments_erp.challan_documents(p_billing boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare resource text := case when p_billing then 'jobWorkerBills' else 'productionChallans' end;
begin
  if not garments_access.has_screen_permission(resource,'view') then
    raise exception 'Document access required' using errcode='42501';
  end if;
  return (
    with assignments as (
      select a.id::text id,j.job_code job,j.job_worker_id::text worker,
             coalesce(c.company_name,'Worker '||j.job_worker_id) worker_name,
             i.style_code style,p.part part,v.variant_name variant,s.name stage,
             coalesce((select jsonb_object_agg(z.size,sp.pieces_stock_in::text)
               from garments_erp.stage_pieces sp
               join garments_erp.item_size_list iz on iz.id=sp.item_size_list_id
               join garments_erp.size_list z on z.id=iz.size_list_id
               where sp.variant_item_per_job_id=a.id),'{}') stock
      from garments_erp.variant_item_per_job a
      join garments_erp.job j on j.id=a.job_id
      join garments_erp.stage s on s.id=j.stage_id
      left join garments_erp.job_worker w on w.id=j.job_worker_id
      left join garments_erp.contacts c on c.id=w.contacts_id
      join garments_erp.variant_item vi on vi.id=a.variant_item_id
      join garments_erp.variant v on v.id=vi.variant_id
      join garments_erp.item_part ip on ip.id=vi.item_part_id
      join garments_erp.part_list p on p.id=ip.part_list_id
      join garments_erp.item i on i.id=ip.item_id
    ), lines as (
      select l.id::text id,l.challan_id,l.variant_item_per_job_id::text assignment,
        l.rate::text rate,l.description,
        exists(select 1 from garments_erp.job_worker_bill_items b where b.challan_job_item_id=l.id) billed,
        coalesce((select jsonb_object_agg(z.size, q.issued_pieces::text)
          from garments_erp.challan_job_item_pieces q
          join garments_erp.item_size_list iz on iz.id=q.item_size_list_id
          join garments_erp.size_list z on z.id=iz.size_list_id where q.challan_job_item_id=l.id),'{}') quantities
      from garments_erp.challan_job_item l
    )
    select jsonb_build_object(
      'permissions', (select jsonb_object_agg(action,garments_access.has_screen_permission(resource,action))
        from unnest(array['create','edit','delete','print','format','export']) action),
      'pages',jsonb_build_object('challans',garments_access.has_screen_permission('productionChallans','view'),
        'billing',garments_access.has_screen_permission('jobWorkerBills','view')),
      'sizeOrder',(select coalesce(jsonb_agg(z.size order by z.sort_order,z.id),'[]')
        from garments_erp.size_list z),
      'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.style,a.part,a.variant,a.id),'[]')
        from assignments a where (not p_billing and a.worker is not null and a.stock<>'{}') or exists(select 1 from lines l where l.assignment=a.id)),
      'employees',case when p_billing then '[]'::jsonb else
        (select coalesce(jsonb_agg(jsonb_build_object('id',e.id::text,'name',coalesce(c.company_name,e.employee_code)) order by c.company_name,e.id),'[]')
         from garments_erp.employee e left join garments_erp.contacts c on c.id=e.contacts_id
         where e.is_active or exists(select 1 from garments_erp.challan ch where ch.issue_employee_id=e.id)) end,
      'challans',(select coalesce(jsonb_agg(jsonb_build_object('key',ch.id::text,'id',ch.challan_number,'date',ch.issue_date,
         'revision',ch.updated_at,'employee',case when not p_billing then ch.issue_employee_id::text end,
         'lines',(select coalesce(jsonb_agg(to_jsonb(l)-'challan_id' order by l.id::bigint),'[]') from lines l where l.challan_id=ch.id)) order by ch.id desc),'[]')
         from garments_erp.challan ch),
      'bills',case when p_billing then (select coalesce(jsonb_agg(jsonb_build_object('key',b.id::text,'number','WB-'||b.id,
        'invoiceNumber',b.invoice_number,'date',b.date,'revision',b.updated_at,
        'attachment',case when f.id is not null then jsonb_build_object('id',f.id::text,'name',f.filename) end,
        'items',(select coalesce(jsonb_agg(jsonb_build_object('line',bi.challan_job_item_id::text,'rate',bi.billed_rate::text) order by bi.id),'[]')
          from garments_erp.job_worker_bill_items bi where bi.job_worker_bill_id=b.id)) order by b.id desc),'[]')
        from garments_erp.job_worker_bill b left join garments_erp.attachments f on f.id=b.bill_attachment) else '[]'::jsonb end
    )
  );
end $$;

create function garments_erp.save_challan_document(p_billing boolean,p_action text,p_document jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare
  resource text := case when p_billing then 'jobWorkerBills' else 'productionChallans' end;
  document_id bigint := (p_document->>'key')::bigint;
  revision timestamptz;
  entries jsonb := p_document->'lines';
  entry jsonb;
  line_id bigint;
  assignment_id bigint;
  worker_id bigint;
  document_worker bigint;
  existing_assignment bigint;
  line_rate numeric;
  kept bigint[] := '{}';
  expected jsonb;
  doc_number text;
begin
  if p_action is null or p_action not in ('create','edit','delete')
     or not garments_access.has_screen_permission(resource,p_action) then
    raise exception 'Document permission required' using errcode='42501';
  end if;
  if pg_column_size(p_document)>1000000 or (p_action='create') is distinct from (document_id is null) then
    raise exception 'Invalid document';
  end if;
  -- Serialize these document commands so that ownership, billed-line checks and
  -- child replacement see the result of any preceding write.
  perform pg_advisory_xact_lock(741208537);
  if document_id is not null then
    if p_billing then
      select updated_at into revision from garments_erp.job_worker_bill where id=document_id for update;
    else
      select updated_at into revision from garments_erp.challan where id=document_id for update;
    end if;
    if not found or revision is distinct from (p_document->>'revision')::timestamptz then
      raise exception 'Document changed. Reload before saving.' using errcode='40001';
    end if;
  end if;
  if p_action='delete' then
    if p_billing then
      delete from garments_erp.job_worker_bill_items where job_worker_bill_id=document_id;
      delete from garments_erp.job_worker_bill where id=document_id;
    else
      set constraints garments_erp.check_challan_stock_in, garments_erp.check_production_variant_links deferred;
      if exists(select 1 from garments_erp.job_worker_bill_items b join garments_erp.challan_job_item l
        on l.id=b.challan_job_item_id where l.challan_id=document_id) then
        raise exception 'A challan with billed lines cannot be deleted';
      end if;
      delete from garments_erp.challan_job_item_pieces q using garments_erp.challan_job_item l
        where l.challan_id=document_id and q.challan_job_item_id=l.id;
      delete from garments_erp.challan_job_item where challan_id=document_id;
      delete from garments_erp.challan where id=document_id;
      set constraints garments_erp.check_challan_stock_in, garments_erp.check_production_variant_links immediate;
    end if;
    return document_id::text;
  end if;

  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 500 then
    raise exception 'Add between 1 and 500 document lines';
  end if;
  if p_billing then
    if document_id is null then
      insert into garments_erp.job_worker_bill(invoice_number,date)
      values(nullif(btrim(p_document->>'invoiceNumber'),''),(p_document->>'date')::date)
      returning id into document_id;
    else
      update garments_erp.job_worker_bill set invoice_number=nullif(btrim(p_document->>'invoiceNumber'),''),
        date=(p_document->>'date')::date,
        bill_attachment=case when p_document->>'removeAttachment'='true' then null else bill_attachment end,
        updated_at=clock_timestamp() where id=document_id;
    end if;
    foreach entry in array array(select jsonb_array_elements(entries)) loop
      line_id := (entry->>'line')::bigint;
      line_rate := (entry->>'rate')::numeric;
      select j.job_worker_id into worker_id from garments_erp.challan_job_item l
        join garments_erp.variant_item_per_job a on a.id=l.variant_item_per_job_id
        join garments_erp.job j on j.id=a.job_id where l.id=line_id;
      if worker_id is null or (document_worker is not null and document_worker<>worker_id)
        or line_id=any(kept) or line_rate is null or line_rate<0 or line_rate>='Infinity'::numeric then
        raise exception 'Select distinct challan lines for one worker and enter valid billed rates';
      end if;
      document_worker := worker_id;
      kept := array_append(kept,line_id);
      update garments_erp.job_worker_bill_items set billed_rate=line_rate
        where job_worker_bill_id=document_id and challan_job_item_id=line_id;
      if not found then
        insert into garments_erp.job_worker_bill_items(job_worker_bill_id,challan_job_item_id,billed_rate)
          values(document_id,line_id,line_rate);
      end if;
    end loop;
    delete from garments_erp.job_worker_bill_items where job_worker_bill_id=document_id and not challan_job_item_id=any(kept);
  else
    if document_id is null then
      loop
        doc_number := 'CH-'||nextval('garments_erp.challan_document_number');
        insert into garments_erp.challan(challan_number,issue_date,issue_employee_id)
        values(doc_number,(p_document->>'date')::date,(p_document->>'employee')::bigint)
        on conflict(challan_number) do nothing returning id into document_id;
        exit when found;
      end loop;
    else
      update garments_erp.challan set issue_date=(p_document->>'date')::date,
        issue_employee_id=(p_document->>'employee')::bigint,updated_at=clock_timestamp() where id=document_id;
    end if;
    set constraints garments_erp.check_challan_stock_in, garments_erp.check_production_variant_links deferred;
    foreach entry in array array(select jsonb_array_elements(entries)) loop
      line_id := (entry->>'id')::bigint;
      assignment_id := (entry->>'assignment')::bigint;
      line_rate := (entry->>'rate')::numeric;
      select j.job_worker_id into worker_id from garments_erp.variant_item_per_job a
        join garments_erp.job j on j.id=a.job_id where a.id=assignment_id;
      if worker_id is null or (document_worker is not null and document_worker<>worker_id)
        or (line_rate is not null and (line_rate<0 or line_rate>='Infinity'::numeric)) then
        raise exception 'Select job variants for one worker and enter valid challan rates';
      end if;
      document_worker := worker_id;
      if line_id is not null then
        select variant_item_per_job_id into existing_assignment from garments_erp.challan_job_item
          where id=line_id and challan_id=document_id;
        if not found or line_id=any(kept) then raise exception 'Invalid challan line'; end if;
        if existing_assignment<>assignment_id and exists(select 1 from garments_erp.job_worker_bill_items
          where challan_job_item_id=line_id) then
          raise exception 'The assignment of a billed line cannot change';
        end if;
      end if;

      if line_id is null or existing_assignment<>assignment_id then
        select jsonb_object_agg(z.size,sp.pieces_stock_in::text) into expected
          from garments_erp.stage_pieces sp join garments_erp.item_size_list iz on iz.id=sp.item_size_list_id
          join garments_erp.size_list z on z.id=iz.size_list_id where sp.variant_item_per_job_id=assignment_id;
      else
        select jsonb_object_agg(z.size,q.issued_pieces::text) into expected
          from garments_erp.challan_job_item_pieces q join garments_erp.item_size_list iz on iz.id=q.item_size_list_id
          join garments_erp.size_list z on z.id=iz.size_list_id where q.challan_job_item_id=line_id;
      end if;
      if expected is null or expected is distinct from entry->'quantities' then
        raise exception 'Issued quantities must match the full stock-in by size. Reload before saving.';
      end if;
      if line_id is null then
        insert into garments_erp.challan_job_item(challan_id,variant_item_per_job_id,rate,description)
          values(document_id,assignment_id,line_rate,entry->>'description') returning id into line_id;
      else
        update garments_erp.challan_job_item set rate=line_rate,description=entry->>'description'
          where id=line_id;
        if existing_assignment<>assignment_id then
          update garments_erp.challan_job_item set variant_item_per_job_id=assignment_id where id=line_id;
          delete from garments_erp.challan_job_item_pieces where challan_job_item_id=line_id;
        end if;
      end if;
      if not exists(select 1 from garments_erp.challan_job_item_pieces where challan_job_item_id=line_id) then
        insert into garments_erp.challan_job_item_pieces(challan_job_item_id,item_size_list_id,issued_pieces)
        select line_id,item_size_list_id,pieces_stock_in from garments_erp.stage_pieces where variant_item_per_job_id=assignment_id;
        select jsonb_object_agg(z.size,q.issued_pieces::text) into expected
          from garments_erp.challan_job_item_pieces q join garments_erp.item_size_list iz on iz.id=q.item_size_list_id
          join garments_erp.size_list z on z.id=iz.size_list_id where q.challan_job_item_id=line_id;
        if expected is distinct from entry->'quantities' then
          raise exception 'Stock-in changed during issuance. Reload before saving.' using errcode='40001';
        end if;
      end if;
      kept := array_append(kept,line_id);
    end loop;
    if exists(select 1 from garments_erp.job_worker_bill_items b join garments_erp.challan_job_item l
      on l.id=b.challan_job_item_id where l.challan_id=document_id and not l.id=any(kept)) then
      raise exception 'Keep challan lines referenced by worker bills';
    end if;
    delete from garments_erp.challan_job_item_pieces q using garments_erp.challan_job_item l
      where l.challan_id=document_id and q.challan_job_item_id=l.id and not l.id=any(kept);
    delete from garments_erp.challan_job_item where challan_id=document_id and not id=any(kept);
    set constraints garments_erp.check_challan_stock_in, garments_erp.check_production_variant_links immediate;
  end if;
  return document_id::text;
exception when unique_violation then
  if p_billing then raise exception 'A selected challan line is already billed' using errcode='23505'; end if;
  raise;
end $$;

create function public.erp_challan_documents(p_billing boolean) returns jsonb
language sql stable security invoker set search_path='' as $$select garments_erp.challan_documents(p_billing)$$;
create function public.erp_save_challan_document(p_billing boolean,p_action text,p_document jsonb) returns text
language sql security invoker set search_path='' as $$select garments_erp.save_challan_document(p_billing,p_action,p_document)$$;
revoke all on function garments_erp.challan_documents(boolean),garments_erp.save_challan_document(boolean,text,jsonb),
  public.erp_challan_documents(boolean),public.erp_save_challan_document(boolean,text,jsonb) from public,anon;
grant execute on function garments_erp.challan_documents(boolean),garments_erp.save_challan_document(boolean,text,jsonb),
  public.erp_challan_documents(boolean),public.erp_save_challan_document(boolean,text,jsonb) to authenticated;
-- A replaced or detached bill file must stop issuing signed links immediately.
create or replace function garments_erp.file_read(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare upload garments_erp.app_file_upload; target jsonb; attachment garments_erp.attachments; bucket garments_erp.bucket_group;
begin
  select * into upload from garments_erp.app_file_upload where attachment_id=p_id and status='ready';
  if not found then raise exception 'Attachment is not registered to a record'; end if;
  target:=garments_erp.file_record(upload.target_key,upload.record_id,'view');
  if upload.target_key='workerBill' and target->>'current' is distinct from p_id::text then
    raise exception 'Attachment is no longer linked to the worker bill' using errcode='42501';
  end if;
  select * into strict attachment from garments_erp.attachments where id=p_id;
  select * into strict bucket from garments_erp.bucket_group where id=attachment.bucket_group_id;
  if exists(select 1 from storage.buckets where id=bucket.bucket_id and public) then
    raise exception 'Private bucket required';
  end if;
  return jsonb_build_object('bucket_id',bucket.bucket_id,'storage_path',attachment.storage_path);
end $$;
commit;
