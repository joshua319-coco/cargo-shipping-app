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

export function logenFare(qty: string | number, address = "", pay: "착불" | "선불" = "착불") {
  if (!isLogenQuantity(qty)) return "";
  const jeju = /제주|서귀포/.test(address.replace(/\s/g, ""));
  const perBox = pay === "선불" ? 3300 : 3500;
  return String(Number(qty) * perBox + (jeju ? 3000 : 0));
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

// 시·도는 제거하지 않고 정식 명칭/약칭만 통일한다. 시·군·구와 건물번호는 남긴다.
const ADDRESS_REGION_ALIASES: Record<string, string> = {
  서울특별시: "서울", 서울시: "서울",
  부산광역시: "부산", 부산시: "부산",
  대구광역시: "대구", 대구시: "대구",
  인천광역시: "인천", 인천시: "인천",
  광주광역시: "광주",
  대전광역시: "대전", 대전시: "대전",
  울산광역시: "울산", 울산시: "울산",
  세종특별자치시: "세종", 세종시: "세종",
  경기도: "경기",
  강원특별자치도: "강원", 강원도: "강원",
  충청북도: "충북", 충청남도: "충남",
  전북특별자치도: "전북", 전라북도: "전북", 전라남도: "전남",
  경상북도: "경북", 경상남도: "경남",
  제주특별자치도: "제주", 제주도: "제주",
};

export function normalizeParcelAddress(value: string) {
  // NFKC는 전각 괄호도 처리한다. 지번/건물명/상세주소가 붙는 첫 괄호부터 제외한다.
  const normalized = value.normalize("NFKC");
  let beforeDetails = normalized.split("(")[0].trim();
  // 로젠은 읍·면을 도로명 앞에서 첫 괄호 안으로 옮기기도 한다.
  // 없애서 비교하지 않고 해당 읍·면을 복원하여 다른 지역과 구분한다.
  // 쉼표 상세주소도 도로명과 건물번호가 확인된 경우에만 제외한다.
  const road = beforeDetails.match(/^(.+?)\s+([^\s]+(?:대로|로|길)(?:\s+\d+번길)?)\s+(\d+(?:-\d+)?)(?:,\s*.*)?$/);
  if (road) {
    const [, region, roadName, buildingNumber] = road;
    const localityPattern = /(?:^|\s)([^\s]+(?:읍|면))(?=\s|$)/;
    const parenthetical = normalized.match(/\(([^)]*)\)/)?.[1] ?? "";
    const locality = !localityPattern.test(region) ? parenthetical.match(localityPattern)?.[1] : "";
    beforeDetails = [region, locality, roadName, buildingNumber].filter(Boolean).join(" ");
  }
  const tokens = beforeDetails.split(/\s+/);
  tokens[0] = ADDRESS_REGION_ALIASES[tokens[0]] ?? tokens[0];
  // 하이픈을 보존해야 1-5와 15가 다른 건물번호로 비교된다.
  return tokens.join("").toLowerCase();
}

export function sameParcelAddress(a: string, b: string) {
  const left = normalizeParcelAddress(a);
  const right = normalizeParcelAddress(b);
  return Boolean(left && right && left === right);
}
