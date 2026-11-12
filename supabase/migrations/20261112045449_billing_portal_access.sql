begin;

insert into garments_access.app_resource (key, name, resource_type)
values ('billingBuyerPO', 'Buyer PO', 'screen'),
       ('billingInvoices', 'Invoices', 'screen'),
       ('billingReturns', 'Returns', 'screen'),
       ('billingDispatch', 'Dispatch', 'screen');

-- Resolve identity from the current portal session, never from command input.
create function garments_erp.billing_employee(p_screen text)
returns bigint language plpgsql stable security invoker set search_path = '' as $$
declare
  actor bigint;
begin
  if not garments_access.has_screen_permission(p_screen, 'view') then
    raise exception 'Billing page access required' using errcode = '42501';
  end if;
  select e.id into actor
  from garments_access.app_user u
  join garments_erp.employee e on e.id = u.employee_id
  where u.user_id = auth.uid() and u.is_active and e.is_active;
  if actor is null then
    raise exception 'An active linked employee is required' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function garments_erp.billing_employee(text) from public, anon, authenticated, service_role;

create function garments_erp.portal_invoice_command(p_request_id uuid, p_command jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingInvoices');
  action text := p_command->>'action';
begin
  if jsonb_typeof(p_command) is distinct from 'object'
     or action is null or action not in ('create', 'save_header', 'save_line', 'remove_line', 'finalize', 'cancel')
     or p_command ?| array['employee_id', 'verified_by', 'verified_by_id', 'p_employee_id'] then
    raise exception 'Invalid invoice command' using errcode = '22023';
  end if;
  return public.erp_billing_command(p_request_id, actor, p_command)::text;
end;
$$;

create table garments_erp.portal_invoice_request (
  request_id uuid primary key,
  employee_id bigint not null references garments_erp.employee,
  requested_billing_id bigint,
  commands jsonb not null,
  billing_id bigint not null references garments_erp.billing,
  created_at timestamptz not null default now()
);
alter table garments_erp.portal_invoice_request enable row level security;
revoke all on garments_erp.portal_invoice_request from public, anon, authenticated, service_role;

-- A form submission can create or update its header, apply line changes and
-- finalize as one transaction. Each subcommand retains the existing audit record.
create function public.erp_portal_save_invoice(
  p_request_id uuid, p_billing_id bigint, p_commands jsonb
) returns text language plpgsql security definer set search_path = '' as $$
declare
  invoice_id bigint := p_billing_id;
  command record;
  action text;
  command_count integer;
  key uuid;
  actor bigint := garments_erp.billing_employee('billingInvoices');
  previous garments_erp.portal_invoice_request%rowtype;
begin
  if not garments_access.has_screen_permission('billingInvoices',
    case when p_billing_id is null then 'create' else 'edit' end) then
    raise exception 'Invoice action access required' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_commands) is distinct from 'array' then
    raise exception 'Invoice save requires a request ID and an array of commands' using errcode = '22023';
  end if;
  command_count := jsonb_array_length(p_commands);
  if command_count not between 1 and 100 then
    raise exception 'An invoice save requires 1 to 100 commands' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 1));
  select * into previous from garments_erp.portal_invoice_request where request_id = p_request_id;
  if found then
    if (previous.employee_id, previous.requested_billing_id, previous.commands)
        is distinct from (actor, p_billing_id, p_commands) then
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    return previous.billing_id::text;
  end if;
  for command in select value, ordinality from jsonb_array_elements(p_commands) with ordinality loop
    action := command.value->>'action';
    if jsonb_typeof(command.value) is distinct from 'object'
       or command.value ? 'billing_id'
       or action is null
       or (invoice_id is null and action <> 'create')
       or (invoice_id is not null and action = 'create')
       or (action in ('cancel', 'finalize') and command.ordinality <> command_count) then
      raise exception 'Invalid invoice save command order' using errcode = '22023';
    end if;
    key := md5(p_request_id::text || ':' || command.ordinality)::uuid;
    invoice_id := garments_erp.portal_invoice_command(key,
      case when invoice_id is null then command.value
        else command.value || jsonb_build_object('billing_id', invoice_id) end)::bigint;
  end loop;
  insert into garments_erp.portal_invoice_request (request_id, employee_id, requested_billing_id, commands, billing_id)
  values (p_request_id, actor, p_billing_id, p_commands, invoice_id);
  return invoice_id::text;
