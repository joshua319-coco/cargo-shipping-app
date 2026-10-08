export type DeletedDaesinRegistration = {
  attemptId: string; waybillNo: string; shipmentDate: string;
  receiver: string; receiverPhone: string;
};
export type DaesinRegistration = {
  state: 'pending' | 'unknown' | 'registered' | 'not-registered';
  attemptId: string; fingerprint?: string; shipmentDate: string;
  waybillNo: string; message: string; destinationNeedsReview?: boolean;
  destinationReason?: string; updatedAt?: string;
  carrierMissing?: boolean; carrierCheckedAt?: string; carrierCheckedDate?: string;
  snapshot?: { receiver?: string; receiver_phone?: string };
  retiredWaybills?: string[]; deletedRegistration?: DeletedDaesinRegistration;
};
export type DaesinSource = {
  id: string; carrier: string; shipmentDate: string; receiver: string; receiverPhone: string;
  qty: string; fare: string; delivery: string; pay: string; daesinRegistration?: DaesinRegistration;
};
export type DaesinDailyRow = {
  waybill_no: string; arrival_name: string; arrival_agencycode: string;
  arrival_phone_number1?: string; quantity?: string; supply_price?: string; tax_amount?: string;
  transit_mode?: string; payment_mode?: string;
};
export type DaesinJob = {
  id: string; attemptId?: string; fingerprint?: string; shipmentId: string; shipmentDate: string;
  receiver: string; state: string; numbers: string[]; registered?: boolean;
  message: string; destinationNeedsReview?: boolean; destinationReason?: string; lookupMessage?: string;
};
const text = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s/g, '');
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
export const validDaesinDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export function daesinInputIssues(source: { receiver: string; receiverPhone: string; shipmentDate: string }, postalCode: unknown, quantity: unknown) {
  const issues: string[] = [];
  if (!/^\d{5}$/.test(String(postalCode ?? ''))) issues.push('도착지 우편번호가 없거나 올바르지 않습니다. 출고정보 수정에서 5자리 우편번호를 확인해 주세요.');
  if (!source.receiver.trim()) issues.push('수화주명을 입력해 주세요.');
  if (!source.receiverPhone.trim()) issues.push('수화주 전화번호를 입력해 주세요.');
  if (!Number.isFinite(Number(quantity)) || Number(quantity) < 1) issues.push('박스 수량을 1개 이상 입력해 주세요.');
  if (!validDaesinDate(source.shipmentDate)) issues.push('출고일자를 확인해 주세요.');
  return issues;
}
export function registrationFromJob(job: DaesinJob): DaesinRegistration {
  const registered = job.registered || job.numbers.length === 1;
  return {
    attemptId: job.attemptId || job.id, fingerprint: job.fingerprint, shipmentDate: job.shipmentDate,
    state: registered ? 'registered' : job.state === 'not-registered' ? 'not-registered' :
      ['unknown','needs-review'].includes(job.state) ? 'unknown' : 'pending',
    waybillNo: job.numbers.length === 1 ? job.numbers[0] : '', message: job.message,
    destinationNeedsReview: job.destinationNeedsReview, destinationReason: job.destinationReason,
  };
}
export function mayRegister(state: DaesinRegistration | undefined, fingerprint: string, retry: boolean) {
  return !state || (state.state === 'not-registered' && retry && state.fingerprint !== fingerprint);
}
// For initial linkage only. An established waybill is the identity after any edits.
export function findDaesinCandidate(source: DaesinSource, rows: DaesinDailyRow[], peers: DaesinSource[]) {
  const known = source.daesinRegistration?.waybillNo;
  if (known) return { row: rows.find(row => row.waybill_no === known), possible: true };
  const identity = (row: DaesinDailyRow, peer: DaesinSource) =>
    text(row.arrival_name) === text(peer.receiver) && Boolean(digits(peer.receiverPhone)) &&
    digits(row.arrival_phone_number1) === digits(peer.receiverPhone);
  if (rows.some(row => source.daesinRegistration?.retiredWaybills?.includes(row.waybill_no))) return { row:undefined, possible:true };
  const candidates = rows.filter(row => identity(row, source));
  if (candidates.length !== 1) return { row: undefined, possible: candidates.length > 0 };
  const row = candidates[0];
  const owners = peers.filter(peer => peer.carrier === '대신' && peer.shipmentDate === source.shipmentDate && identity(row, peer));
  const reserved = peers.some(peer => peer.id !== source.id && peer.daesinRegistration?.waybillNo === row.waybill_no);
  const exact = owners.length === 1 && !reserved && /^\d{12,13}$/.test(row.waybill_no) &&
    Number(row.quantity) === Math.ceil(Number(source.qty)) &&
    Number(row.supply_price) + Number(row.tax_amount) === Number(source.fare.replace(/,/g,'')) &&
    (row.transit_mode === '1' ? '정기' : row.transit_mode === '2' ? '택배' : '') === source.delivery &&
    (row.payment_mode === '1' ? '선불' : row.payment_mode === '2' ? '착불' : '') === source.pay;
  return { row: exact ? row : undefined, possible: true };
}

// A missing row alone never authorizes a replay. This check is used only after user confirmation.
export function deletedDaesinConflict(source: DaesinSource, rows: DaesinDailyRow[], previous: DaesinRegistration) {
  const identities = [[source.receiver, source.receiverPhone], [previous.snapshot?.receiver, previous.snapshot?.receiver_phone]];
  return rows.some(row => row.waybill_no === previous.waybillNo || identities.some(([name, phone]) =>
    Boolean(text(name)) && text(row.arrival_name) === text(name) && (!digits(phone) || digits(row.arrival_phone_number1) === digits(phone))));
}

export type DaesinVerification = { waybillNo: string; status: string; reasons: string[] };
export function daesinRegistrationView(state?: DaesinRegistration, verification?: DaesinVerification) {
  if (state?.carrierMissing && state.waybillNo) return {
    label: '정보확인', registered: true, waybillNo: '',
    reasons: ['대신 최신 조회에서 기존 접수를 찾지 못했습니다. 대신에서 삭제한 건인지 확인해 주세요.'],
  };
  if (verification && state?.retiredWaybills?.includes(verification.waybillNo)) verification = undefined;
  const reasons: string[] = [];
  const registered = state?.state === 'registered' || Boolean(state?.waybillNo) || Boolean(verification?.waybillNo);
  if (state?.destinationNeedsReview) reasons.push((state.destinationReason || '도착지 미지정') + ' · 대신 마감관리에서 도착영업소 수정 필요');
  if (verification?.status === '확인필요') reasons.push(...verification.reasons);
  if (state?.state === 'pending' || state?.state === 'unknown') reasons.push(state.message || '접수 결과를 확인해야 합니다. 전산 데이터 새로고침으로 확인해 주세요.');
  if (registered && !verification) reasons.push('등록은 완료됐습니다. 전산 데이터 새로고침으로 송장번호와 상세정보를 확인해 주세요.');
  const label = reasons.length ? '정보확인' : registered ? '등록완료' : '미등록';
  if (label === '미등록' && state?.state === 'not-registered') reasons.push(state.message || '등록되지 않았습니다. 출고정보를 수정한 뒤 다시 등록해 주세요.');
  return { label, registered, reasons: [...new Set(reasons)], waybillNo: state?.waybillNo || verification?.waybillNo || '' };
}
