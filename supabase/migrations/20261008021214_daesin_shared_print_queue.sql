-- One shared company, using the existing shipments access policy. No service-role client.
alter table public.shipments add column if not exists daesin_print jsonb;
create table public.daesin_print_jobs (
  id uuid primary key default gen_random_uuid(),
  shipment_id bigint not null references public.shipments(id) on delete cascade,
  waybill_no text not null check (waybill_no ~ '^[0-9]{12,13}$'),
  state text not null check(state in ('queued','claimed','sending','sent','blocked','unknown','cancelled')),
  snapshot jsonb not null, labels jsonb not null,
  requested_by uuid not null default auth.uid(), station_id uuid, token uuid,
  message text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(shipment_id,waybill_no)
);
create index daesin_print_waiting on public.daesin_print_jobs(created_at) where state in ('queued','claimed','sending');
alter table public.daesin_print_jobs enable row level security;
create policy company_shipment_prints on public.daesin_print_jobs for all to authenticated
 using (exists(select 1 from public.shipments s where s.id=shipment_id))
 with check (exists(select 1 from public.shipments s where s.id=shipment_id and s.carrier='대신'));
create table public.daesin_print_station_state (
 id boolean primary key default true check(id), station_id uuid, heartbeat_at timestamptz,
 message text not null default ''
);
insert into public.daesin_print_station_state(id) values(true);
alter table public.daesin_print_station_state enable row level security;
-- Same company-wide authorization as shipments; no anonymous access.
create policy company_printer on public.daesin_print_station_state for all to authenticated
 using (exists(select 1 from public.shipments where carrier='대신'))
 with check (exists(select 1 from public.shipments where carrier='대신'));
revoke all on public.daesin_print_jobs,public.daesin_print_station_state from anon;
grant select,insert,update,delete on public.daesin_print_jobs to authenticated;
grant select,update on public.daesin_print_station_state to authenticated;

create function public.daesin_print_snapshot(p_id bigint) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('receiver',s.receiver,'receiverPhone',s.receiver_phone,
  'sender',s.sender,'senderPhone',s.sender_phone,'qty',ceil(s.qty),'fare',s.fare,
  'delivery',s.delivery,'pay',s.pay,'address',coalesce(s.address,''),'branch',coalesce(s.branch,''),
  'shipmentDate',s.shipment_date,'item',s.item,'pack',s.pack,'memo',coalesce(s.memo,''))
 from public.shipments s where s.id=p_id;