end;
$$;

create function public.erp_portal_verify_return(p_request_id uuid, p_billing_id bigint, p_lines jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingReturns');
begin
  if not garments_access.has_screen_permission('billingReturns', 'create') then
    raise exception 'Return creation access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'Return lines must be an array' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) line
             where line->>'mode' is distinct from 'piece'
                or line ?| array['employee_id', 'verified_by', 'verified_by_id', 'p_employee_id']) then
    raise exception 'Portal returns require physical piece lines and use the signed-in employee'
      using errcode = '22023';
  end if;
  return public.erp_verify_billing_return(p_request_id, p_billing_id, actor, p_lines)::text;
end;
$$;

create function public.erp_portal_dispatch_transport(p_request_id uuid, p_transport_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not garments_access.has_screen_permission('billingDispatch', 'edit') then
    raise exception 'Dispatch edit access required' using errcode = '42501';
  end if;
  perform public.erp_dispatch_transport(
    p_transport_id, garments_erp.billing_employee('billingDispatch'), p_request_id
  );
end;
$$;

create function public.erp_portal_invoice(p_billing_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  details jsonb;
begin
  perform garments_erp.billing_employee('billingInvoices');
  select jsonb_build_object(
    'invoice', to_jsonb(b) || jsonb_build_object('id', b.id::text, 'formal_po_id', b.formal_po_id::text,
      'buyer_list_id', b.buyer_list_id::text, 'adhoc_po_id', b.adhoc_po_id::text),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(l) || jsonb_build_object(
        'id', l.id::text, 'po_item_id', l.po_item_id::text, 'sellable_product_id', l.sellable_product_id::text,
        'price_version_id', l.price_version_id::text, 'product_type_id', po_line.product_type_list_id::text,
        'product_name', product.name,
        'packed', exists (select 1 from garments_erp.carton_item ci where ci.billing_item_id = l.id),
        'frozen', exists (
          select 1 from garments_erp.carton_item ci
          join garments_erp.transport_item a on a.carton_id = ci.carton_id
          join garments_erp.transport t on t.id = a.transport_id
          where ci.billing_item_id = l.id and t.dispatched_at is not null
        ),
        'pieces', (
          select jsonb_agg(to_jsonb(piece) || jsonb_build_object('id', piece.id::text,
            'item_size_list_id', size.id::text, 'style', item.style_code, 'size', label.size,
            'hsn', ordered.hsn_code) order by piece.id)
          from garments_erp.billing_item_piece_per_size piece
          join garments_erp.item_size_list size on size.id = piece.item_size_list_id
          join garments_erp.size_list label on label.id = size.size_list_id
          join garments_erp.item item on item.id = size.item_id
          left join garments_erp.po_item_piece_per_size ordered
            on ordered.po_item_id = l.po_item_id and ordered.item_size_list_id = size.id
          where piece.billing_item_id = l.id
        )
      ) order by l.id)
      from garments_erp.billing_item l
      join garments_erp.po_item po_line on po_line.id = l.po_item_id
      left join garments_erp.sellable_product product on product.id = l.sellable_product_id
      where l.billing_id = b.id
    ), '[]'),
    'status', status.type, 'mode', mode.type, 'buyer', buyer.buyer_name,
    'po_number', po.po_number, 'verified_by_employee_code', verifier.employee_code,
    'totals', to_jsonb(value))
  into details
  from garments_erp.billing b
  join garments_erp.billing_status_type status on status.id = b.billing_status_type_id
  join garments_erp.sale_mode_type mode on mode.id = b.sale_mode_type_id
  join garments_erp.buyer_list buyer on buyer.id = b.buyer_list_id
  join garments_erp.buyer_po po on po.id = coalesce(b.formal_po_id, b.adhoc_po_id)
  left join garments_erp.employee verifier on verifier.id = b.verified_by
  cross join lateral garments_erp.billing_value(b.id) value
  where b.id = p_billing_id;
  return details;
