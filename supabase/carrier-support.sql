-- 기존 출고/대신 발송 이력을 보존하는 추가 변경이다.
ALTER TABLE public.shipments
  ADD COLUMN carrier text NOT NULL DEFAULT '대신'
    CHECK (carrier IN ('대신', '로젠'));

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_logen_parcel_quantity_check
  CHECK (carrier <> '로젠' OR (delivery = '택배' AND qty >= 1 AND qty = trunc(qty)));

ALTER TABLE public.shared_verify_state
  ADD COLUMN logen_upload_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN logen_upload_file_name text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.shipments.carrier IS '운송사: 기존 출고는 대신, 신규 운송사는 로젠';
COMMENT ON COLUMN public.shared_verify_state.logen_upload_rows IS '로젠 발송데이터. 대신 발송데이터와 독립적으로 업로드/초기화한다.';

-- 로젠은 엑셀 업로드 대신 원본 화면의 복사 데이터를 사용한다.
ALTER TABLE public.shared_verify_state
  ADD COLUMN logen_paste_text text NOT NULL DEFAULT '';
