-- Preserve every physical attempt. Ordinary PDA toggles still cannot repeat a sent/unknown label.
alter table public.daesin_print_jobs add column attempt_no integer not null default 1 check(attempt_no>0);
alter table public.daesin_print_jobs add column reprint_of uuid references public.daesin_print_jobs(id);
create index daesin_print_reprint_origin on public.daesin_print_jobs(reprint_of);
alter table public.daesin_print_jobs drop constraint daesin_print_jobs_shipment_id_waybill_no_key;
alter table public.daesin_print_jobs add constraint daesin_print_attempt_unique unique(shipment_id,waybill_no,attempt_no);

create or replace function public.daesin_print_publish(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.daesin_print_jobs%rowtype; summary jsonb;
begin
 select * into j from public.daesin_print_jobs where id=p_id;
 if not found then return null; end if;
 summary:=jsonb_build_object('id',j.id,'waybillNo',j.waybill_no,'state',j.state,'message',j.message,'updatedAt',j.updated_at,'attemptNo',j.attempt_no,'reprint',j.reprint_of is not null);
 -- Delayed callbacks from an older attempt/retired waybill cannot overwrite current UI state.
 update public.shipments s set daesin_print=summary where s.id=j.shipment_id
  and s.daesin_registration->>'waybillNo'=j.waybill_no
  and not exists(select 1 from public.daesin_print_jobs newer where newer.shipment_id=j.shipment_id and newer.waybill_no=j.waybill_no and newer.attempt_no>j.attempt_no);
 return summary;
end; $$;

create or replace function public.daesin_print_request(p_shipment_id bigint,p_checked boolean,p_waybill_no text,p_snapshot jsonb default null,p_labels jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.shipments%rowtype; j public.daesin_print_jobs%rowtype; snap jsonb;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 perform 1 from public.daesin_print_station_state where id=true for update;
 select * into s from public.shipments where id=p_shipment_id for update;
 if not found or s.carrier<>'대신' then raise exception '대신 출고건만 자동 출력할 수 있습니다.'; end if;
 select * into j from public.daesin_print_jobs where shipment_id=s.id and waybill_no=p_waybill_no order by attempt_no desc limit 1 for update;
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
 -- A cancelled or pre-dispatch blocked attempt gets a fresh ID; the old journal stays immutable.
 insert into public.daesin_print_jobs(shipment_id,waybill_no,state,snapshot,labels,message,attempt_no)
 values(s.id,p_waybill_no,'queued',snap,p_labels,'공용 프린터 출력 대기',coalesce(j.attempt_no,0)+1)
 returning * into j;
 update public.shipments set pda=true where id=s.id;
 return jsonb_build_object('checked',true,'print',public.daesin_print_publish(j.id));
end; $$;

create function public.daesin_print_reprint(p_shipment_id bigint,p_waybill_no text,p_previous_job_id uuid,p_request_id uuid,p_snapshot jsonb default null,p_labels jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.shipments%rowtype; j public.daesin_print_jobs%rowtype; existing public.daesin_print_jobs%rowtype; snap jsonb;
begin
 if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
 if p_request_id is null or p_previous_job_id is null then raise exception '재출력 확인 화면을 다시 열어 주세요.'; end if;
 perform 1 from public.daesin_print_station_state where id=true for update;
 select * into s from public.shipments where id=p_shipment_id for update;
 if not found or s.carrier<>'대신' then raise exception '대신 출고건만 재출력할 수 있습니다.'; end if;
 -- Retrying a lost enqueue response returns the SAME job, even if another request has since completed.
 select * into existing from public.daesin_print_jobs where id=p_request_id;
 if found then
  if existing.shipment_id<>s.id or existing.waybill_no<>p_waybill_no or existing.reprint_of is distinct from p_previous_job_id then raise exception '다른 재출력 요청입니다.'; end if;
  return jsonb_build_object('print',public.daesin_print_publish(existing.id));
 end if;
 if p_waybill_no is null or p_waybill_no !~ '^[0-9]{12,13}$'
  or coalesce(s.daesin_registration->>'state','')<>'registered'
  or coalesce(s.daesin_registration->>'waybillNo','')<>p_waybill_no
  or s.daesin_registration->>'carrierMissing'='true' or s.daesin_registration->>'destinationNeedsReview'='true'
 then raise exception '대신 전산등록과 도착지를 먼저 확인해 주세요.'; end if;
 select * into j from public.daesin_print_jobs where shipment_id=s.id and waybill_no=p_waybill_no order by attempt_no desc limit 1 for update;
 if not found or j.id is distinct from p_previous_job_id then raise exception '다른 자리에서 출력 상태가 변경되었습니다. 목록을 새로고침해 주세요.'; end if;
 if j.state not in ('sent','unknown') then raise exception '이미 출력 대기 중이거나 처리 중입니다. 현재 출력 상태를 확인해 주세요.'; end if;
 snap:=public.daesin_print_snapshot(s.id);
 if p_snapshot is not null and snap is distinct from p_snapshot then raise exception '출고정보가 변경되었습니다. 재출력 화면을 다시 열어 확인해 주세요.'; end if;
 if p_labels is null then return jsonb_build_object('needsPreparation',true,'snapshot',snap,'previousSnapshot',j.snapshot,'previousState',j.state); end if;
 if p_snapshot is null or jsonb_typeof(p_labels)<>'array' or jsonb_array_length(p_labels)<>ceil(s.qty)
  or ceil(s.qty) not between 1 and 99 or octet_length(p_labels::text)>2000000 then raise exception '현재 박스 수와 재출력 데이터를 확인해 주세요.'; end if;
 insert into public.daesin_print_jobs(id,shipment_id,waybill_no,state,snapshot,labels,message,attempt_no,reprint_of)
 values(p_request_id,s.id,p_waybill_no,'queued',snap,p_labels,'운송장 재출력 대기 · 현재 '||ceil(s.qty)::text||'장',j.attempt_no+1,j.id)
 returning * into existing;
 update public.shipments set pda=true where id=s.id;
 return jsonb_build_object('print',public.daesin_print_publish(existing.id));
end; $$;
revoke all on function public.daesin_print_reprint(bigint,text,uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.daesin_print_reprint(bigint,text,uuid,uuid,jsonb,jsonb) to authenticated;
