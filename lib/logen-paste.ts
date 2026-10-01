// 로젠 주문등록 화면 전체 행을 복사한 탭 구분 데이터(A~AB 이상).
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
    if (columns.length < 28) {
      throw new Error(`${index + 1}번째 행의 열이 부족합니다. 로젠 주문등록 화면에서 A열부터 AB열까지 포함한 전체 행을 복사해 주세요.`);
    }
    const rawPay = value(15);
    const number = (column: number) => Number(value(column).replace(/[,원\s]/g, "")) || 0;
    const waybill = value(4);
    const waybillNo = /^\d+(?:\.\d+)?e\+?\d+$/i.test(waybill)
      ? String(Number(waybill))
      : waybill.replace(/[\s-]/g, "");
    return [{
      id: `로젠-paste-${index + 1}`,
      carrier: "로젠" as const,
      waybillNo,                              // E
      receiver: value(8),                      // I
      address: [value(9), value(10)].filter(Boolean).join(" "), // J + K
      receiverPhone: value(11),                // L
      qty: number(13),                        // N
      fare: number(14),                       // O
      rawPay,                                 // P
      pay: (["신용", "선불", "현불"].includes(rawPay) ? "선불" : "착불") as "선불" | "착불",
      memo: value(19),                         // T
      sender: value(24),                       // Y
      senderPhone: value(27),                  // AB
      delivery: "택배" as const,
      branch: "",
      raw: {} as Record<string, unknown>,
    }];
  });
}
