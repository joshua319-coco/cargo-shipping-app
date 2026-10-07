-- Registration identity belongs to the shipment, not its editable fare/quantity.
alter table public.shipments add column if not exists daesin_registration jsonb;
create unique index if not exists shipments_daesin_waybill_unique
  on public.shipments ((daesin_registration->>'waybillNo'))
  where daesin_registration->>'waybillNo' <> '';

-- Uses the existing shared-company shipments RLS. No elevated database privileges.
create or replace function public.daesin_registration_update(
  p_shipment_id bigint, p_action text, p_data jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  shipment public.shipments%rowtype;
  previous jsonb;
  next_state jsonb;
  snapshot jsonb;
  claimed boolean := false;
  number text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  select * into shipment from public.shipments where id = p_shipment_id for update;
  if not found or coalesce(shipment.carrier, '대신') <> '대신' then
    raise exception '대신 출고건을 찾지 못했습니다.';
  end if;
  previous := coalesce(shipment.daesin_registration, '{}'::jsonb);
  snapshot := jsonb_build_object(
    'receiver',coalesce(shipment.receiver,''),'receiver_phone',coalesce(shipment.receiver_phone,''),
    'sender',coalesce(shipment.sender,'상화시스템'),'sender_phone',coalesce(shipment.sender_phone,'03180595618'),
    'address',coalesce(shipment.address,''),'branch',coalesce(shipment.branch,''),
    'postal_code',coalesce(shipment.postal_code,''),'item',coalesce(shipment.item,'부품'),
    'pack',coalesce(shipment.pack,'박스'),'qty',shipment.qty,'fare',shipment.fare,
    'pay',shipment.pay,'delivery',shipment.delivery,'memo',coalesce(shipment.memo,''),
    'shipment_date',shipment.shipment_date);
  if p_action = 'claim' then
    if snapshot is distinct from p_data->'snapshot' then raise exception '출고정보가 변경되었습니다. 새로고침 후 다시 연동해 주세요.'; end if;
    if previous <> '{}'::jsonb and not (
      previous->>'state' = 'not-registered' and p_data->>'retry' = 'true'
      and previous->>'fingerprint' is distinct from p_data->>'fingerprint'
    ) then return jsonb_build_object('claimed',false,'registration',previous); end if;
    if coalesce(p_data->>'attemptId','') !~ '^[a-f0-9-]{36}$' or coalesce(p_data->>'fingerprint','') !~ '^[a-f0-9]{64}$' then raise exception '잘못된 접수 요청입니다.'; end if;
    next_state := jsonb_build_object('state','pending','attemptId',p_data->>'attemptId',
      'fingerprint',p_data->>'fingerprint','snapshot',snapshot,'shipmentDate',shipment.shipment_date,
      'waybillNo','','message','접수 결과 확인 중','previousAttempt',previous - 'previousAttempt');
    claimed := true;
  elsif p_action in ('result','adopt') then
    if p_action = 'result' and (previous = '{}'::jsonb or previous->>'attemptId' is distinct from p_data->>'attemptId') then
      return jsonb_build_object('claimed',false,'registration',previous);
    end if;
    -- Legacy extension results may recover a pending claim after page/browser restart.
    if p_action = 'adopt' and previous <> '{}'::jsonb and previous->>'attemptId' is distinct from p_data->>'attemptId' then
      return jsonb_build_object('claimed',false,'registration',previous);
    end if;
    if coalesce(p_data->>'state','') not in ('pending','unknown','registered','not-registered') then raise exception '잘못된 등록 상태입니다.'; end if;
    if previous->>'state' = 'registered' and p_data->>'state' <> 'registered' then
      return jsonb_build_object('claimed',false,'registration',previous);
    end if;
    if previous->>'state' = 'not-registered' and p_data->>'state' in ('pending','unknown') then
      return jsonb_build_object('claimed',false,'registration',previous);
    end if;
    number := coalesce(p_data->>'waybillNo','');
    if number <> '' and number !~ '^[0-9]{12,13}$' then raise exception '송장번호 형식이 올바르지 않습니다.'; end if;
    if coalesce(previous->>'waybillNo','') <> '' and number <> '' and previous->>'waybillNo' <> number then raise exception '이미 연결된 송장번호를 바꿀 수 없습니다.'; end if;
    next_state := previous || jsonb_build_object(
      'state',case when number <> '' then 'registered' else p_data->>'state' end,
      'attemptId',coalesce(previous->>'attemptId',p_data->>'attemptId'),
      'fingerprint',coalesce(previous->>'fingerprint',p_data->>'fingerprint'),
      'snapshot',coalesce(previous->'snapshot',snapshot),
      'shipmentDate',coalesce(previous->>'shipmentDate',p_data->>'shipmentDate',shipment.shipment_date::text),
      'waybillNo',coalesce(nullif(number,''),previous->>'waybillNo',''),
      'message',left(coalesce(p_data->>'message',''),1000),
      'destinationNeedsReview',coalesce((p_data->>'destinationNeedsReview')::boolean,false),
      'destinationReason',left(coalesce(p_data->>'destinationReason',''),200));
  else raise exception '지원하지 않는 등록 작업입니다.';
  end if;
  next_state := next_state || jsonb_build_object('updatedAt',clock_timestamp());
  update public.shipments set daesin_registration = next_state where id = p_shipment_id;
  return jsonb_build_object('claimed',claimed,'registration',next_state);
end;
$$;
revoke all on function public.daesin_registration_update(bigint,text,jsonb) from public, anon;
grant execute on function public.daesin_registration_update(bigint,text,jsonb) to authenticated;