$$;
create function public.daesin_print_publish(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.daesin_print_jobs%rowtype; summary jsonb;
begin
 select * into j from public.daesin_print_jobs where id=p_id;
 summary:=jsonb_build_object('id',j.id,'waybillNo',j.waybill_no,'state',j.state,'message',j.message,'updatedAt',j.updated_at);
 update public.shipments set daesin_print=summary where id=j.shipment_id;
 return summary;
end; $$;

create function public.daesin_print_request(p_shipment_id bigint,p_checked boolean,p_waybill_no text,p_snapshot jsonb default null,p_labels jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.shipments%rowtype; j public.daesin_print_jobs%rowtype; snap jsonb;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 perform 1 from public.daesin_print_station_state where id=true for update;
 select * into s from public.shipments where id=p_shipment_id for update;
 if not found or s.carrier<>'대신' then raise exception '대신 출고건만 자동 출력할 수 있습니다.'; end if;
 select * into j from public.daesin_print_jobs where shipment_id=s.id and waybill_no=p_waybill_no for update;
 if not p_checked then
  update public.shipments set pda=false where id=s.id;
  if j.state in ('queued','claimed','blocked') then
   update public.daesin_print_jobs set state='cancelled',message='PDA 체크 해제로 출력 대기를 취소했습니다.',labels='[]',updated_at=clock_timestamp() where id=j.id;
   perform public.daesin_print_publish(j.id);
  end if;
  return jsonb_build_object('checked',false);
 end if;
 if coalesce(s.daesin_registration->>'state','')<>'registered'
  or coalesce(s.daesin_registration->>'waybillNo','')<>p_waybill_no or p_waybill_no !~ '^[0-9]{12,13}$'
  or s.daesin_registration->>'carrierMissing'='true' or s.daesin_registration->>'destinationNeedsReview'='true'
 then raise exception '대신 전산등록과 도착지를 먼저 확인해 주세요.'; end if;
 if j.state in ('queued','claimed','sending','sent','unknown') then
  update public.shipments set pda=true where id=s.id;
  return jsonb_build_object('checked',true,'print',public.daesin_print_publish(j.id));
 end if;
 snap:=public.daesin_print_snapshot(s.id);
 if p_labels is null then return jsonb_build_object('needsPreparation',true,'snapshot',snap); end if;
 if snap is distinct from p_snapshot then raise exception '출고정보가 변경되었습니다. 새로고침 후 PDA를 다시 체크해 주세요.'; end if;
 if jsonb_typeof(p_labels)<>'array' or jsonb_array_length(p_labels)<>ceil(s.qty) or ceil(s.qty) not between 1 and 99
  or octet_length(p_labels::text)>2000000 then raise exception '송장 출력 데이터 또는 수량을 확인해 주세요.'; end if;
 insert into public.daesin_print_jobs(shipment_id,waybill_no,state,snapshot,labels,message)
 values(s.id,p_waybill_no,'queued',snap,p_labels,'공용 프린터 출력 대기')
 on conflict(shipment_id,waybill_no) do update set state='queued',snapshot=excluded.snapshot,labels=excluded.labels,
  message=excluded.message,token=null,station_id=null,requested_by=auth.uid(),created_at=clock_timestamp(),updated_at=clock_timestamp()
 returning * into j;
 update public.shipments set pda=true where id=s.id;
 return jsonb_build_object('checked',true,'print',public.daesin_print_publish(j.id));
end; $$;

create function public.daesin_print_worker(p_station_id uuid,p_action text,p_job_id uuid default null,p_token uuid default null,p_result jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare station public.daesin_print_station_state%rowtype; j public.daesin_print_jobs%rowtype; s public.shipments%rowtype; bad text;
begin
 if auth.uid() is null or p_station_id is null then raise exception '로그인이 필요합니다.'; end if;
 select * into station from public.daesin_print_station_state where id=true for update;
 if not found then raise exception '출력 PC 설정에 접근할 수 없습니다.'; end if;
 if p_action='heartbeat' then
  if station.station_id is distinct from p_station_id and station.heartbeat_at>now()-interval '2 minutes' then raise exception '다른 출력 PC가 작동 중입니다.'; end if;
  update public.daesin_print_station_state set station_id=p_station_id,heartbeat_at=clock_timestamp(),message=left(coalesce(p_result->>'message','출력 대기 중'),300) where id=true;
  return jsonb_build_object('ok',true);
 end if;
 if station.station_id is distinct from p_station_id then raise exception '지정된 출력 PC가 아닙니다.'; end if;
 if p_action='stop' then
  update public.daesin_print_station_state set heartbeat_at=null,message='출력 PC 일시정지' where id=true;
  return jsonb_build_object('ok',true);
 end if;
 if station.heartbeat_at is null or station.heartbeat_at<now()-interval '2 minutes' then raise exception '출력 PC 연결을 다시 시작해 주세요.'; end if;
 if p_action='claim' then
  -- A claim can be recovered BEFORE dispatch only. Sending is never automatically replayed.
  for j in select * from public.daesin_print_jobs where state in ('claimed','sending') and updated_at<now()-interval '5 minutes' for update skip locked loop
   update public.daesin_print_jobs set state=case when j.state='claimed' then 'queued' else 'unknown' end,
    message=case when j.state='claimed' then '출력 대기' else '출력 결과 확인 필요: 실제 송장을 확인해 주세요. 자동 재출력하지 않습니다.' end,
    updated_at=clock_timestamp() where id=j.id;
   perform public.daesin_print_publish(j.id);
  end loop;
  if exists(select 1 from public.daesin_print_jobs where state in ('claimed','sending')) then return jsonb_build_object('job',null); end if;
  select * into j from public.daesin_print_jobs where state='queued' order by created_at for update skip locked limit 1;
  if not found then return jsonb_build_object('job',null); end if;
 else
  select * into j from public.daesin_print_jobs where id=p_job_id for update;
  if not found or j.station_id is distinct from p_station_id or j.token is distinct from p_token then raise exception '출력 요청이 변경되었습니다.'; end if;
 end if;
 if p_action in ('claim','sending') then
  if p_action='sending' and j.state<>'claimed' then raise exception '이미 처리되거나 취소된 출력 요청입니다.'; end if;
  select * into s from public.shipments where id=j.shipment_id for update;
  if not found or not coalesce(s.pda,false) then bad:='PDA 체크가 해제되어 출력을 멈췄습니다.';
  elsif s.carrier<>'대신' or s.daesin_registration->>'waybillNo' is distinct from j.waybill_no or s.daesin_registration->>'state'<>'registered'
    or s.daesin_registration->>'carrierMissing'='true' or s.daesin_registration->>'destinationNeedsReview'='true' then bad:='대신 등록 상태가 달라졌습니다. 전산데이터를 새로고침해 주세요.';
  elsif public.daesin_print_snapshot(s.id) is distinct from j.snapshot then bad:='출고정보가 수정되었습니다. 정보를 확인한 뒤 PDA를 해제하고 다시 체크해 주세요.';
  elsif j.created_at<now()-interval '2 hours' then bad:='2시간 이상 지난 출력 요청입니다. PDA를 해제하고 다시 체크해 주세요.';
  end if;
  if bad is not null then
   update public.daesin_print_jobs set state='blocked',message=bad,updated_at=clock_timestamp() where id=j.id;
   perform public.daesin_print_publish(j.id);
   return jsonb_build_object('job',null,'error',bad);
  end if;
  update public.daesin_print_jobs set state=case when p_action='claim' then 'claimed' else 'sending' end,
   station_id=p_station_id,token=case when p_action='claim' then gen_random_uuid() else token end,
   message=case when p_action='claim' then '출력 준비 중' else '프린터로 전송 중' end,updated_at=clock_timestamp() where id=j.id returning * into j;
 elsif p_action='finish' then
  if j.state not in ('claimed','sending') then return jsonb_build_object('print',public.daesin_print_publish(j.id)); end if;
  if p_result->>'state' not in ('sent','unknown','blocked') or (j.state='claimed' and p_result->>'state'<>'blocked') then raise exception '잘못된 출력 결과입니다.'; end if;
  update public.daesin_print_jobs set state=p_result->>'state',message=left(coalesce(p_result->>'message','출력 결과 확인 필요'),500),
   labels=case when p_result->>'state'='sent' then '[]'::jsonb else labels end,updated_at=clock_timestamp() where id=j.id returning * into j;
 else raise exception '지원하지 않는 출력 작업입니다.'; end if;
 perform public.daesin_print_publish(j.id);
 return jsonb_build_object('job',to_jsonb(j));
end; $$;
revoke all on function public.daesin_print_snapshot(bigint),public.daesin_print_publish(uuid),public.daesin_print_request(bigint,boolean,text,jsonb,jsonb),public.daesin_print_worker(uuid,text,uuid,uuid,jsonb) from public,anon;
grant execute on function public.daesin_print_snapshot(bigint),public.daesin_print_publish(uuid),public.daesin_print_request(bigint,boolean,text,jsonb,jsonb),public.daesin_print_worker(uuid,text,uuid,uuid,jsonb) to authenticated;
