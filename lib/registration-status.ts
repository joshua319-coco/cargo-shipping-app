import { daesinRegistrationView } from './daesin-sync';
import type { DaesinRegistration, DaesinVerification } from './daesin-sync';

type RegistrationSource = {
  carrier: string;
  checklist: { waybill: boolean };
  daesinRegistration?: DaesinRegistration;
};

// Logen's local registration marker means its registration Excel was downloaded.
// Printing and assignment of the carrier waybill number happen later.
export function shipmentRegistrationView(shipment: RegistrationSource, verification?: DaesinVerification) {
  if (shipment.carrier !== '로젠') return daesinRegistrationView(shipment.daesinRegistration, verification);
  const registered = shipment.checklist.waybill;
  const reasons = verification?.status === '확인필요'
    ? verification.reasons.filter(reason => reason !== '운송장번호 없음')
    : [];
  return {
    label: reasons.length ? '정보확인' : registered ? '등록완료' : '미등록',
    registered,
    reasons: [...new Set(reasons)],
    waybillNo: verification?.waybillNo || '',
  };
}
