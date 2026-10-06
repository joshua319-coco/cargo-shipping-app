// 로젠 주문등록 화면 전체 행을 복사한 탭 구분 데이터.
// 중간 빈 셀과 따옴표 안의 탭/줄바꿈을 보존해야 열 위치가 변하지 않는다.
export function readClipboardTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  const finishRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
    cell = "";
  };
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (quoted || cell === "") quoted = !quoted;
      else cell += char;
    } else if (char === "\t" && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      finishRow();
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("복사 데이터의 따옴표가 닫히지 않았습니다. 전체 행을 다시 복사해 주세요.");
  finishRow();
  return rows;
}

export function parseLogenPasteRows(text: string) {
  const records = readClipboardTable(text);
  return records.flatMap((columns, index) => {
    const value = (column: number) => (columns[column] ?? "").trim().replace(/^'/, "");
    // 제목 행을 함께 복사한 경우도 허용한다. 데이터 열을 임의로 옮기지 않는다.
    if (/^(운송장번호|송장번호)$/.test(value(4).replace(/\s/g, ""))) return [];
    if (columns.length < 27) {
      throw new Error(`${index + 1}번째 행의 열이 부족합니다. 로젠 주문등록 화면에서 송하인 전화번호까지 포함한 전체 행을 복사해 주세요.`);
    }
    // 확인된 두 형식: 수하인 I열(기존), H열(현재). 송장번호 E열은 동일하다.
    // 열 개수는 끝에 붙는 출력정보에 따라 달라져 판별 기준으로 삼지 않는다.
    // 연속된 수량·운임·운임구분으로 위치를 확인하고, 알 수 없는 형식은 저장하지 않는다.
    const numericCell = (column: number) => /^\d+(?:\.\d+)?$/.test(value(column).replace(/[,원\s]/g, ""));
    const offsets = [0, -1].filter(offset =>
      columns.length >= 28 + offset && numericCell(13 + offset) && numericCell(14 + offset) &&
      ["", "신용", "선불", "현불", "착불"].includes(value(15 + offset).replace(/\s/g, ""))
    );
    if (offsets.length !== 1) {
      throw new Error(`${index + 1}번째 행의 수량·운임·운임구분 열을 확인할 수 없습니다. 로젠 주문등록 화면의 전체 행을 다시 복사해 주세요.`);
    }
    const offset = offsets[0];
    const field = (column: number) => value(column + offset);
    const rawPay = field(15).replace(/\s/g, "");
    const number = (column: number) => Number(field(column).replace(/[,원\s]/g, "")) || 0;
    const waybill = value(4);
    const waybillNo = /^\d+(?:\.\d+)?e\+?\d+$/i.test(waybill)
      ? String(Number(waybill))
      : waybill.replace(/[\s-]/g, "");
    return [{
      id: `로젠-paste-${index + 1}`,
      carrier: "로젠" as const,
      waybillNo,
      receiver: field(8),
      address: [field(9), field(10)].filter(Boolean).join(" "),
      receiverPhone: field(11),
      qty: number(13),
      fare: number(14),
      rawPay,
      pay: (["신용", "선불", "현불"].includes(rawPay) ? "선불" : "착불") as "선불" | "착불",
      memo: field(19),
      sender: field(24),
      senderPhone: field(27),
      delivery: "택배" as const,
      branch: "",
      raw: {} as Record<string, unknown>,
    }];
  });
}
