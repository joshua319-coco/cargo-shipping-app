export type Carrier = "대신" | "로젠";
export type CarrierFilter = "전체" | Carrier;

export const CARRIERS: Carrier[] = ["대신", "로젠"];

// 운송사 컬럼 도입 전의 출고와 발송 이력은 모두 대신 데이터다.
export function normalizeCarrier(value: unknown): Carrier {
  return value === "로젠" ? "로젠" : "대신";
}

export function isLogenQuantity(value: string | number) {
  const qty = Number(value);
  return Number.isSafeInteger(qty) && qty > 0;
}

export function logenFare(qty: string | number, address = "") {
  if (!isLogenQuantity(qty)) return "";
  const jeju = /제주|서귀포/.test(address.replace(/\s/g, ""));
  return String(Number(qty) * 3300 + (jeju ? 3000 : 0));
}

export function exportCarrier(
  filter: CarrierFilter,
  rows: { carrier?: Carrier }[],
): Carrier | null {
  if (filter === "전체" || rows.length === 0) return null;
  return rows.every((row) => normalizeCarrier(row.carrier) === filter)
    ? filter
    : null;
}

export function sameCarrierText(a: string, b: string) {
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").trim();
  return normalize(a) === normalize(b);
}

export function sameCarrierPhone(a: string, b: string) {
  // 엑셀 숫자 셀로 읽힌 국내 전화번호의 선행 0을 복원한다.
  const normalize = (value: string) => {
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("82")) digits = "0" + digits.slice(2).replace(/^0/, "");
    if (digits && !digits.startsWith("0")) digits = "0" + digits;
    return digits;
  };
  return normalize(a) === normalize(b);
}
