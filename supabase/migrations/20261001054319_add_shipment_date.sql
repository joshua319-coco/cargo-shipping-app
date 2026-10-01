-- Keep the actual registration timestamp; shipment_date is the planned shipping day in Korea.
SET lock_timeout = '5s';
ALTER TABLE public.shipments ADD COLUMN shipment_date date;
UPDATE public.shipments
SET shipment_date = (created_at AT TIME ZONE 'Asia/Seoul')::date
WHERE shipment_date IS NULL;
ALTER TABLE public.shipments
  ALTER COLUMN shipment_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  ALTER COLUMN shipment_date SET NOT NULL;
CREATE INDEX shipments_shipment_date_idx ON public.shipments (shipment_date);
COMMENT ON COLUMN public.shipments.shipment_date IS '출고 예정일(한국 날짜). 실제 등록 시각 created_at과 별도로 관리한다.';