end;
$$;

create function public.erp_portal_invoice_list(
  p_search text default '', p_status text default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform garments_erp.billing_employee('billingInvoices');
  return (
    select coalesce(jsonb_agg(to_jsonb(record) - 'sort_id' order by record.invoice_date desc nulls last, record.sort_id desc),
      '[]'::jsonb)
    from (
      select b.id::text as id, b.id as sort_id, b.invoice_number, b.invoice_date,
        buyer.buyer_name as buyer, status.type as status, mode.type as mode,
        case when b.formal_po_id is not null then po.po_number end as po_number,
        value.original_value, value.verified_credit
      from (
        select b.id
        from garments_erp.billing b
        join garments_erp.buyer_list buyer on buyer.id = b.buyer_list_id
        join garments_erp.billing_status_type status on status.id = b.billing_status_type_id
        left join garments_erp.buyer_po po on po.id = b.formal_po_id
        where (p_status is null or status.type = p_status)
          and (nullif(btrim(p_search), '') is null
            or strpos(lower(concat_ws(' ', b.invoice_number, buyer.buyer_name, po.po_number)), lower(btrim(p_search))) > 0)
        order by b.invoice_date desc nulls last, b.id desc
        limit least(greatest(coalesce(p_limit, 50), 1), 100)
        offset greatest(coalesce(p_offset, 0), 0)
      ) page
      join garments_erp.billing b on b.id = page.id
      join garments_erp.buyer_list buyer on buyer.id = b.buyer_list_id
      join garments_erp.billing_status_type status on status.id = b.billing_status_type_id
      join garments_erp.sale_mode_type mode on mode.id = b.sale_mode_type_id
      left join garments_erp.buyer_po po on po.id = b.formal_po_id
      cross join lateral garments_erp.billing_value(b.id) value
    ) record
  );
end;
$$;

create function public.erp_portal_create_buyer_po(p_request_id uuid, p_order jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  actor bigint := garments_erp.billing_employee('billingBuyerPO');
  resource_id bigint;
  order_id bigint;
  line_id bigint;
  line jsonb;
  sale_mode text;
  mode_id bigint;
  product_id bigint;
  size_id bigint;
  quantity integer;
  price numeric;
  previous garments_access.app_activity_log%rowtype;
begin
  if not garments_access.has_screen_permission('billingBuyerPO', 'create') then
    raise exception 'Buyer PO create access required' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_order) is distinct from 'object'
     or jsonb_typeof(p_order->'lines') is distinct from 'array' then
    raise exception 'Enter a buyer PO with at least one line' using errcode = '22023';
  end if;
  if jsonb_array_length(p_order->'lines') not between 1 and 100
     or nullif(btrim(p_order->>'number'), '') is null
     or p_order->>'issue_date' is null or p_order ? 'mode' then
    raise exception 'Enter a PO number, issue date, and a sale mode on each line' using errcode = '22023';
  end if;
  select id into strict resource_id from garments_access.app_resource where key = 'billingBuyerPO';
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 2));
  select * into previous from garments_access.app_activity_log
  where app_resource_id = resource_id and action = 'create_buyer_po'
    and details->>'request_id' = p_request_id::text;
  if found then
    if (previous.actor_user_id, previous.details->'order') is distinct from (auth.uid(), p_order) then
      raise exception 'Request ID already used' using errcode = '22023';
    end if;
    return previous.target_id;
  end if;

  insert into garments_erp.buyer_po
    (po_number, buyer_list_id, po_issue_date, po_expiry_date, season, billing_address,
     delivery_address, po_source_type_id)
  values (btrim(p_order->>'number'), (p_order->>'buyer_id')::bigint, (p_order->>'issue_date')::date,
    (p_order->>'expiry_date')::date, nullif(btrim(p_order->>'season'), ''),
    nullif(btrim(p_order->>'billing_address'), ''), nullif(btrim(p_order->>'delivery_address'), ''),
    garments_erp.formal_po_source_id())
  returning id into order_id;

  for line in select value from jsonb_array_elements(p_order->'lines') loop
    sale_mode := line->>'mode';
    select id into mode_id from garments_erp.sale_mode_type where type = sale_mode;
    product_id := (line->>'sellable_product_id')::bigint;
    size_id := (line->>'size_id')::bigint;
    quantity := (line->>'quantity')::integer;
    price := (line->>'price')::numeric;
    if mode_id is null or quantity is null or quantity < 1 or price is null or price < 0 or price >= 'Infinity'::numeric
       or line ?| array['share_weight','recipe','pieces','components']
       or (sale_mode = 'standard' and (product_id is null or size_id is not null))
       or (sale_mode = 'exception' and (size_id is null or product_id is not null)) then
      raise exception 'Choose an eligible product or size, quantity and price for each PO line' using errcode = '22023';
    end if;
    if sale_mode = 'standard' then
      perform 1 from garments_erp.sellable_product
      where id = product_id and is_active and verified_at is not null for share;
      if not found then raise exception 'Choose an active verified sellable product'; end if;
    end if;
    insert into garments_erp.po_item
      (buyer_po_id, sale_mode_type_id, sellable_product_id, ordered_units, unit_price, style_code, color)
    values (order_id, mode_id, product_id,
      case when sale_mode = 'standard' then quantity end,
      case when sale_mode = 'standard' then price end,
      nullif(btrim(line->>'style_code'), ''), nullif(btrim(line->>'color'), ''))
    returning id into line_id;

    insert into garments_erp.po_item_piece_per_size
      (po_item_id, item_size_list_id, pieces_ordered, share_weight, price_per_piece, fcid, hsn_code)
    select line_id, recipe.size_id, recipe.weight::bigint * quantity,
      case when sale_mode = 'standard' then recipe.weight end,
      case when sale_mode = 'exception' then price end,
      nullif(btrim(code.value->>'fcid'), ''), nullif(btrim(code.value->>'hsn_code'), '')
    from (
      select u.item_size_list_id as size_id, u.share_weight as weight
      from garments_erp.sellable_unit u where u.sellable_product_id = product_id
      union all select size_id, 1 where sale_mode = 'exception'
    ) recipe
    cross join lateral (select (line->'codes')->(recipe.size_id::text) as value) code;

    if not found or exists (
      select 1 from garments_erp.po_item_piece_per_size p where p.po_item_id = line_id
        and not exists (
          select 1 from garments_erp.item_produced_pieces receipt
          where receipt.item_size_list_id = p.item_size_list_id and receipt.pieces > 0
        )
    ) then raise exception 'Every component size requires recorded production stock-in'; end if;
  end loop;

  insert into garments_access.app_activity_log
    (actor_user_id, app_resource_id, action, target_type, target_id, details)
  values (auth.uid(), resource_id, 'create_buyer_po', 'buyer_po', order_id::text,
    jsonb_build_object('request_id', p_request_id, 'employee_id', actor, 'order', p_order));
  return order_id::text;
end;
$$;

revoke all on function garments_erp.portal_invoice_command(uuid, jsonb),
  public.erp_portal_save_invoice(uuid, bigint, jsonb),
  public.erp_portal_verify_return(uuid, bigint, jsonb),
  public.erp_portal_dispatch_transport(uuid, bigint), public.erp_portal_invoice(bigint),
  public.erp_portal_invoice_list(text, text, integer, integer),
  public.erp_portal_create_buyer_po(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.erp_portal_save_invoice(uuid, bigint, jsonb),
  public.erp_portal_verify_return(uuid, bigint, jsonb),
  public.erp_portal_dispatch_transport(uuid, bigint), public.erp_portal_invoice(bigint),
  public.erp_portal_invoice_list(text, text, integer, integer),
  public.erp_portal_create_buyer_po(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
commit;
