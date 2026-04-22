
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { supabase } from "@/lib/supabase";

type Party = {
  name: string;
  aliases?: string[];
  phone: string;
  address?: string;
  branch?: string;
  note?: string;
  postalCode?: string;
};

type PayType = "착불" | "선불";
type DeliveryType = "정기" | "택배";
type TabType = "출고등록" | "출고목록" | "발송검증" | "운송장문구" | "마스터관리";

type BranchPostalItem = {
  branch: string;
  postalCode: string;
};

type MasterMode = "new" | "edit";

type Checklist = {
  orderSheet: boolean;
  salesSlip: boolean;
  pda: boolean;
  waybill: boolean;
};

type SavedShipment = {
  id: string;
  receiver: string;
  receiverPhone: string;
  address: string;
  branch: string;
  postalCode: string;
  sender: string;
  senderPhone: string;
  item: string;
  pack: string;
  pay: PayType;
  delivery: DeliveryType;
  qty: string;
  fare: string;
  memo: string;
  note: string;
  createdAt: string;
  checklist: Checklist;
};

type WaybillUploadRow = {
  id: string;
  sender: string;
  receiver: string;
  receiverPhone: string;
  address: string;
  qty: number;
  fare: number;
  delivery: DeliveryType;
  pay: PayType;
  branch: string;
  waybillNo: string;
  raw: Record<string, unknown>;
};

type WaybillVerificationStatus = "일치" | "확인필요" | "출고목록만" | "발송데이터만";

type WaybillVerificationRow = {
  id: string;
  status: WaybillVerificationStatus;
  shipmentListName: string;
  uploadListName: string;
  qtyText: string;
  deliveryText: string;
  payText: string;
  fareText: string;
  waybillNo: string;
  reasons: string[];
};

const LEGACY_RECEIVER_MASTER_KEY = "receiver_master_v1";
const LEGACY_SENDER_MASTER_KEY = "sender_master_v1";
const LEGACY_BRANCH_MASTER_KEY = "branch_master_v1";
const MASTER_DB_MIGRATION_KEY = "master_db_migrated_v1";
const WAYBILL_UPLOAD_STORAGE_KEY = "waybill_upload_rows_v1";
const WAYBILL_UPLOAD_FILE_NAME_KEY = "waybill_upload_file_name_v1";

const TEMPLATE_SHEET_NAME = "업로드_양식 값붙여넣기(우클릭+V)";
const TEMPLATE_HEADERS = [
  "수화주전화1",
  "수화주전화2",
  "수화주명",
  "주소",
  "수량",
  "품명",
  "포장",
  "운임구분",
  "운송상품",
  "우편번호",
  "도착영업소",
  "발화주명",
  "발화주전화번호",
  "발송제비용",
  "운임",
  "도착제비용",
  "총운임",
  "특기사항",
  "내품표기1",
  "내품표기2",
  "내품표기3",
  "내품표기4",
  "내품표기5",
  "내품표기6",
  "내품표기7",
  "내품표기8",
  "내품표기9",
  "내품표기10",
  "내품표기11",
  "내품표기12",
  "내품표기13",
] as const;

const initialReceiverList: Party[] = [
  {
    name: "09오토파츠",
    aliases: ["09오토", "09"],
    phone: "0319694122",
    address: "경기도 고양시 덕양구 공양왕길 71-32(원당동)",
    branch: "고양식사",
    note: "",
    postalCode: "10290",
  },
  {
    name: "85모터스",
    aliases: ["청주85모터스"],
    phone: "01053443444",
    address: "충청북도 청주시 청원구 오창읍 중심상업2로 47-31, 1층",
    branch: "오창산단",
    note: "택배발송",
    postalCode: "28119",
  },
  {
    name: "기산",
    aliases: ["기산"],
    phone: "01072330506",
    address: "서울특별시 양천구 중앙로29길 37",
    branch: "신정동",
    note: "택배발송",
    postalCode: "08076",
  },
  {
    name: "광택도금",
    aliases: ["광택도금"],
    phone: "01083746322",
    address: "경기도 안산시 단원구 산단로 241",
    branch: "안산유통",
    note: "택배발송",
    postalCode: "15429",
  },
  {
    name: "동부상사",
    aliases: ["광양동부상사"],
    phone: "01020241697",
    address: "전남 광양시 광양읍 남등1길 127",
    branch: "광양칠성",
    note: "",
    postalCode: "57739",
  },
  {
    name: "대원상사(청주)",
    aliases: ["청주대원상사", "대원상사"],
    phone: "0432326742",
    address: "충청북도 청주시 흥덕구 복대로200번길 9-1",
    branch: "청주복대",
    note: "택배발송",
    postalCode: "28587",
  },
];

const initialSenderList: Party[] = [
  {
    name: "상화시스템",
    aliases: ["상화"],
    phone: "0318059618",
  },
  {
    name: "제로100모터스",
    aliases: ["제로100", "제로백"],
    phone: "025159728",
  },
  {
    name: "브렉스(BREX)",
    aliases: ["브렉스", "brex", "BREX"],
    phone: "0313166038",
  },
  {
    name: "솔로몬오토파츠",
    aliases: ["구미솔로몬오토파츠"],
    phone: "01045663374",
  },
];

const initialBranchPostalMap: Record<string, string> = {
  오창산단: "28116",
  신정동: "07940",
  안산유통: "15431",
  광양칠성: "57740",
  청주복대: "28578",
  고양식사: "10290",
};

function createEmptyChecklist(): Checklist {
  return {
    orderSheet: false,
    salesSlip: false,
    pda: false,
    waybill: false,
  };
}

function normalizeChecklist(raw: any): Checklist {
  return {
    orderSheet:
      raw?.orderSheet ??
      raw?.processOrderPrint ??
      raw?.orderConfirm ??
      false,
    salesSlip:
      raw?.salesSlip ??
      raw?.processSalesSlip ??
      raw?.salesSlipCreate ??
      false,
    pda: raw?.pda ?? raw?.processPda ?? raw?.pdaRegister ?? false,
    waybill:
      raw?.waybill ??
      raw?.closingWaybill ??
      raw?.waybillRegister ??
      false,
  };
}

function normalizeShipment(raw: any): SavedShipment {
  return {
    id: String(raw?.id ?? Date.now()),
    receiver: raw?.receiver ?? "",
    receiverPhone: raw?.receiverPhone ?? raw?.receiver_phone ?? "",
    address: raw?.address ?? "",
    branch: raw?.branch ?? "",
    postalCode: raw?.postalCode ?? raw?.postal_code ?? "",
    sender: raw?.sender ?? "상화시스템",
    senderPhone: raw?.senderPhone ?? raw?.sender_phone ?? "0318059618",
    item: raw?.item ?? "부품",
    pack: raw?.pack ?? "박스",
    pay: raw?.pay === "선불" ? "선불" : "착불",
    delivery: raw?.delivery === "정기" ? "정기" : "택배",
    qty: String(raw?.qty ?? "1"),
    fare: String(raw?.fare ?? "5500"),
    memo: raw?.memo ?? "",
    note: raw?.note ?? "",
    createdAt: raw?.createdAt ?? raw?.created_at ?? new Date().toISOString(),
    checklist: normalizeChecklist(
      raw?.checklist ?? {
        orderSheet: raw?.order_sheet,
        salesSlip: raw?.sales_slip,
        pda: raw?.pda,
        waybill: raw?.waybill,
      }
    ),
  };
}


function normalizeReceiverMasterRows(rows: any[]): Party[] {
  return (rows ?? []).map((row) => ({
    name: row?.name ?? "",
    aliases: Array.isArray(row?.aliases) ? row.aliases : [],
    phone: row?.phone ?? "",
    address: row?.address ?? "",
    branch: row?.branch ?? "",
    note: row?.note ?? "",
    postalCode: row?.postal_code ?? "",
  }));
}

function normalizeSenderMasterRows(rows: any[]): Party[] {
  return (rows ?? []).map((row) => ({
    name: row?.name ?? "",
    aliases: Array.isArray(row?.aliases) ? row.aliases : [],
    phone: row?.phone ?? "",
  }));
}

function normalizeBranchMasterRows(rows: any[]): BranchPostalItem[] {
  return (rows ?? []).map((row) => ({
    branch: row?.branch ?? "",
    postalCode: row?.postal_code ?? "",
  }));
}

function toReceiverMasterRows(items: Party[]) {
  return items.map((item) => ({
    name: item.name,
    aliases: item.aliases ?? [],
    phone: item.phone ?? "",
    address: item.address ?? "",
    branch: item.branch ?? "",
    note: item.note ?? "",
    postal_code: item.postalCode ?? "",
  }));
}

function toSenderMasterRows(items: Party[]) {
  return items.map((item) => ({
    name: item.name,
    aliases: item.aliases ?? [],
    phone: item.phone ?? "",
  }));
}

function toBranchMasterRows(items: BranchPostalItem[]) {
  return items.map((item) => ({
    branch: item.branch,
    postal_code: item.postalCode ?? "",
  }));
}

function matchesParty(item: Party, keyword: string) {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  const pool = [item.name, ...(item.aliases || [])].map((v) => v.toLowerCase());
  return pool.some((text) => text.includes(k));
}

function getMatches(list: Party[], keyword: string) {
  const k = keyword.trim();
  if (!k) return [];
  return list.filter((item) => matchesParty(item, k)).slice(0, 8);
}

function ceilQuantityDisplay(qty: string, pack: string) {
  const num = Number(qty);
  if (!num) return `0${pack}`;
  return `${Math.ceil(num)}${pack}`;
}

function sumCeilQuantity(qty: string) {
  const num = Number(qty);
  if (!num) return 0;
  return Math.ceil(num);
}

function normalizeQtyForCompare(value: unknown) {
  const num = Number(value);
  if (!num) return 0;
  return Math.ceil(num);
}

function displayReceiverName(sender: string, receiver: string) {
  return sender !== "상화시스템" ? `${sender}-${receiver}` : receiver;
}

function parseNumberValue(value: unknown) {
  const text = asString(value).replace(/,/g, "").replace(/원/g, "").replace(/[^0-9.\-]/g, "");
  if (!text) return 0;
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

function normalizeDigits(value: string) {
  return asString(value).replace(/\D/g, "");
}

function normalizeLooseText(value: string) {
  return asString(value)
    .toLowerCase()
    .replace(/상화\s*\/\s*/g, "")
    .replace(/\s+/g, "")
    .replace(/[\[\]\(\){}.,\-_/]/g, "")
    .replace(/주식회사/g, "")
    .replace(/님/g, "");
}

function normalizeAddressText(value: string) {
  return asString(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[\[\]\(\){}.,\-_/]/g, "");
}

function valuesClose(a: string, b: string) {
  const na = normalizeLooseText(a);
  const nb = normalizeLooseText(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function addressesClose(a: string, b: string) {
  const na = normalizeAddressText(a);
  const nb = normalizeAddressText(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function simplifyWaybillSenderName(sender: string) {
  return asString(sender).replace(/^상화\s*\/\s*/g, "").trim();
}

function isMainSenderName(sender: string) {
  const normalized = normalizeLooseText(simplifyWaybillSenderName(sender));
  return !normalized || normalized === normalizeLooseText("상화") || normalized === normalizeLooseText("상화시스템");
}

function buildWaybillListName(sender: string, receiver: string) {
  const safeReceiver = asString(receiver);
  const simplifiedSender = simplifyWaybillSenderName(sender);

  if (!safeReceiver) return "";
  if (isMainSenderName(simplifiedSender)) return safeReceiver;
  return `${simplifiedSender}-${safeReceiver}`;
}

function normalizeWaybillDelivery(value: string): DeliveryType {
  const text = asString(value);
  return text.includes("정기") || text.includes("화물") ? "정기" : "택배";
}

function normalizeWaybillPay(value: string): PayType {
  const text = asString(value).replace(/\s/g, "");
  return text === "현불" || text === "선불" ? "선불" : "착불";
}

function buildWaybillMessageText(params: {
  receiver: string;
  delivery: DeliveryType;
  pay: PayType;
  branch?: string;
  waybillNo: string;
}) {
  const receiverName = asString(params.receiver);
  const waybillNo = asString(params.waybillNo);
  if (!receiverName || !waybillNo) return "";

  const payText = params.pay === "선불" ? "선불 " : "";

  if (params.delivery === "정기") {
    return `[${receiverName}]님 대신화물 ${payText}${asString(params.branch)} 운송장번호 - ${waybillNo}`
      .replace(/\s+/g, " ")
      .trim();
  }

  return `[${receiverName}]님 대신택배 ${payText}운송장번호 - ${waybillNo}`
    .replace(/\s+/g, " ")
    .trim();
}

function parseWaybillUploadRows(rows: Record<string, unknown>[]): WaybillUploadRow[] {
  return rows
    .map((row, index) => {
      const sender = getRowValue(row, ["발화주명", "발송인명", "보내는분", "보내는분명", "발송업체명"]);
      const receiver = getRowValue(row, ["수화주명", "받는분", "수취인명", "수하인명"]);
      const receiverPhone = normalizeDigits(
        getRowValue(row, ["수화주전화", "수화주전화1", "수화주전화번호", "받는분전화", "받는분전화번호"])
      );
      const address = getRowValue(row, ["수화주주소", "주소", "받는분주소"]);
      const qty = parseNumberValue(getRowValue(row, ["수량", "박스수량", "건수"]));
      const fare = parseNumberValue(getRowValue(row, ["총운임", "운임", "총배송비"]));
      const delivery = normalizeWaybillDelivery(getRowValue(row, ["운송상품", "운송상품명", "운송방법"]));
      const pay = normalizeWaybillPay(getRowValue(row, ["지불방법", "운임구분"]));
      const branch = getRowValue(row, ["도착지", "도착영업소", "도착지점", "도착영업소명"]);
      const waybillNo = normalizeDigits(
        getRowValue(row, ["운송장번호", "송장번호", "운송장", "운송장No", "운송장 NO"])
      );

      return {
        id: `upload-${index + 1}`,
        sender,
        receiver,
        receiverPhone,
        address,
        qty,
        fare,
        delivery,
        pay,
        branch,
        waybillNo,
        raw: row,
      };
    })
    .filter(
      (item) =>
        item.receiver ||
        item.sender ||
        item.receiverPhone ||
        item.address ||
        item.qty > 0 ||
        item.fare > 0 ||
        item.waybillNo
    );
}

function scoreWaybillPair(shipment: SavedShipment, upload: WaybillUploadRow) {
  const shipmentQty = normalizeQtyForCompare(shipment.qty);
  const uploadQty = normalizeQtyForCompare(upload.qty);
  const shipmentFare = Number(String(shipment.fare).replace(/,/g, "")) || 0;
  const shipmentPhone = normalizeDigits(shipment.receiverPhone);
  const shipmentListName = displayReceiverName(shipment.sender, shipment.receiver);
  const uploadListName = buildWaybillListName(upload.sender, upload.receiver);

  let score = 0;

  if (shipment.delivery === upload.delivery) score += 3;
  else score -= 4;

  if (shipment.pay === upload.pay) score += 2;
  else score -= 1;

  if (shipmentQty === uploadQty) score += 3;
  else score -= 2;

  if (shipmentFare === upload.fare) score += 3;
  else if (shipmentFare > 0 && upload.fare > 0 && Math.abs(shipmentFare - upload.fare) <= 100) score += 1;

  if (valuesClose(shipment.receiver, upload.receiver)) score += 7;
  if (valuesClose(shipment.sender, upload.sender) || valuesClose(shipment.sender, simplifyWaybillSenderName(upload.sender))) score += 4;
  if (valuesClose(shipmentListName, uploadListName)) score += 6;

  if (shipmentPhone && upload.receiverPhone && shipmentPhone === upload.receiverPhone) score += 4;

  if (shipment.delivery === "정기" && shipment.branch && upload.branch && valuesClose(shipment.branch, upload.branch)) {
    score += 4;
  }

  if (shipment.delivery === "택배" && shipment.address && upload.address && addressesClose(shipment.address, upload.address)) {
    score += 4;
  }

  return score;
}

function buildWaybillVerificationRows(
  shipments: SavedShipment[],
  uploads: WaybillUploadRow[]
): WaybillVerificationRow[] {
  const scoredPairs: Array<{ shipmentIndex: number; uploadIndex: number; score: number }> = [];

  shipments.forEach((shipment, shipmentIndex) => {
    uploads.forEach((upload, uploadIndex) => {
      const score = scoreWaybillPair(shipment, upload);
      if (score >= 8) {
        scoredPairs.push({ shipmentIndex, uploadIndex, score });
      }
    });
  });

  scoredPairs.sort((a, b) => b.score - a.score);

  const matchedShipmentIndexes = new Set<number>();
  const matchedUploadIndexes = new Set<number>();
  const matchedPairs: Array<{ shipment: SavedShipment; upload: WaybillUploadRow }> = [];

  for (const pair of scoredPairs) {
    if (matchedShipmentIndexes.has(pair.shipmentIndex) || matchedUploadIndexes.has(pair.uploadIndex)) {
      continue;
    }

    matchedShipmentIndexes.add(pair.shipmentIndex);
    matchedUploadIndexes.add(pair.uploadIndex);
    matchedPairs.push({
      shipment: shipments[pair.shipmentIndex],
      upload: uploads[pair.uploadIndex],
    });
  }

  const rows: WaybillVerificationRow[] = [];

  matchedPairs.forEach(({ shipment, upload }, index) => {
    const reasons: string[] = [];
    const shipmentQty = normalizeQtyForCompare(shipment.qty);
    const uploadQty = normalizeQtyForCompare(upload.qty);
    const shipmentFare = Number(String(shipment.fare).replace(/,/g, "")) || 0;

    if (!valuesClose(shipment.receiver, upload.receiver)) {
      reasons.push("수화주명 확인");
    }

    if (shipment.sender !== "상화시스템" && !valuesClose(shipment.sender, simplifyWaybillSenderName(upload.sender))) {
      reasons.push("발화주명 확인");
    }

    if (shipmentQty !== uploadQty) {
      reasons.push("수량 확인");
    }

    if (shipment.delivery !== upload.delivery) {
      reasons.push("운송상품 확인");
    }

    if (shipment.pay !== upload.pay) {
      reasons.push("지불방법 확인");
    }

    if (shipmentFare !== upload.fare) {
      reasons.push("총운임 확인");
    }

    if (shipment.delivery === "정기" && shipment.branch && upload.branch && !valuesClose(shipment.branch, upload.branch)) {
      reasons.push("도착지 확인");
    }

    if (shipment.delivery === "택배" && shipment.address && upload.address && !addressesClose(shipment.address, upload.address)) {
      reasons.push("주소 확인");
    }

    if (!upload.waybillNo) {
      reasons.push("운송장번호 없음");
    }

    rows.push({
      id: `matched-${index + 1}-${shipment.id}-${upload.id}`,
      status: reasons.length === 0 ? "일치" : "확인필요",
      shipmentListName: displayReceiverName(shipment.sender, shipment.receiver),
      uploadListName: buildWaybillListName(upload.sender, upload.receiver),
      qtyText: `${shipmentQty} / ${uploadQty}`,
      deliveryText: `${displayDelivery(shipment.delivery)} / ${displayDelivery(upload.delivery)}`,
      payText: `${shipment.pay} / ${upload.pay}`,
      fareText: `${shipmentFare.toLocaleString("ko-KR")} / ${upload.fare.toLocaleString("ko-KR")}`,
      waybillNo: upload.waybillNo,
      reasons,
    });
  });

  shipments.forEach((shipment, shipmentIndex) => {
    if (matchedShipmentIndexes.has(shipmentIndex)) return;

    rows.push({
      id: `shipment-only-${shipment.id}`,
      status: "출고목록만",
      shipmentListName: displayReceiverName(shipment.sender, shipment.receiver),
      uploadListName: "",
      qtyText: String(normalizeQtyForCompare(shipment.qty)),
      deliveryText: displayDelivery(shipment.delivery),
      payText: shipment.pay,
      fareText: (Number(String(shipment.fare).replace(/,/g, "")) || 0).toLocaleString("ko-KR"),
      waybillNo: "",
      reasons: ["발송데이터에 없음"],
    });
  });

  uploads.forEach((upload, uploadIndex) => {
    if (matchedUploadIndexes.has(uploadIndex)) return;

    rows.push({
      id: `upload-only-${upload.id}`,
      status: "발송데이터만",
      shipmentListName: "",
      uploadListName: buildWaybillListName(upload.sender, upload.receiver),
      qtyText: String(normalizeQtyForCompare(upload.qty)),
      deliveryText: displayDelivery(upload.delivery),
      payText: upload.pay,
      fareText: upload.fare.toLocaleString("ko-KR"),
      waybillNo: upload.waybillNo,
      reasons: ["출고목록에 없음"],
    });
  });

  return rows;
}

async function copyTextSilently(text: string) {
  const safeText = asString(text);
  if (!safeText) return false;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(safeText);
      return true;
    }
  } catch (error) {
    console.error("클립보드 복사 실패", error);
  }

  try {
    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = safeText;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch (error) {
    console.error("대체 복사 실패", error);
    return false;
  }
}

function focusNextFormField(current: HTMLElement, reverse = false) {
  if (typeof document === "undefined") return;

  const scope =
    (current.closest('[data-enter-scope="form"]') as HTMLElement | null) ?? document.body;

  const candidates = Array.from(
    scope.querySelectorAll<HTMLElement>(
      "input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled])"
    )
  ).filter((element) => element.offsetParent !== null);

  const currentIndex = candidates.indexOf(current);
  if (currentIndex < 0) return;

  const nextIndex = reverse ? currentIndex - 1 : currentIndex + 1;
  const next = candidates[nextIndex];
  if (!next) return;

  next.focus();

  if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
    next.select?.();
  }
}

function handleEnterMoveNext(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  if (event.currentTarget instanceof HTMLTextAreaElement) return;

  event.preventDefault();
  focusNextFormField(event.currentTarget as HTMLElement);
}

function displayDelivery(delivery: DeliveryType) {
  return delivery === "정기" ? "화물" : "택배";
}

function formatFare(fare: string) {
  const num = Number(String(fare).replace(/,/g, ""));
  if (!num) return fare;
  return `${num.toLocaleString("ko-KR")}원`;
}

function checklistProgress(checklist: Checklist) {
  const values = Object.values(checklist);
  const total = values.length;
  const done = values.filter(Boolean).length;
  const percent = Math.round((done / total) * 100);
  return { done, total, percent };
}

function getSeoulDateKey(input: string | Date) {
  const date = typeof input === "string" ? new Date(input) : input;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";

  return `${year}-${month}-${day}`;
}

function getTodaySeoulDateKey() {
  return getSeoulDateKey(new Date());
}

function isJejuDestination(params: {
  delivery: DeliveryType;
  address?: string;
  branch?: string;
}) {
  const text =
    params.delivery === "택배"
      ? (params.address || "").replace(/\s/g, "")
      : (params.branch || "").replace(/\s/g, "");

  return text.includes("제주") || text.includes("서귀포");
}

function suggestFareByQty(params: {
  qty: string;
  delivery: DeliveryType;
  pack: string;
  address?: string;
  branch?: string;
}) {
  const n = Number(params.qty);
  if (!n) return "";

  if ((params.pack || "").trim() !== "박스") {
    return "";
  }

  const regularFareMap: Record<string, number> = {
    "0.5": 4400,
    "1": 5500,
    "1.5": 9900,
    "2": 11000,
    "2.5": 15400,
    "3": 16500,
    "3.5": 20900,
    "4": 22000,
  };

  const parcelFareMap: Record<string, number> = {
    "0.5": 6600,
    "1": 7150,
    "1.5": 13750,
    "2": 14300,
    "2.5": 20900,
    "3": 21450,
    "3.5": 28050,
    "4": 28600,
  };

  const key = String(n);
  const fareMap = params.delivery === "정기" ? regularFareMap : parcelFareMap;
  const baseFare = fareMap[key];
  if (!baseFare) return "";

  const finalFare = isJejuDestination({
    delivery: params.delivery,
    address: params.address,
    branch: params.branch,
  })
    ? baseFare * 2
    : baseFare;

  return String(finalFare);
}

function mapPayForTemplate(pay: PayType) {
  return pay === "선불" ? "현불" : "착불";
}

function parseAliases(text: string) {
  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function aliasesToText(aliases?: string[]) {
  return (aliases || []).join(", ");
}

function asString(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getRowValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

function mergeByName<T extends { name: string }>(prev: T[], incoming: T[]) {
  const map = new Map(prev.map((item) => [item.name, item]));
  for (const item of incoming) {
    map.set(item.name, item);
  }
  return Array.from(map.values());
}

function mergeByBranch(prev: BranchPostalItem[], incoming: BranchPostalItem[]) {
  const map = new Map(prev.map((item) => [item.branch, item]));
  for (const item of incoming) {
    map.set(item.branch, item);
  }
  return Array.from(map.values());
}

function buildReceiverTemplateRows(): Array<Record<string, string>> {
  return [
    {
      name: "85모터스",
      aliases: "청주85모터스,85모터스",
      phone: "01053443444",
      address: "충청북도 청주시 청원구 오창읍 중심상업2로 47-31, 1층",
      branch: "오창산단",
      postalCode: "28119",
      note: "택배발송",
    },
  ];
}

function buildSenderTemplateRows(): Array<Record<string, string>> {
  return [
    {
      name: "제로100모터스",
      aliases: "제로100,제로백",
      phone: "025159728",
    },
  ];
}

function buildBranchTemplateRows(): Array<Record<string, string>> {
  return [
    {
      branch: "오창산단",
      postalCode: "28116",
    },
  ];
}

function toTemplateRow(
  shipment: SavedShipment,
  resolvePostalCodeValue: (params: {
    delivery: DeliveryType;
    receiver: string;
    branch: string;
    currentPostalCode?: string;
  }) => string
) {
  const safePostal = resolvePostalCodeValue({
    delivery: shipment.delivery,
    receiver: shipment.receiver,
    branch: shipment.branch,
    currentPostalCode: shipment.postalCode,
  });

  const qty = Math.ceil(Number(shipment.qty) || 0);

  const row: Record<(typeof TEMPLATE_HEADERS)[number], string | number> = {
    수화주전화1: shipment.receiverPhone || "",
    수화주전화2: "",
    수화주명: shipment.receiver || "",
    주소:
      shipment.delivery === "택배"
        ? shipment.address?.trim() || " "
        : " ",
    수량: qty,
    품명: shipment.item || "부품",
    포장: shipment.pack || "박스",
    운임구분: mapPayForTemplate(shipment.pay),
    운송상품: shipment.delivery,
    우편번호: safePostal || "",
    도착영업소: shipment.delivery === "정기" ? shipment.branch || "" : "",
    발화주명: shipment.sender || "",
    발화주전화번호: shipment.senderPhone || "",
    발송제비용: "",
    운임: "",
    도착제비용: "",
    총운임: Number(String(shipment.fare).replace(/,/g, "")) || "",
    특기사항: shipment.memo || "",
    내품표기1: "",
    내품표기2: "",
    내품표기3: "",
    내품표기4: "",
    내품표기5: "",
    내품표기6: "",
    내품표기7: "",
    내품표기8: "",
    내품표기9: "",
    내품표기10: "",
    내품표기11: "",
    내품표기12: "",
    내품표기13: "",
  };

  return row;
}

export default function Home() {
  const [tab, setTab] = useState<TabType>("출고등록");

  const today = new Date().toLocaleDateString("ko-KR"); 

  const receiverUploadRef = useRef<HTMLInputElement | null>(null);
  const senderUploadRef = useRef<HTMLInputElement | null>(null);
  const branchUploadRef = useRef<HTMLInputElement | null>(null);
  const waybillUploadRef = useRef<HTMLInputElement | null>(null);
  const receiverPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const senderPhoneInputRef = useRef<HTMLInputElement | null>(null);

  const [receiverMaster, setReceiverMaster] = useState<Party[]>([]);
  const [senderMaster, setSenderMaster] = useState<Party[]>([]);
  const [branchMaster, setBranchMaster] = useState<BranchPostalItem[]>([]);

  const [receiver, setReceiver] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [address, setAddress] = useState("");
  const [branch, setBranch] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [note, setNote] = useState("");

  const [sender, setSender] = useState("상화시스템");
  const [senderPhone, setSenderPhone] = useState("0318059618");

  const [item, setItem] = useState("부품");
  const [pack, setPack] = useState("박스");
  const [pay, setPay] = useState<PayType>("착불");
  const [delivery, setDelivery] = useState<DeliveryType>("정기");
  const [qty, setQty] = useState("1");
  const [fare, setFare] = useState("5500");
  const [memo, setMemo] = useState("");

  const [addrResults, setAddrResults] = useState<any[]>([]);
  const [addrKeyword, setAddrKeyword] = useState("");
  const [showAddrSearch, setShowAddrSearch] = useState(false);

  const [receiverFocused, setReceiverFocused] = useState(false);
  const [senderFocused, setSenderFocused] = useState(false);

  const [savedShipments, setSavedShipments] = useState<SavedShipment[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailShipmentId, setDetailShipmentId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SavedShipment | null>(null);

  const [filterKeyword, setFilterKeyword] = useState("");
  const [payFilter, setPayFilter] = useState<"전체" | PayType>("전체");
  const [deliveryFilter, setDeliveryFilter] = useState<"전체" | DeliveryType>("전체");
  const [directOnly, setDirectOnly] = useState(false);
  const [waybillUncheckedOnly, setWaybillUncheckedOnly] = useState(false);
  const [pdaUncheckedOnly, setPdaUncheckedOnly] = useState(false);
  const [listScope, setListScope] = useState<"today" | "all">("today");

  const [receiverMasterKeyword, setReceiverMasterKeyword] = useState("");
  const [senderMasterKeyword, setSenderMasterKeyword] = useState("");
  const [branchMasterKeyword, setBranchMasterKeyword] = useState("");

  const [receiverMasterMode, setReceiverMasterMode] = useState<MasterMode>("new");
  const [senderMasterMode, setSenderMasterMode] = useState<MasterMode>("new");
  const [branchMasterMode, setBranchMasterMode] = useState<MasterMode>("new");

  const [selectedReceiverMasterName, setSelectedReceiverMasterName] = useState("");
  const [selectedSenderMasterName, setSelectedSenderMasterName] = useState("");
  const [selectedBranchMasterName, setSelectedBranchMasterName] = useState("");

  const [receiverForm, setReceiverForm] = useState<Party>({
    name: "",
    aliases: [],
    phone: "",
    address: "",
    branch: "",
    note: "",
    postalCode: "",
  });

  const [senderForm, setSenderForm] = useState<Party>({
    name: "",
    aliases: [],
    phone: "",
  });

  const [branchForm, setBranchForm] = useState<BranchPostalItem>({
    branch: "",
    postalCode: "",
  });

  const [receiverAliasesInput, setReceiverAliasesInput] = useState("");
  const [senderAliasesInput, setSenderAliasesInput] = useState("");
  const [addrSearched, setAddrSearched] = useState(false);

  const [waybillUploadFileName, setWaybillUploadFileName] = useState("");
  const [waybillUploadRows, setWaybillUploadRows] = useState<WaybillUploadRow[]>([]);
  const [verificationKeyword, setVerificationKeyword] = useState("");
  const [verificationMismatchOnly, setVerificationMismatchOnly] = useState(false);
  const [copiedWaybillMessageId, setCopiedWaybillMessageId] = useState("");

  const loadShipmentsFromDb = async () => {
    const { data, error } = await supabase
      .from("shipments")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("DB 조회 실패", error);
      return;
    }

    const normalized: SavedShipment[] = (data ?? []).map(normalizeShipment);
    persistShipments(normalized);
  };

  const loadReceiverMasterFromDb = async () => {
    const { data, error } = await supabase
      .from("receiver_master")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("수화주 마스터 조회 실패", error);
      return;
    }

    setReceiverMaster(normalizeReceiverMasterRows(data ?? []));
  };

  const loadSenderMasterFromDb = async () => {
    const { data, error } = await supabase
      .from("sender_master")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("발화주 마스터 조회 실패", error);
      return;
    }

    setSenderMaster(normalizeSenderMasterRows(data ?? []));
  };

  const loadBranchMasterFromDb = async () => {
    const { data, error } = await supabase
      .from("branch_master")
      .select("*")
      .order("branch", { ascending: true });

    if (error) {
      console.error("영업소 마스터 조회 실패", error);
      return;
    }

    setBranchMaster(normalizeBranchMasterRows(data ?? []));
  };

  const loadAllMastersFromDb = async () => {
    await Promise.all([
      loadReceiverMasterFromDb(),
      loadSenderMasterFromDb(),
      loadBranchMasterFromDb(),
    ]);
  };

  const ensureMasterSeedData = async () => {
    const [
      receiverCountResult,
      senderCountResult,
      branchCountResult,
    ] = await Promise.all([
      supabase.from("receiver_master").select("*", { count: "exact", head: true }),
      supabase.from("sender_master").select("*", { count: "exact", head: true }),
      supabase.from("branch_master").select("*", { count: "exact", head: true }),
    ]);

    if (receiverCountResult.error) {
      console.error("receiver_master count 조회 실패", receiverCountResult.error);
    } else if ((receiverCountResult.count ?? 0) === 0) {
      const { error } = await supabase
        .from("receiver_master")
        .upsert(toReceiverMasterRows(initialReceiverList), { onConflict: "name" });

      if (error) {
        console.error("receiver_master 초기 데이터 반영 실패", error);
      }
    }

    if (senderCountResult.error) {
      console.error("sender_master count 조회 실패", senderCountResult.error);
    } else if ((senderCountResult.count ?? 0) === 0) {
      const { error } = await supabase
        .from("sender_master")
        .upsert(toSenderMasterRows(initialSenderList), { onConflict: "name" });

      if (error) {
        console.error("sender_master 초기 데이터 반영 실패", error);
      }
    }

    if (branchCountResult.error) {
      console.error("branch_master count 조회 실패", branchCountResult.error);
    } else if ((branchCountResult.count ?? 0) === 0) {
      const { error } = await supabase
        .from("branch_master")
        .upsert(
          toBranchMasterRows(
            Object.entries(initialBranchPostalMap).map(([branch, postalCode]) => ({
              branch,
              postalCode,
            }))
          ),
          { onConflict: "branch" }
        );

      if (error) {
        console.error("branch_master 초기 데이터 반영 실패", error);
      }
    }
  };

  const migrateLegacyLocalMastersToDbIfNeeded = async () => {
    if (typeof window === "undefined") return;

    const alreadyMigrated = localStorage.getItem(MASTER_DB_MIGRATION_KEY);
    if (alreadyMigrated === "done") return;

    try {
      const [
        receiverCountResult,
        senderCountResult,
        branchCountResult,
      ] = await Promise.all([
        supabase.from("receiver_master").select("*", { count: "exact", head: true }),
        supabase.from("sender_master").select("*", { count: "exact", head: true }),
        supabase.from("branch_master").select("*", { count: "exact", head: true }),
      ]);

      const rawReceiver = localStorage.getItem(LEGACY_RECEIVER_MASTER_KEY);
      const rawSender = localStorage.getItem(LEGACY_SENDER_MASTER_KEY);
      const rawBranch = localStorage.getItem(LEGACY_BRANCH_MASTER_KEY);

      const parsedReceiver: Party[] = rawReceiver ? JSON.parse(rawReceiver) : [];
      const parsedSender: Party[] = rawSender ? JSON.parse(rawSender) : [];
      const parsedBranch: BranchPostalItem[] = rawBranch ? JSON.parse(rawBranch) : [];

      if ((receiverCountResult.count ?? 0) === 0 && parsedReceiver.length > 0) {
        const { error } = await supabase
          .from("receiver_master")
          .upsert(toReceiverMasterRows(parsedReceiver), { onConflict: "name" });

        if (error) {
          console.error("기존 수화주 localStorage 마이그레이션 실패", error);
        }
      }

      if ((senderCountResult.count ?? 0) === 0 && parsedSender.length > 0) {
        const { error } = await supabase
          .from("sender_master")
          .upsert(toSenderMasterRows(parsedSender), { onConflict: "name" });

        if (error) {
          console.error("기존 발화주 localStorage 마이그레이션 실패", error);
        }
      }

      if ((branchCountResult.count ?? 0) === 0 && parsedBranch.length > 0) {
        const { error } = await supabase
          .from("branch_master")
          .upsert(toBranchMasterRows(parsedBranch), { onConflict: "branch" });

        if (error) {
          console.error("기존 영업소 localStorage 마이그레이션 실패", error);
        }
      }
    } catch (error) {
      console.error("기존 localStorage 마스터 마이그레이션 실패", error);
    } finally {
      localStorage.setItem(MASTER_DB_MIGRATION_KEY, "done");
    }
  };

  useEffect(() => {
    const initialize = async () => {
      await migrateLegacyLocalMastersToDbIfNeeded();
      await ensureMasterSeedData();
      await Promise.all([loadShipmentsFromDb(), loadAllMastersFromDb()]);
    };

    void initialize();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const savedRows = localStorage.getItem(WAYBILL_UPLOAD_STORAGE_KEY);
      const savedFileName = localStorage.getItem(WAYBILL_UPLOAD_FILE_NAME_KEY);

      if (savedRows) {
        setWaybillUploadRows(JSON.parse(savedRows));
      }

      if (savedFileName) {
        setWaybillUploadFileName(savedFileName);
      }
    } catch (error) {
      console.error("발송데이터 localStorage 복구 실패", error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(WAYBILL_UPLOAD_STORAGE_KEY, JSON.stringify(waybillUploadRows));
      localStorage.setItem(WAYBILL_UPLOAD_FILE_NAME_KEY, waybillUploadFileName);
    } catch (error) {
      console.error("발송데이터 localStorage 저장 실패", error);
    }
  }, [waybillUploadRows, waybillUploadFileName]);

  useEffect(() => {
    if (tab === "출고등록" || tab === "마스터관리") {
      void loadAllMastersFromDb();
    }

    if (tab === "출고목록" || tab === "발송검증" || tab === "운송장문구") {
      void loadShipmentsFromDb();
    }
  }, [tab]);

  useEffect(() => {
    const channel = supabase
      .channel("master-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "receiver_master" },
        () => {
          void loadReceiverMasterFromDb();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sender_master" },
        () => {
          void loadSenderMasterFromDb();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "branch_master" },
        () => {
          void loadBranchMasterFromDb();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const persistShipments = (items: SavedShipment[]) => {
    setSavedShipments(items);
  };

  const resolvePostalCodeValue = (params: {
    delivery: DeliveryType;
    receiver: string;
    branch: string;
    currentPostalCode?: string;
  }) => {
    if (params.currentPostalCode?.trim()) return params.currentPostalCode.trim();

    const receiverItem = receiverMaster.find((item) => item.name === params.receiver);

    if (params.delivery === "택배") {
      return receiverItem?.postalCode?.trim() || "";
    }

    const branchItem = branchMaster.find((item) => item.branch === params.branch);
    return branchItem?.postalCode?.trim() || receiverItem?.postalCode?.trim() || "";
  };

  const receiverMatches = useMemo(
    () => getMatches(receiverMaster, receiver),
    [receiverMaster, receiver]
  );

  const senderMatches = useMemo(
    () => getMatches(senderMaster, sender),
    [senderMaster, sender]
  );

  const filteredShipments = useMemo(() => {
    const todayKey = getTodaySeoulDateKey();

    return savedShipments.filter((shipment) => {
      const keyword = filterKeyword.trim().toLowerCase();
      const displayName = displayReceiverName(shipment.sender, shipment.receiver).toLowerCase();

      const matchesKeyword =
        !keyword ||
        displayName.includes(keyword) ||
        shipment.sender.toLowerCase().includes(keyword) ||
        shipment.receiver.toLowerCase().includes(keyword) ||
        shipment.memo.toLowerCase().includes(keyword);

      const matchesPay = payFilter === "전체" ? true : shipment.pay === payFilter;
      const matchesDelivery =
        deliveryFilter === "전체" ? true : shipment.delivery === deliveryFilter;
      const matchesDirect = directOnly ? shipment.sender !== "상화시스템" : true;
      const matchesWaybill = waybillUncheckedOnly ? !shipment.checklist.waybill : true;
      const matchesPda = pdaUncheckedOnly ? !shipment.checklist.pda : true;
      const matchesDate =
        listScope === "all"
          ? true
          : getSeoulDateKey(shipment.createdAt) === todayKey;

      return (
        matchesDate &&
        matchesKeyword &&
        matchesPay &&
        matchesDelivery &&
        matchesDirect &&
        matchesWaybill &&
        matchesPda
      );
    });
  
  }, [
    savedShipments,
    filterKeyword,
    payFilter,
    deliveryFilter,
    directOnly,
    waybillUncheckedOnly,
    pdaUncheckedOnly,
    listScope,
  ]);

  const sortedShipments = useMemo(
    () =>
      [...filteredShipments].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [filteredShipments]
  );

  const summaryCount = filteredShipments.length;
  const summaryQty = filteredShipments.reduce(
    (sum, shipment) => sum + sumCeilQuantity(shipment.qty),
    0
  );

  const allFilteredIds = filteredShipments.map((item) => item.id);
  const allFilteredSelected =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.includes(id));

  const detailProgress = editForm ? checklistProgress(editForm.checklist) : null;

  const filteredReceiverMaster = receiverMaster.filter((item) => {
    const keyword = receiverMasterKeyword.trim().toLowerCase();
    if (!keyword) return true;
    return (
      item.name.toLowerCase().includes(keyword) ||
      aliasesToText(item.aliases).toLowerCase().includes(keyword) ||
      (item.phone || "").toLowerCase().includes(keyword) ||
      (item.address || "").toLowerCase().includes(keyword) ||
      (item.branch || "").toLowerCase().includes(keyword)
    );
  });

  const filteredSenderMaster = senderMaster.filter((item) => {
    const keyword = senderMasterKeyword.trim().toLowerCase();
    if (!keyword) return true;
    return (
      item.name.toLowerCase().includes(keyword) ||
      aliasesToText(item.aliases).toLowerCase().includes(keyword) ||
      (item.phone || "").toLowerCase().includes(keyword)
    );
  });

  const filteredBranchMaster = branchMaster.filter((item) => {
    const keyword = branchMasterKeyword.trim().toLowerCase();
    if (!keyword) return true;
    return (
      item.branch.toLowerCase().includes(keyword) ||
      item.postalCode.toLowerCase().includes(keyword)
    );
  });

  const applyReceiver = (party: Party) => {
    setReceiver(party.name);
    setReceiverPhone(party.phone);
    setAddress(party.address || "");
    setBranch(party.branch || "");
    setPostalCode(
      resolvePostalCodeValue({
        delivery,
        receiver: party.name,
        branch: party.branch || "",
        currentPostalCode: "",
      })
    );
    setNote(party.note || "");
    setReceiverFocused(false);
    setFare(
      suggestFareByQty({
        qty,
        delivery,
        pack,
        address: party.address || "",
        branch: party.branch || "",
      })
    );

    window.setTimeout(() => {
      receiverPhoneInputRef.current?.focus();
      receiverPhoneInputRef.current?.select();
    }, 0);
  };

  const applySender = (party: Party) => {
    setSender(party.name);
    setSenderPhone(party.phone);
    setSenderFocused(false);

    window.setTimeout(() => {
      senderPhoneInputRef.current?.focus();
      senderPhoneInputRef.current?.select();
    }, 0);
  };

  const handleReceiverEnter = () => {
    if (receiverMatches.length > 0) applyReceiver(receiverMatches[0]);
  };

  const handleSenderEnter = () => {
    if (senderMatches.length > 0) applySender(senderMatches[0]);
  };

  const handleQty = (v: string) => {
    setQty(v);
    setFare(
      suggestFareByQty({
        qty: v,
        delivery,
        pack,
        address,
        branch,
      })
    );
  };

  const resetForm = () => {
    setReceiver("");
    setReceiverPhone("");
    setAddress("");
    setBranch("");
    setPostalCode("");
    setNote("");
    setSender("상화시스템");
    setSenderPhone("0318059618");
    setItem("부품");
    setPack("박스");
    setPay("착불");
    setDelivery("정기");
    setQty("1");
    setFare("5500");
    setMemo("");
    setReceiverFocused(false);
    setSenderFocused(false);
  };

  const handleSave = async () => {
    if (!receiver.trim()) return alert("수화주명을 입력해 주세요.");
    if (!sender.trim()) return alert("발화주명을 입력해 주세요.");
    if (!qty.trim()) return alert("수량을 입력해 주세요.");
    if (!fare.trim()) return alert("운임을 입력해 주세요.");

    const payload = {
      receiver,
      receiver_phone: receiverPhone,
      address,
      branch,
      postal_code: resolvePostalCodeValue({
        delivery,
        receiver,
        branch,
        currentPostalCode: postalCode,
      }),
      sender,
      sender_phone: senderPhone,
      item,
      pack,
      pay,
      delivery,
      qty: Number(qty),
      fare: Number(String(fare).replace(/,/g, "")),
      memo,
      note,
      order_sheet: false,
      sales_slip: false,
      pda: false,
      waybill: false,
    };

    const { error } = await supabase
      .from("shipments")
      .insert([payload]);

    if (error) {
      alert("DB 저장 실패: " + error.message);
      return;
    }

    await loadShipmentsFromDb();
    resetForm();
    alert("DB 저장 완료");
  };

    const handleDelete = async (id: string) => {
    const numericId = Number(id);

    const { error } = await supabase
      .from("shipments")
      .delete()
      .eq("id", numericId);

    if (error) {
      console.error(error);
      alert("삭제 실패: " + error.message);
      return;
    }

    await loadShipmentsFromDb();
    setSelectedIds((prev) => prev.filter((item) => item !== id));

    if (detailShipmentId === id) closeDetail();
  };

  
  const handleChecklistToggle = async (shipmentId: string, key: keyof Checklist) => {
    const current = savedShipments.find((item) => item.id === shipmentId);
    if (!current) return;

    const nextValue = !current.checklist[key];
    const columnMap: Record<keyof Checklist, string> = {
      orderSheet: "order_sheet",
      salesSlip: "sales_slip",
      pda: "pda",
      waybill: "waybill",
    };

    const { error } = await supabase
      .from("shipments")
      .update({ [columnMap[key]]: nextValue })
      .eq("id", Number(shipmentId));

    if (error) {
      console.error(error);
      alert("체크리스트 저장 실패: " + error.message);
      return;
    }

    await loadShipmentsFromDb();
  };

  
  const openDetail = (shipment: SavedShipment) => {
    setDetailShipmentId(shipment.id);
    setEditForm({ ...shipment, checklist: { ...shipment.checklist } });
    setDetailOpen(true);
  };

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailShipmentId(null);
    setEditForm(null);
  };

  const updateEditField = <K extends keyof SavedShipment>(key: K, value: SavedShipment[K]) => {
    setEditForm((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
  };

  const handleSaveDetail = async () => {
    if (!editForm) return;
    if (!editForm.receiver.trim()) return alert("수화주명을 입력해 주세요.");
    if (!editForm.sender.trim()) return alert("발화주명을 입력해 주세요.");
    if (!editForm.qty.trim()) return alert("수량을 입력해 주세요.");
    if (!editForm.fare.trim()) return alert("운임을 입력해 주세요.");

    const payload = {
      receiver: editForm.receiver,
      receiver_phone: editForm.receiverPhone,
      address: editForm.address,
      branch: editForm.branch,
      postal_code: resolvePostalCodeValue({
        delivery: editForm.delivery,
        receiver: editForm.receiver,
        branch: editForm.branch,
        currentPostalCode: editForm.postalCode,
      }),
      sender: editForm.sender,
      sender_phone: editForm.senderPhone,
      item: editForm.item,
      pack: editForm.pack,
      pay: editForm.pay,
      delivery: editForm.delivery,
      qty: Number(editForm.qty),
      fare: Number(String(editForm.fare).replace(/,/g, "")),
      memo: editForm.memo,
      note: editForm.note,
      order_sheet: editForm.checklist.orderSheet,
      sales_slip: editForm.checklist.salesSlip,
      pda: editForm.checklist.pda,
      waybill: editForm.checklist.waybill,
    };

    const { error } = await supabase
      .from("shipments")
      .update(payload)
      .eq("id", Number(editForm.id));

    if (error) {
      console.error(error);
      alert("상세정보 저장 실패: " + error.message);
      return;
    }

    await loadShipmentsFromDb();
    closeDetail();
    alert("상세정보 저장 완료");
  };

  
  const resetFilters = () => {
    setFilterKeyword("");
    setPayFilter("전체");
    setDeliveryFilter("전체");
    setDirectOnly(false);
    setWaybillUncheckedOnly(false);
    setPdaUncheckedOnly(false);
  };

  const clearTodayShipments = async () => {
    const todayKey = getTodaySeoulDateKey();

    const todayIds = savedShipments
      .filter((item) => getSeoulDateKey(item.createdAt) === todayKey)
      .map((item) => Number(item.id))
      .filter((id) => !Number.isNaN(id));

    if (todayIds.length === 0) {
      alert("오늘 삭제할 목록이 없습니다.");
      return;
    }

    const { error } = await supabase
      .from("shipments")
      .delete()
      .in("id", todayIds);

    if (error) {
      console.error(error);
      alert("오늘 목록 비우기 실패: " + error.message);
      return;
    }

    await loadShipmentsFromDb();

    setSelectedIds((prev) =>
      prev.filter((id) => !todayIds.includes(Number(id)))
    );

    if (
      detailShipmentId &&
      todayIds.includes(Number(detailShipmentId))
    ) {
      closeDetail();
    }

    alert("오늘 목록을 비웠습니다.");
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => prev.filter((id) => !allFilteredIds.includes(id)));
      return;
    }
    setSelectedIds((prev) => Array.from(new Set([...prev, ...allFilteredIds])));
  };

  const exportRows = async (rows: SavedShipment[], fileLabel: string) => {
    if (rows.length === 0) return alert("내려받을 출고건이 없습니다.");

    const unresolved = rows.filter((row) => {
      const code = resolvePostalCodeValue({
        delivery: row.delivery,
        receiver: row.receiver,
        branch: row.branch,
        currentPostalCode: row.postalCode,
      });
      return !code;
    });

    if (unresolved.length > 0) {
      return alert(
        `우편번호가 비어 있는 출고건이 있어 다운로드를 중단했습니다.\n\n` +
          unresolved
            .slice(0, 8)
            .map((row) => `- ${displayReceiverName(row.sender, row.receiver)}`)
            .join("\n") +
          "\n\n상세정보 수정에서 우편번호를 먼저 입력해 주세요."
      );
    }

    try {
      const XLSX = await import("xlsx");

      const data = [
        [...TEMPLATE_HEADERS],
        ...rows.map((shipment) => {
          const mapped = toTemplateRow(shipment, resolvePostalCodeValue);
          return TEMPLATE_HEADERS.map((header) => mapped[header]);
        }),
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, TEMPLATE_SHEET_NAME);

      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
        now.getDate()
      ).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(
        now.getMinutes()
      ).padStart(2, "0")}`;

      XLSX.writeFile(workbook, `대신택배_일괄업로드_${fileLabel}_${stamp}.xlsx`);
    } catch (error) {
      console.error(error);
      alert('엑셀 다운로드 기능을 쓰려면 먼저 "npm install xlsx"를 실행해 주세요.');
    }
  };

  const exportSelected = async () => {
    const rows = filteredShipments.filter((item) => selectedIds.includes(item.id));
    await exportRows(rows, "선택");
  };

  const exportFilteredAll = async () => {
    await exportRows(filteredShipments, "전체");
  };

  const exportMasterTemplate = async (kind: "receiver" | "sender" | "branch") => {
    try {
      const XLSX = await import("xlsx");
      const rows =
        kind === "receiver"
          ? buildReceiverTemplateRows()
          : kind === "sender"
            ? buildSenderTemplateRows()
            : buildBranchTemplateRows();

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      const sheetName =
        kind === "receiver"
          ? "수화주_템플릿"
          : kind === "sender"
            ? "발화주_템플릿"
            : "영업소_템플릿";
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `${sheetName}.xlsx`);
    } catch (error) {
      console.error(error);
      alert('템플릿 다운로드를 쓰려면 먼저 "npm install xlsx"를 실행해 주세요.');
    }
  };

  const exportCurrentMaster = async (kind: "receiver" | "sender" | "branch") => {
    try {
      const XLSX = await import("xlsx");
      const rows =
        kind === "receiver"
          ? receiverMaster.map((item) => ({
              name: item.name,
              aliases: aliasesToText(item.aliases),
              phone: item.phone || "",
              address: item.address || "",
              branch: item.branch || "",
              postalCode: item.postalCode || "",
              note: item.note || "",
            }))
          : kind === "sender"
            ? senderMaster.map((item) => ({
                name: item.name,
                aliases: aliasesToText(item.aliases),
                phone: item.phone || "",
              }))
            : branchMaster.map((item) => ({
                branch: item.branch,
                postalCode: item.postalCode,
              }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      const sheetName =
        kind === "receiver"
          ? "수화주_현재데이터"
          : kind === "sender"
            ? "발화주_현재데이터"
            : "영업소_현재데이터";
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `${sheetName}.xlsx`);
    } catch (error) {
      console.error(error);
      alert('엑셀 다운로드 기능을 사용하려면 먼저 "npm install xlsx"를 실행해 주세요.');
    }
  };

  const importReceiverMaster = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];

      const parsed = rows
        .map((row) => ({
          name: getRowValue(row, ["name", "수화주명", "업체명"]),
          aliases: parseAliases(getRowValue(row, ["aliases", "검색명", "별칭"])),
          phone: getRowValue(row, ["phone", "전화번호", "수화주전화", "수화주전화1"]),
          address: getRowValue(row, ["address", "주소"]),
          branch: getRowValue(row, ["branch", "도착영업소", "영업소"]),
          postal_code: getRowValue(row, ["postalCode", "우편번호"]),
          note: getRowValue(row, ["note", "특기사항"]),
        }))
        .filter((item) => item.name);

      if (parsed.length === 0) {
        alert("읽을 수 있는 수화주 데이터가 없습니다.");
        return;
      }

      const { error } = await supabase
        .from("receiver_master")
        .upsert(parsed, { onConflict: "name" });

      if (error) {
        alert("수화주 업로드 실패: " + error.message);
        return;
      }

      await loadReceiverMasterFromDb();
      alert(`수화주 마스터 ${parsed.length}건 반영 완료`);
    } catch (error) {
      console.error(error);
      alert("수화주 엑셀 업로드 중 오류가 발생했습니다.");
    }
  };

  const importSenderMaster = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];

      const parsed = rows
        .map((row) => ({
          name: getRowValue(row, ["name", "발화주명", "업체명"]),
          aliases: parseAliases(getRowValue(row, ["aliases", "검색명", "별칭"])),
          phone: getRowValue(row, ["phone", "전화번호", "발화주전화번호"]),
        }))
        .filter((item) => item.name);

      if (parsed.length === 0) {
        alert("읽을 수 있는 발화주 데이터가 없습니다.");
        return;
      }

      const { error } = await supabase
        .from("sender_master")
        .upsert(parsed, { onConflict: "name" });

      if (error) {
        alert("발화주 업로드 실패: " + error.message);
        return;
      }

      await loadSenderMasterFromDb();
      alert(`발화주 마스터 ${parsed.length}건 반영 완료`);
    } catch (error) {
      console.error(error);
      alert("발화주 엑셀 업로드 중 오류가 발생했습니다.");
    }
  };

  const importBranchMaster = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];

      const parsed = rows
        .map((row) => ({
          branch: getRowValue(row, ["branch", "영업소", "도착영업소"]),
          postal_code: getRowValue(row, ["postalCode", "우편번호"]),
        }))
        .filter((item) => item.branch);

      if (parsed.length === 0) {
        alert("읽을 수 있는 영업소 데이터가 없습니다.");
        return;
      }

      const { error } = await supabase
        .from("branch_master")
        .upsert(parsed, { onConflict: "branch" });

      if (error) {
        alert("영업소 업로드 실패: " + error.message);
        return;
      }

      await loadBranchMasterFromDb();
      alert(`영업소 우편번호 ${parsed.length}건 반영 완료`);
    } catch (error) {
      console.error(error);
      alert("영업소 엑셀 업로드 중 오류가 발생했습니다.");
    }
  };

  const resetReceiverForm = () => {
    setReceiverForm({
      name: "",
      aliases: [],
      phone: "",
      address: "",
      branch: "",
      note: "",
      postalCode: "",
    });
    setReceiverAliasesInput("");
    setReceiverMasterMode("new");
    setSelectedReceiverMasterName("");
  };

  const resetSenderForm = () => {
    setSenderForm({
      name: "",
      aliases: [],
      phone: "",
    });
    setSenderAliasesInput("");
    setSenderMasterMode("new");
    setSelectedSenderMasterName("");
  };

  const resetBranchForm = () => {
    setBranchForm({
      branch: "",
      postalCode: "",
    });
    setBranchMasterMode("new");
    setSelectedBranchMasterName("");
  };

  const saveReceiverMaster = async () => {
    const normalizedReceiverForm = {
      ...receiverForm,
      aliases: parseAliases(receiverAliasesInput),
    };

    if (!normalizedReceiverForm.name.trim()) {
      alert("수화주명을 입력해 주세요.");
      return;
    }

    const payload = {
      name: normalizedReceiverForm.name.trim(),
      aliases: normalizedReceiverForm.aliases ?? [],
      phone: normalizedReceiverForm.phone ?? "",
      address: normalizedReceiverForm.address ?? "",
      branch: normalizedReceiverForm.branch ?? "",
      note: normalizedReceiverForm.note ?? "",
      postal_code: normalizedReceiverForm.postalCode ?? "",
    };

    if (receiverMasterMode === "edit" && selectedReceiverMasterName) {
      const { error } = await supabase
        .from("receiver_master")
        .update(payload)
        .eq("name", selectedReceiverMasterName);

      if (error) {
        alert("수화주 수정 실패: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("receiver_master")
        .insert([payload]);

      if (error) {
        alert("수화주 저장 실패: " + error.message);
        return;
      }
    }

    await loadReceiverMasterFromDb();
    resetReceiverForm();
  };

  const saveSenderMaster = async () => {
    const normalizedSenderForm = {
      ...senderForm,
      aliases: parseAliases(senderAliasesInput),
    };

    if (!normalizedSenderForm.name.trim()) {
      alert("발화주명을 입력해 주세요.");
      return;
    }

    const payload = {
      name: normalizedSenderForm.name.trim(),
      aliases: normalizedSenderForm.aliases ?? [],
      phone: normalizedSenderForm.phone ?? "",
    };

    if (senderMasterMode === "edit" && selectedSenderMasterName) {
      const { error } = await supabase
        .from("sender_master")
        .update(payload)
        .eq("name", selectedSenderMasterName);

      if (error) {
        alert("발화주 수정 실패: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("sender_master")
        .insert([payload]);

      if (error) {
        alert("발화주 저장 실패: " + error.message);
        return;
      }
    }

    await loadSenderMasterFromDb();
    resetSenderForm();
  };

  const saveBranchMaster = async () => {
    if (!branchForm.branch.trim()) {
      alert("영업소명을 입력해 주세요.");
      return;
    }

    if (!branchForm.postalCode.trim()) {
      alert("우편번호를 입력해 주세요.");
      return;
    }

    const payload = {
      branch: branchForm.branch.trim(),
      postal_code: branchForm.postalCode.trim(),
    };

    if (branchMasterMode === "edit" && selectedBranchMasterName) {
      const { error } = await supabase
        .from("branch_master")
        .update(payload)
        .eq("branch", selectedBranchMasterName);

      if (error) {
        alert("영업소 수정 실패: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("branch_master")
        .insert([payload]);

      if (error) {
        alert("영업소 저장 실패: " + error.message);
        return;
      }
    }

    await loadBranchMasterFromDb();
    resetBranchForm();
  };

  const deleteReceiverMaster = async () => {
    if (!selectedReceiverMasterName) return;

    const { error } = await supabase
      .from("receiver_master")
      .delete()
      .eq("name", selectedReceiverMasterName);

    if (error) {
      alert("수화주 삭제 실패: " + error.message);
      return;
    }

    await loadReceiverMasterFromDb();
    resetReceiverForm();
  };

  const deleteSenderMaster = async () => {
    if (!selectedSenderMasterName) return;

    const { error } = await supabase
      .from("sender_master")
      .delete()
      .eq("name", selectedSenderMasterName);

    if (error) {
      alert("발화주 삭제 실패: " + error.message);
      return;
    }

    await loadSenderMasterFromDb();
    resetSenderForm();
  };

  const deleteBranchMaster = async () => {
    if (!selectedBranchMasterName) return;

    const { error } = await supabase
      .from("branch_master")
      .delete()
      .eq("branch", selectedBranchMasterName);

    if (error) {
      alert("영업소 삭제 실패: " + error.message);
      return;
    }

    await loadBranchMasterFromDb();
    resetBranchForm();
  };

  const handleWaybillUpload = async (file: File) => {
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" }) as Record<string, unknown>[];
      const parsedRows = parseWaybillUploadRows(rows);

      if (parsedRows.length === 0) {
        alert("읽을 수 있는 대신 발송데이터가 없습니다.");
        return;
      }

      setWaybillUploadRows(parsedRows);
      setWaybillUploadFileName(file.name);
      setVerificationKeyword("");
      setVerificationMismatchOnly(false);
      setCopiedWaybillMessageId("");
    } catch (error) {
      console.error(error);
      alert("대신 발송데이터 업로드 중 오류가 발생했습니다.");
    }
  };

  const resetWaybillUpload = () => {
    setWaybillUploadRows([]);
    setWaybillUploadFileName("");
    setVerificationKeyword("");
    setVerificationMismatchOnly(false);
    setCopiedWaybillMessageId("");

    if (typeof window !== "undefined") {
      localStorage.removeItem(WAYBILL_UPLOAD_STORAGE_KEY);
      localStorage.removeItem(WAYBILL_UPLOAD_FILE_NAME_KEY);
    }
  };

  const todayShipments = useMemo(() => {
    const todayKey = getTodaySeoulDateKey();
    return savedShipments.filter((shipment) => getSeoulDateKey(shipment.createdAt) === todayKey);
  }, [savedShipments]);

  const waybillVerificationRows = useMemo(
    () => buildWaybillVerificationRows(todayShipments, waybillUploadRows),
    [todayShipments, waybillUploadRows]
  );

  const filteredWaybillVerificationRows = useMemo(() => {
    const keyword = verificationKeyword.trim().toLowerCase();

    return waybillVerificationRows.filter((row) => {
      const matchesMismatch = verificationMismatchOnly ? row.status !== "일치" : true;
      const haystack = [
        row.shipmentListName,
        row.uploadListName,
        row.qtyText,
        row.deliveryText,
        row.payText,
        row.fareText,
        row.waybillNo,
        row.reasons.join(" "),
      ]
        .join(" ")
        .toLowerCase();

      return matchesMismatch && (!keyword || haystack.includes(keyword));
    });
  }, [waybillVerificationRows, verificationKeyword, verificationMismatchOnly]);

  const waybillVerificationSummary = useMemo(() => {
    return {
      shipmentCount: todayShipments.length,
      uploadCount: waybillUploadRows.length,
      matchedCount: waybillVerificationRows.filter((row) => row.status === "일치").length,
      warningCount: waybillVerificationRows.filter((row) => row.status === "확인필요").length,
      shipmentOnlyCount: waybillVerificationRows.filter((row) => row.status === "출고목록만").length,
      uploadOnlyCount: waybillVerificationRows.filter((row) => row.status === "발송데이터만").length,
    };
  }, [todayShipments, waybillUploadRows, waybillVerificationRows]);

  const waybillMessageRows = useMemo(() => {
    return waybillUploadRows
      .filter((row) => row.waybillNo)
      .map((row) => ({
        id: row.id,
        listName: buildWaybillListName(row.sender, row.receiver),
        message: buildWaybillMessageText({
          receiver: row.receiver,
          delivery: row.delivery,
          pay: row.pay,
          branch: row.branch,
          waybillNo: row.waybillNo,
        }),
      }))
      .filter((row) => row.message);
  }, [waybillUploadRows]);

  const handleCopyWaybillMessage = async (id: string, text: string) => {
    const copied = await copyTextSilently(text);
    if (!copied) return;

    setCopiedWaybillMessageId(id);
    window.setTimeout(() => {
      setCopiedWaybillMessageId((prev) => (prev === id ? "" : prev));
    }, 1200);
  };

  const waybillUploadControls = (
    <div style={verifyUploadBar}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          style={smallBlueBtn}
          onClick={() => waybillUploadRef.current?.click()}
        >
          대신 발송데이터 업로드
        </button>

        <button
          type="button"
          style={smallGrayBtn}
          onClick={resetWaybillUpload}
          disabled={waybillUploadRows.length === 0}
        >
          업로드 초기화
        </button>

        <input
          ref={waybillUploadRef}
          type="file"
          accept=".xls,.xlsx"
          style={{ display: "none" }}
          onChange={async (e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            if (file) await handleWaybillUpload(file);
            input.value = "";
          }}
        />
      </div>

      <div style={verifyUploadFileName}>
        {waybillUploadFileName
          ? `업로드 파일: ${waybillUploadFileName}`
          : "업로드 파일 없음"}
      </div>
    </div>
  );

  return (
    <main style={page}>
      <div style={card}>
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px"
        }}>
          <h1 style={title}>🚚 화물 출고 입력</h1>

          <div style={{
            padding: "5px 12px",
            borderRadius: "8px",
            background: "#f5f7fa",
            fontWeight: "bold",
            color: "#333"
          }}>
            {`${today}`}
          </div>
        </div>

        <div style={tabWrap}>
          {(["출고등록", "출고목록", "발송검증", "운송장문구", "마스터관리"] as TabType[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              style={{
                ...tabButton,
                background: tab === item ? "#2563eb" : "#e5e7eb",
                color: tab === item ? "#fff" : "#111827",
              }}
            >
              {item}
            </button>
          ))}
        </div>

        {tab === "출고등록" && (
          <>
            <div style={grid} data-enter-scope="form">
              <div>
                <Section title="받는 사람">
                  <div style={row2}>
                    <AutocompleteInput
                      label="수화주명"
                      value={receiver}
                      setValue={setReceiver}
                      matches={receiverMatches}
                      onSelect={applyReceiver}
                      onEnter={handleReceiverEnter}
                      focused={receiverFocused}
                      setFocused={setReceiverFocused}
                    />
                    <Input
                      label="전화번호"
                      value={receiverPhone}
                      set={setReceiverPhone}
                      inputRef={receiverPhoneInputRef}
                    />
                  </div>

                  {note && <div style={noteStyle}>⚠ {note}</div>}
                </Section>

                <Section title="운송정보">
                  <div style={row2}>
                    <Toggle
                      label="지불방법"
                      value={pay}
                      set={setPay}
                      options={["착불", "선불"]}
                    />
                    <Toggle
                      label="운송형태"
                      value={delivery}
                      set={(v) => {
                        setDelivery(v);
                        setPostalCode(
                          resolvePostalCodeValue({
                            delivery: v,
                            receiver,
                            branch,
                            currentPostalCode: "",
                          })
                        );
                        setFare(
                          suggestFareByQty({
                            qty,
                            delivery: v,
                            pack,
                            address,
                            branch,
                          })
                        );
                      }}
                      options={["정기", "택배"]}
                    />
                  </div>

                  <div style={{ ...row2, marginTop: 16 }}>
                    <Input label="수량" value={qty} set={handleQty} />
                    <Input label="운임" value={fare} set={setFare} />
                  </div>
                </Section>

                <Section title="보내는 사람">
                  <div style={row2}>
                    <AutocompleteInput
                      label="발화주명"
                      value={sender}
                      setValue={setSender}
                      matches={senderMatches}
                      onSelect={applySender}
                      onEnter={handleSenderEnter}
                      focused={senderFocused}
                      setFocused={setSenderFocused}
                    />
                    <Input
                      label="전화번호"
                      value={senderPhone}
                      set={setSenderPhone}
                      inputRef={senderPhoneInputRef}
                    />
                  </div>
                </Section>
              </div>

              <div>
                <Section title="품목 / 포장">
                  <div style={row2}>
                    <Input label="품명" value={item} set={setItem} />
                    <Input
                      label="박스"
                      value={pack}
                      set={(v) => {
                        setPack(v);
                        setFare(
                          suggestFareByQty({
                            qty,
                            delivery,
                            pack: v,
                            address,
                            branch,
                          })
                        );
                      }}
                    />
                  </div>
                </Section>

                <Section title="도착지정보">
                  {delivery === "택배" ? (
                    <div>
                      <div style={labelStyle}>주소</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          style={{ ...input, flex: 1 }}
                          value={address}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAddress(v);
                            setFare(
                              suggestFareByQty({
                                qty,
                                delivery,
                                pack,
                                address: v,
                                branch,
                              })
                            );
                          }}
                          onKeyDown={handleEnterMoveNext}
                          placeholder="주소 입력"
                        />

                        <button
                          type="button"
                          style={{
                            padding: "0 14px",
                            borderRadius: 10,
                            border: "none",
                            background: "#2563eb",
                            color: "#fff",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            setAddrKeyword(address || "");
                            setAddrResults([]);
                            setAddrSearched(false);
                            setShowAddrSearch(true);
                          }}
                        >
                          찾기
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Input
                      label="도착영업소"
                      value={branch}
                      set={(v) => {
                        setBranch(v);
                        setPostalCode(
                          resolvePostalCodeValue({
                            delivery: "정기",
                            receiver,
                            branch: v,
                            currentPostalCode: "",
                          })
                        );
                        setFare(
                          suggestFareByQty({
                            qty,
                            delivery,
                            pack,
                            address,
                            branch: v,
                          })
                        );
                      }}
                    />
                  )}
                </Section>

                <div style={{ marginTop: 20 }}>
                  <Section title="메모사항">
                    <Input label="메모" value={memo} set={setMemo} />
                  </Section>
                </div>
              </div>
            </div>

            <button style={saveBtn} onClick={handleSave}>
              저장
            </button>
          </>
        )}

        {tab === "출고목록" && (
          <div style={{ marginTop: 8 }}>
            <h2 style={listTitle}>출고목록</h2>

            <div style={{ marginBottom: "10px", fontWeight: "bold", color: "#555"}}>
              {listScope === "today"
                ? `📅 기준일자: 금일 (${today})`
                : "📅 기준일자: 전체"}
            </div>

            <div style={scopeBar}>
              <div style={scopeToggleWrap}>
                <button
                  type="button"
                  style={{
                    ...scopeToggleBtn,
                    background: listScope === "today" ? "#2563eb" : "#e5e7eb",
                    color: listScope === "today" ? "#fff" : "#111827",
                  }}
                  onClick={() => setListScope("today")}
                >
                  오늘만
                </button>

                <button
                  type="button"
                  style={{
                    ...scopeToggleBtn,
                    background: listScope === "all" ? "#2563eb" : "#e5e7eb",
                    color: listScope === "all" ? "#fff" : "#111827",
                  }}
                  onClick={() => setListScope("all")}
                >
                  전체
                </button>
              </div>

              <button type="button" style={smallRedBtn} onClick={clearTodayShipments}>
                오늘 목록 비우기
              </button>
            </div>

            <div style={filterBar}>
              <div style={filterFieldWide}>
                <div style={filterLabel}>업체명 검색</div>
                <input
                  style={filterInput}
                  value={filterKeyword}
                  onChange={(e) => setFilterKeyword(e.target.value)}
                  placeholder="업체명, 발화주, 수화주, 메모 검색"
                />
              </div>

              <div style={filterField}>
                <div style={filterLabel}>지불방법</div>
                <select
                  style={filterSelect}
                  value={payFilter}
                  onChange={(e) => setPayFilter(e.target.value as "전체" | PayType)}
                >
                  <option value="전체">전체</option>
                  <option value="착불">착불</option>
                  <option value="선불">선불</option>
                </select>
              </div>

              <div style={filterField}>
                <div style={filterLabel}>운송형태</div>
                <select
                  style={filterSelect}
                  value={deliveryFilter}
                  onChange={(e) =>
                    setDeliveryFilter(e.target.value as "전체" | DeliveryType)
                  }
                >
                  <option value="전체">전체</option>
                  <option value="정기">화물</option>
                  <option value="택배">택배</option>
                </select>
              </div>

              <label style={filterCheckLabel}>
                <input
                  type="checkbox"
                  checked={directOnly}
                  onChange={(e) => setDirectOnly(e.target.checked)}
                />
                직송건만
              </label>

              <label style={filterCheckLabel}>
                <input
                  type="checkbox"
                  checked={waybillUncheckedOnly}
                  onChange={(e) => setWaybillUncheckedOnly(e.target.checked)}
                />
                운송장 미체크
              </label>

              <label style={filterCheckLabel}>
                <input
                  type="checkbox"
                  checked={pdaUncheckedOnly}
                  onChange={(e) => setPdaUncheckedOnly(e.target.checked)}
                />
                PDA 미체크
              </label>

              <button type="button" style={resetFilterBtn} onClick={resetFilters}>
                필터 초기화
              </button>
            </div>

            <div style={exportBar}>

              <div style={exportRight}>
                <span style={selectedCountText}>선택 {selectedIds.length}건</span>
                <button type="button" style={exportBtnSecondary} onClick={exportSelected}>
                  선택 엑셀 다운로드
                </button>
                <button type="button" style={exportBtnPrimary} onClick={exportFilteredAll}>
                  현재목록 전체 엑셀 다운로드
                </button>
              </div>
            </div>

            {savedShipments.length === 0 ? (
              <div style={emptyText}>아직 저장된 출고건 없음</div>
            ) : filteredShipments.length === 0 ? (
              <div style={emptyText}>필터 조건에 맞는 출고건 없음</div>
            ) : (
              <>
                <div style={tableScroll}>
                  <div style={overviewWrap}>
                    <div style={groupHeaderRow}>
                      <div style={groupSelect}></div>
                      <div style={groupInfo}>출고정보</div>
                      <div style={groupChecklist}>체크리스트</div>
                      <div style={groupAction} />
                    </div>

                    <div style={{ ...overviewRow, ...overviewHeaderRow }}>
                      <div style={ovSelect}>
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleSelectAllFiltered}
                        />
                      </div>

                      <div style={ovDate}>출고일</div>
                      <div style={ovCompany}>업체명</div>
                      <div style={ovPay}>지불</div>
                      <div style={ovDelivery}>운송</div>
                      <div style={ovQty}>수량</div>
                      <div style={ovFare}>운임</div>

                      <div style={{ ...ovCheck, ...checkStartBorder }}>주문서</div>
                      <div style={ovCheck}>판매전표</div>
                      <div style={ovCheck}>PDA</div>
                      <div style={ovCheck}>운송장</div>

                      <div style={ovDelete}>삭제</div>
                    </div>

                    {sortedShipments.map((shipment) => {
                      const isToday =
                        new Date(shipment.createdAt).toDateString() === new Date().toDateString();

                      return (
                        <div key={shipment.id} style={overviewRow}>
                          <div style={ovSelect}>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(shipment.id)}
                              onChange={() => toggleSelectOne(shipment.id)}
                            />
                          </div>

                          <div
                            style={{
                              ...ovDate,
                              color: isToday ? "#2563eb" : "#6b7280",
                              fontWeight: isToday ? "bold" : "normal",
                            }}
                          >
                            {new Date(shipment.createdAt).toLocaleDateString("ko-KR")}
                          </div>

                          <div style={ovCompany}>
                            <button
                              type="button"
                              style={companyLinkBtn}
                              onClick={() => openDetail(shipment)}
                            >
                              {displayReceiverName(shipment.sender, shipment.receiver)}
                            </button>
                          </div>

                          <div style={ovPay}>{shipment.pay}</div>
                          <div style={ovDelivery}>{displayDelivery(shipment.delivery)}</div>
                          <div style={ovQty}>{ceilQuantityDisplay(shipment.qty, shipment.pack)}</div>
                          <div style={ovFare}>{formatFare(shipment.fare)}</div>

                          <div style={{ ...ovCheck, ...checkStartBorder }}>
                            <input
                              type="checkbox"
                              style={checkboxStyle}
                              checked={shipment.checklist.orderSheet}
                              onChange={() => handleChecklistToggle(shipment.id, "orderSheet")}
                            />
                          </div>

                          <div style={ovCheck}>
                            <input
                              type="checkbox"
                              style={checkboxStyle}
                              checked={shipment.checklist.salesSlip}
                              onChange={() => handleChecklistToggle(shipment.id, "salesSlip")}
                            />
                          </div>

                          <div style={ovCheck}>
                            <input
                              type="checkbox"
                              style={checkboxStyle}
                              checked={shipment.checklist.pda}
                              onChange={() => handleChecklistToggle(shipment.id, "pda")}
                            />
                          </div>

                          <div style={ovCheck}>
                            <input
                              type="checkbox"
                              style={checkboxStyle}
                              checked={shipment.checklist.waybill}
                              onChange={() => handleChecklistToggle(shipment.id, "waybill")}
                            />
                          </div>

                          <div style={ovDelete}>
                            <button type="button" style={deleteBtn} onClick={() => handleDelete(shipment.id)}>
                              삭제
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>

                  <div style={summaryBar}>
                    <span>건수: {summaryCount}건</span>
                    <span>총수량: {summaryQty}</span>
                  </div>
                </>
              )}
            </div>
          )}

        {tab === "발송검증" && (
          <div style={{ marginTop: 8 }}>
            <h2 style={listTitle}>발송검증</h2>

            <div style={verifyInfoText}>
              오늘 등록된 출고목록과 대신택배 발송데이터를 비교해. 정렬은 무시하고 내용 기준으로 맞춰준다.
            </div>

            {waybillUploadControls}

            <div style={verifySummaryGrid}>
              <div style={verifySummaryItem}>
                <div style={verifySummaryLabel}>오늘 출고목록</div>
                <div style={verifySummaryValue}>{waybillVerificationSummary.shipmentCount}건</div>
              </div>
              <div style={verifySummaryItem}>
                <div style={verifySummaryLabel}>발송데이터</div>
                <div style={verifySummaryValue}>{waybillVerificationSummary.uploadCount}건</div>
              </div>
              <div style={verifySummaryItem}>
                <div style={verifySummaryLabel}>일치</div>
                <div style={{ ...verifySummaryValue, color: "#15803d" }}>
                  {waybillVerificationSummary.matchedCount}건
                </div>
              </div>
              <div style={verifySummaryItem}>
                <div style={verifySummaryLabel}>확인필요</div>
                <div style={{ ...verifySummaryValue, color: "#b45309" }}>
                  {waybillVerificationSummary.warningCount}건
                </div>
              </div>
              <div style={verifySummaryItem}>
                <div style={verifySummaryLabel}>출고목록만</div>
                <div style={{ ...verifySummaryValue, color: "#dc2626" }}>
                  {waybillVerificationSummary.shipmentOnlyCount}건
                </div>
              </div>
              <div style={verifySummaryItem}>
                <div style={verifySummaryLabel}>발송데이터만</div>
                <div style={{ ...verifySummaryValue, color: "#7c3aed" }}>
                  {waybillVerificationSummary.uploadOnlyCount}건
                </div>
              </div>
            </div>

            <div style={verifyFilterBar}>
              <div style={{ ...filterFieldWide, minWidth: 260 }}>
                <div style={filterLabel}>검색</div>
                <input
                  style={filterInput}
                  value={verificationKeyword}
                  onChange={(e) => setVerificationKeyword(e.target.value)}
                  placeholder="업체명, 운송장번호, 확인사항 검색"
                />
              </div>

              <label style={{ ...filterCheckLabel, paddingBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={verificationMismatchOnly}
                  onChange={(e) => setVerificationMismatchOnly(e.target.checked)}
                />
                불일치만 보기
              </label>
            </div>

            {waybillUploadRows.length === 0 ? (
              <div style={emptyText}>대신 발송데이터를 업로드하면 여기서 바로 검증 결과가 보인다.</div>
            ) : filteredWaybillVerificationRows.length === 0 ? (
              <div style={emptyText}>조건에 맞는 검증 결과가 없습니다.</div>
            ) : (
              <div style={verifyTableWrap}>
                <table style={verifyTable}>
                  <thead>
                    <tr>
                      <th style={verifyHeaderCell}>상태</th>
                      <th style={verifyHeaderCell}>출고목록</th>
                      <th style={verifyHeaderCell}>발송데이터</th>
                      <th style={verifyHeaderCell}>수량</th>
                      <th style={verifyHeaderCell}>운송</th>
                      <th style={verifyHeaderCell}>지불</th>
                      <th style={verifyHeaderCell}>총운임</th>
                      <th style={verifyHeaderCell}>확인사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWaybillVerificationRows.map((row) => (
                      <tr key={row.id}>
                        <td style={verifyCell}>
                          <span
                            style={{
                              ...verifyBadge,
                              background:
                                row.status === "일치"
                                  ? "#dcfce7"
                                  : row.status === "확인필요"
                                    ? "#fef3c7"
                                    : row.status === "출고목록만"
                                      ? "#fee2e2"
                                      : "#ede9fe",
                              color:
                                row.status === "일치"
                                  ? "#166534"
                                  : row.status === "확인필요"
                                    ? "#92400e"
                                    : row.status === "출고목록만"
                                      ? "#b91c1c"
                                      : "#6d28d9",
                            }}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td style={verifyCell}>{row.shipmentListName || "-"}</td>
                        <td style={verifyCell}>{row.uploadListName || "-"}</td>
                        <td style={verifyCell}>{row.qtyText || "-"}</td>
                        <td style={verifyCell}>{row.deliveryText || "-"}</td>
                        <td style={verifyCell}>{row.payText || "-"}</td>
                        <td style={verifyCell}>{row.fareText || "-"}</td>
                        <td style={verifyCell}>{row.reasons.join(", ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "운송장문구" && (
          <div style={{ marginTop: 8 }}>
            <h2 style={listTitle}>운송장문구</h2>

            <div style={verifyInfoText}>
              문구 셀을 눌러도 복사되고, 오른쪽 복사 버튼을 눌러도 바로 복사된다. 팝업은 안 뜬다.
            </div>

            {waybillUploadControls}

            {waybillMessageRows.length === 0 ? (
              <div style={emptyText}>운송장번호가 들어 있는 대신 발송데이터를 업로드하면 문구가 생성된다.</div>
            ) : (
              <div style={verifyTableWrap}>
                <table style={verifyTable}>
                  <thead>
                    <tr>
                      <th style={verifyHeaderCell}>목록</th>
                      <th style={verifyHeaderCell}>운송장번호 안내문구</th>
                      <th style={verifyHeaderCell}>복사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waybillMessageRows.map((row) => (
                      <tr key={row.id}>
                        <td style={verifyCell}>{row.listName}</td>
                        <td style={verifyCell}>
                          <button
                            type="button"
                            style={messageCellButton}
                            onClick={() => void handleCopyWaybillMessage(row.id, row.message)}
                          >
                            {row.message}
                          </button>
                        </td>
                        <td style={verifyCell}>
                          <button
                            type="button"
                            style={copiedWaybillMessageId === row.id ? smallBlueBtn : smallGrayBtn}
                            onClick={() => void handleCopyWaybillMessage(row.id, row.message)}
                          >
                            {copiedWaybillMessageId === row.id ? "복사됨" : "복사"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "마스터관리" && (
          <div style={{ marginTop: 8 }}>
            <h2 style={listTitle}>마스터관리</h2>

            <div style={masterGrid}>
              <div style={masterCard}>
                <div style={masterTitleRow}>
                  <h3 style={masterTitle}>수화주 마스터</h3>
                  <div style={masterActionRow}>
                    <button type="button" style={smallGrayBtn} onClick={resetReceiverForm}>
                      신규
                    </button>
                    <button
                      type="button"
                      style={smallGrayBtn}
                      onClick={() => exportMasterTemplate("receiver")}
                    >
                      템플릿
                    </button>
                    <button
                      type="button"
                      style={smallGrayBtn}
                      onClick={() => exportCurrentMaster("receiver")}
                    >
                      내보내기
                    </button>
                    <button
                      type="button"
                      style={smallBlueBtn}
                      onClick={() => receiverUploadRef.current?.click()}
                    >
                      엑셀 업로드
                    </button>
                    <input
                      ref={receiverUploadRef}
                      type="file"
                      accept=".xlsx,.xls"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const input = e.target as HTMLInputElement;
                        const file = input.files?.[0];
                        if (file) await importReceiverMaster(file);
                        input.value = "";
                      }}
                    />
                  </div>
                </div>

                <input
                  style={filterInput}
                  value={receiverMasterKeyword}
                  onChange={(e) => setReceiverMasterKeyword(e.target.value)}
                  placeholder="수화주 검색"
                />

                <div style={masterList}>
                  {filteredReceiverMaster.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      style={{
                        ...masterListItem,
                        background: selectedReceiverMasterName === item.name ? "#eff6ff" : "#fff",
                        borderColor:
                          selectedReceiverMasterName === item.name ? "#60a5fa" : "#e5e7eb",
                      }}
                      onClick={() => {
                        setReceiverMasterMode("edit");
                        setSelectedReceiverMasterName(item.name);
                        setReceiverAliasesInput(aliasesToText(item.aliases));
                        setReceiverForm({ ...item, aliases: item.aliases || [] });
                      }}
                    >
                      <div style={masterListName}>{item.name}</div>
                      <div style={masterListSub}>
                        {(item.phone || "-")} / {(item.branch || "-")}
                      </div>
                    </button>
                  ))}
                </div>

                <div style={masterForm}>
                  <Input
                    label="수화주명"
                    value={receiverForm.name}
                    set={(v) => setReceiverForm((prev) => ({ ...prev, name: v }))}
                  />
                  <Input
                    label="검색명(콤마로 구분)"
                    value={receiverAliasesInput}
                    set={(v) => setReceiverAliasesInput(v)}
                  />
                  <Input
                    label="전화번호"
                    value={receiverForm.phone || ""}
                    set={(v) => setReceiverForm((prev) => ({ ...prev, phone: v }))}
                  />
                  <div>
                    <div style={labelStyle}>주소</div>
                    <input
                      style={input}
                      value={receiverForm.address || ""}
                      onChange={(e) =>
                        setReceiverForm((prev) => ({ ...prev, address: e.target.value }))
                      }
                      onBlur={async () => {
                        if (!receiverForm.address?.trim()) return;
                        try {
                          const zip = await lookupPostalCodeByAddress(receiverForm.address);
                          if (zip) {
                            setReceiverForm((prev) => ({ ...prev, postalCode: zip }));
                          }
                        } catch {
                          // ignore
                        }
                      }}
                    />
                    <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        style={smallGrayBtn}
                        onClick={async () => {
                          try {
                            const zip = await lookupPostalCodeByAddress(receiverForm.address || "");
                            setReceiverForm((prev) => ({ ...prev, postalCode: zip }));
                          } catch (error) {
                            alert(
                              error instanceof Error
                                ? error.message
                                : "우편번호 자동채움에 실패했습니다."
                            );
                          }
                        }}
                      >
                        우편번호 자동채움
                      </button>
                    </div>
                  </div>
                  <Input
                    label="도착영업소"
                    value={receiverForm.branch || ""}
                    set={(v) => setReceiverForm((prev) => ({ ...prev, branch: v }))}
                  />
                  <Input
                    label="우편번호"
                    value={receiverForm.postalCode || ""}
                    set={(v) => setReceiverForm((prev) => ({ ...prev, postalCode: v }))}
                  />
                  <Input
                    label="특기사항"
                    value={receiverForm.note || ""}
                    set={(v) => setReceiverForm((prev) => ({ ...prev, note: v }))}
                  />
                </div>

                <div style={masterBtnRow}>
                  <button type="button" style={smallGrayBtn} onClick={resetReceiverForm}>
                    초기화
                  </button>
                  {receiverMasterMode === "edit" && (
                    <button type="button" style={smallRedBtn} onClick={deleteReceiverMaster}>
                      삭제
                    </button>
                  )}
                  <button type="button" style={smallBlueBtn} onClick={saveReceiverMaster}>
                    저장
                  </button>
                </div>
              </div>

              <div style={masterCard}>
                <div style={masterTitleRow}>
                  <h3 style={masterTitle}>발화주 마스터</h3>
                  <div style={masterActionRow}>
                    <button type="button" style={smallGrayBtn} onClick={resetSenderForm}>
                      신규
                    </button>
                    <button
                      type="button"
                      style={smallGrayBtn}
                      onClick={() => exportMasterTemplate("sender")}
                    >
                      템플릿
                    </button>
                    <button
                      type="button"
                      style={smallGrayBtn}
                      onClick={() => exportCurrentMaster("sender")}
                    >
                      내보내기
                    </button>
                    <button
                      type="button"
                      style={smallBlueBtn}
                      onClick={() => senderUploadRef.current?.click()}
                    >
                      엑셀 업로드
                    </button>
                    <input
                      ref={senderUploadRef}
                      type="file"
                      accept=".xlsx,.xls"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const input = e.target as HTMLInputElement;
                        const file = input.files?.[0];
                        if (file) await importSenderMaster(file);
                        input.value = "";
                      }}
                    />
                  </div>
                </div>

                <input
                  style={filterInput}
                  value={senderMasterKeyword}
                  onChange={(e) => setSenderMasterKeyword(e.target.value)}
                  placeholder="발화주 검색"
                />

                <div style={masterList}>
                  {filteredSenderMaster.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      style={{
                        ...masterListItem,
                        background: selectedSenderMasterName === item.name ? "#eff6ff" : "#fff",
                        borderColor:
                          selectedSenderMasterName === item.name ? "#60a5fa" : "#e5e7eb",
                      }}
                      onClick={() => {
                        setSenderMasterMode("edit");
                        setSelectedSenderMasterName(item.name);
                        setSenderAliasesInput(aliasesToText(item.aliases));
                        setSenderForm({ ...item, aliases: item.aliases || [] });
                      }}
                    >
                      <div style={masterListName}>{item.name}</div>
                      <div style={masterListSub}>{item.phone || "-"}</div>
                    </button>
                  ))}
                </div>

                <div style={masterForm}>
                  <Input
                    label="발화주명"
                    value={senderForm.name}
                    set={(v) => setSenderForm((prev) => ({ ...prev, name: v }))}
                  />
                  <Input
                    label="검색명(콤마로 구분)"
                    value={senderAliasesInput}
                    set={(v) => setSenderAliasesInput(v)}
                  />
                  <Input
                    label="전화번호"
                    value={senderForm.phone || ""}
                    set={(v) => setSenderForm((prev) => ({ ...prev, phone: v }))}
                  />
                </div>

                <div style={masterBtnRow}>
                  <button type="button" style={smallGrayBtn} onClick={resetSenderForm}>
                    초기화
                  </button>
                  {senderMasterMode === "edit" && (
                    <button type="button" style={smallRedBtn} onClick={deleteSenderMaster}>
                      삭제
                    </button>
                  )}
                  <button type="button" style={smallBlueBtn} onClick={saveSenderMaster}>
                    저장
                  </button>
                </div>
              </div>

              <div style={masterCard}>
                <div style={masterTitleRow}>
                  <h3 style={masterTitle}>영업소 우편번호</h3>
                  <div style={masterActionRow}>
                    <button type="button" style={smallGrayBtn} onClick={resetBranchForm}>
                      신규
                    </button>
                    <button
                      type="button"
                      style={smallGrayBtn}
                      onClick={() => exportMasterTemplate("branch")}
                    >
                      템플릿
                    </button>
                    <button
                      type="button"
                      style={smallGrayBtn}
                      onClick={() => exportCurrentMaster("branch")}
                    >
                      내보내기
                    </button>
                    <button
                      type="button"
                      style={smallBlueBtn}
                      onClick={() => branchUploadRef.current?.click()}
                    >
                      엑셀 업로드
                    </button>
                    <input
                      ref={branchUploadRef}
                      type="file"
                      accept=".xlsx,.xls"
                      style={{ display: "none" }}
                      onChange={async (e) => {
                        const input = e.target as HTMLInputElement;
                        const file = input.files?.[0];
                        if (file) await importBranchMaster(file);
                        input.value = "";
                      }}
                    />
                  </div>
                </div>

                <input
                  style={filterInput}
                  value={branchMasterKeyword}
                  onChange={(e) => setBranchMasterKeyword(e.target.value)}
                  placeholder="영업소 검색"
                />

                <div style={masterList}>
                  {filteredBranchMaster.map((item) => (
                    <button
                      key={item.branch}
                      type="button"
                      style={{
                        ...masterListItem,
                        background: selectedBranchMasterName === item.branch ? "#eff6ff" : "#fff",
                        borderColor:
                          selectedBranchMasterName === item.branch ? "#60a5fa" : "#e5e7eb",
                      }}
                      onClick={() => {
                        setBranchMasterMode("edit");
                        setSelectedBranchMasterName(item.branch);
                        setBranchForm({ ...item });
                      }}
                    >
                      <div style={masterListName}>{item.branch}</div>
                      <div style={masterListSub}>{item.postalCode}</div>
                    </button>
                  ))}
                </div>

                <div style={masterForm}>
                  <Input
                    label="영업소명"
                    value={branchForm.branch}
                    set={(v) => setBranchForm((prev) => ({ ...prev, branch: v }))}
                  />
                  <Input
                    label="우편번호"
                    value={branchForm.postalCode}
                    set={(v) => setBranchForm((prev) => ({ ...prev, postalCode: v }))}
                  />
                </div>

                <div style={masterBtnRow}>
                  <button type="button" style={smallGrayBtn} onClick={resetBranchForm}>
                    초기화
                  </button>
                  {branchMasterMode === "edit" && (
                    <button type="button" style={smallRedBtn} onClick={deleteBranchMaster}>
                      삭제
                    </button>
                  )}
                  <button type="button" style={smallBlueBtn} onClick={saveBranchMaster}>
                    저장
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {detailOpen && editForm && (
          <div style={modalBackdrop} onClick={closeDetail}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={modalHeader}>
                <div>
                  <div style={detailTitle}>상세정보 수정</div>
                  <div style={detailSub}>
                    {displayReceiverName(editForm.sender, editForm.receiver)}
                  </div>
                </div>

                <div style={modalHeaderRight}>
                  {detailProgress && <ProgressBadge checklist={editForm.checklist} />}
                  <button type="button" style={modalCloseBtn} onClick={closeDetail}>
                    닫기
                  </button>
                </div>
              </div>

              <div style={modalSectionTitle}>받는 사람</div>
              <div style={detailEditGrid}>
                <Input
                  label="수화주명"
                  value={editForm.receiver}
                  set={(v) => updateEditField("receiver", v)}
                />
                <Input
                  label="수화주전화"
                  value={editForm.receiverPhone}
                  set={(v) => updateEditField("receiverPhone", v)}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                {editForm.delivery === "택배" ? (
                  <Input
                    label="주소"
                    value={editForm.address}
                    set={(v) => {
                      updateEditField("address", v);
                      updateEditField(
                        "fare",
                        suggestFareByQty({
                          qty: editForm.qty,
                          delivery: editForm.delivery,
                          pack: editForm.pack,
                          address: v,
                          branch: editForm.branch,
                        })
                      );
                    }}
                  />
                ) : (
                  <Input
                    label="도착영업소"
                    value={editForm.branch}
                    set={(v) => {
                      updateEditField("branch", v);
                      updateEditField(
                        "postalCode",
                        resolvePostalCodeValue({
                          delivery: "정기",
                          receiver: editForm.receiver,
                          branch: v,
                          currentPostalCode: "",
                        })
                      );
                      updateEditField(
                        "fare",
                        suggestFareByQty({
                          qty: editForm.qty,
                          delivery: editForm.delivery,
                          pack: editForm.pack,
                          address: editForm.address,
                          branch: v,
                        })
                      );
                    }}
                  />
                )}
              </div>

              <div style={{ ...detailEditGrid, marginTop: 14 }}>
                <div>
                  <div style={labelStyle}>우편번호</div>
                  <div style={fareRow}>
                    <input
                      style={input}
                      value={editForm.postalCode}
                      onChange={(e) => updateEditField("postalCode", e.target.value)}
                    />
                    <button
                      type="button"
                      style={recalcBtn}
                      onClick={async () => {
                        try {
                          if (editForm.delivery === "택배") {
                            const zip = await lookupPostalCodeByAddress(editForm.address);
                            updateEditField("postalCode", zip);
                          } else {
                            updateEditField(
                              "postalCode",
                              resolvePostalCodeValue({
                                delivery: editForm.delivery,
                                receiver: editForm.receiver,
                                branch: editForm.branch,
                                currentPostalCode: "",
                              })
                            );
                          }
                        } catch (error) {
                          alert(
                            error instanceof Error
                              ? error.message
                              : "우편번호 자동채움에 실패했습니다."
                          );
                        }
                      }}
                    >
                      자동채움
                    </button>
                  </div>
                </div>
                <div />
              </div>

              <div style={modalSectionTitle}>보내는 사람</div>
              <div style={detailEditGrid}>
                <Input
                  label="발화주명"
                  value={editForm.sender}
                  set={(v) => updateEditField("sender", v)}
                />
                <Input
                  label="발화주전화"
                  value={editForm.senderPhone}
                  set={(v) => updateEditField("senderPhone", v)}
                />
              </div>

              <div style={modalSectionTitle}>운송정보</div>
              <div style={detailEditGrid}>
                <Input label="품명" value={editForm.item} set={(v) => updateEditField("item", v)} />
                <Input
                  label="포장형태"
                  value={editForm.pack}
                  set={(v) => {
                    updateEditField("pack", v);
                    updateEditField(
                      "fare",
                      suggestFareByQty({
                        qty: editForm.qty,
                        delivery: editForm.delivery,
                        pack: v,
                        address: editForm.address,
                        branch: editForm.branch,
                      })
                    );
                  }}
                />
              </div>

              <div style={{ ...detailEditGrid, marginTop: 14 }}>
                <Toggle
                  label="지불방법"
                  value={editForm.pay}
                  set={(v) => updateEditField("pay", v)}
                  options={["착불", "선불"]}
                />
                <Toggle
                  label="운송형태"
                  value={editForm.delivery}
                  set={(v) => {
                    updateEditField("delivery", v);
                    updateEditField(
                      "postalCode",
                      resolvePostalCodeValue({
                        delivery: v,
                        receiver: editForm.receiver,
                        branch: editForm.branch,
                        currentPostalCode: "",
                      })
                    );
                    updateEditField(
                      "fare",
                      suggestFareByQty({
                        qty: editForm.qty,
                        delivery: v,
                        pack: editForm.pack,
                        address: editForm.address,
                        branch: editForm.branch,
                      })
                    );
                  }}
                  options={["정기", "택배"]}
                />
              </div>

              <div style={{ ...detailEditGrid, marginTop: 14 }}>
                <Input
                  label="수량"
                  value={editForm.qty}
                  set={(v) => {
                    updateEditField("qty", v);
                    updateEditField(
                      "fare",
                      suggestFareByQty({
                        qty: v,
                        delivery: editForm.delivery,
                        pack: editForm.pack,
                        address: editForm.address,
                        branch: editForm.branch,
                      })
                    );
                  }}
                />
                <div>
                  <div style={labelStyle}>운임</div>
                  <div style={fareRow}>
                    <input
                      style={input}
                      value={editForm.fare}
                      onChange={(e) => updateEditField("fare", e.target.value)}
                    />
                    <button
                      type="button"
                      style={recalcBtn}
                      onClick={() =>
                        updateEditField(
                          "fare",
                          suggestFareByQty({
                            qty: editForm.qty,
                            delivery: editForm.delivery,
                            pack: editForm.pack,
                            address: editForm.address,
                            branch: editForm.branch,
                          })
                        )
                      }
                    >
                      재계산
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <Input label="특기사항" value={editForm.note} set={(v) => updateEditField("note", v)} />
              </div>

              <div style={{ marginTop: 14 }}>
                <Input label="메모사항" value={editForm.memo} set={(v) => updateEditField("memo", v)} />
              </div>

              <div style={modalFooter}>
                <button type="button" style={cancelBtn} onClick={closeDetail}>
                  취소
                </button>
                <button type="button" style={modalSaveBtn} onClick={handleSaveDetail}>
                  저장
                </button>
              </div>
            </div>
          </div>
        )}
        {showAddrSearch && (
          <div style={modalBackdrop}>
            <div style={modalCard}>
              <h3>주소 검색</h3>

              <input
                style={{ ...input, marginBottom: 10 }}
                value={addrKeyword}
                onChange={(e) => setAddrKeyword(e.target.value)}
                placeholder="주소 입력"
              />

              <button
                style={modalSaveBtn}
                onClick={async () => {
                  try {
                    const result = await searchAddress(addrKeyword);
                    console.log("주소검색 결과", result);
                    setAddrResults(result);
                    setAddrSearched(true);
                  } catch (error) {
                    console.error("주소검색 실패", error);
                    alert(
                      error instanceof Error
                        ? error.message
                        : "주소검색에 실패했습니다."
                    );
                    setAddrResults([]);
                    setAddrSearched(true);
                  }
                }}
              >
                검색
              </button>

              <div style={{ marginTop: 10, maxHeight: 300, overflow: "auto" }}>
                {addrKeyword.trim() && addrSearched && addrResults.length === 0 && (
                  <div style={{ marginTop: 12, color: "#6b7280", fontSize: 14 }}>
                    검색 결과가 없습니다. 검색어를 더 자세히 입력해 주세요.
                  </div>
                )}
                {addrResults.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 10,
                      borderBottom: "1px solid #eee",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      setAddress(item.roadAddr);
                      setPostalCode(item.zipNo);

                      // 운임도 자동 반영
                      setFare(
                        suggestFareByQty({
                          qty,
                          delivery,
                          pack,
                          address: item.roadAddr,
                          branch,
                        })
                      );

                      setAddrResults([]);
                      setAddrKeyword("");
                      setAddrSearched(false);
                      setShowAddrSearch(false);
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{item.roadAddr}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {item.jibunAddr}
                    </div>
                  </div>
                ))}
              </div>

              <button
                style={cancelBtn}
                onClick={() => {
                  setAddrResults([]);
                  setAddrKeyword("");
                  setAddrSearched(false);
                  setShowAddrSearch(false);
                }}
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Input({
  label,
  value,
  set,
  inputRef,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input
        ref={inputRef}
        style={input}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={handleEnterMoveNext}
      />
    </div>
  );
}

function AutocompleteInput({
  label,
  value,
  setValue,
  matches,
  onSelect,
  onEnter,
  focused,
  setFocused,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  matches: Party[];
  onSelect: (party: Party) => void;
  onEnter: () => void;
  focused: boolean;
  setFocused: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [value, matches.length, focused]);

  const confirmSelection = (party: Party) => {
    onSelect(party);
    setHighlightedIndex(0);

    window.setTimeout(() => {
      if (inputRef.current) {
        focusNextFormField(inputRef.current);
      }
    }, 0);
  };

  return (
    <div style={{ position: "relative" }}>
      <div style={labelStyle}>{label}</div>
      <input
        ref={inputRef}
        style={input}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setHighlightedIndex(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && matches.length > 0) {
            e.preventDefault();
            setFocused(true);
            setHighlightedIndex((prev) => Math.min(prev + 1, matches.length - 1));
            return;
          }

          if (e.key === "ArrowUp" && matches.length > 0) {
            e.preventDefault();
            setFocused(true);
            setHighlightedIndex((prev) => Math.max(prev - 1, 0));
            return;
          }

          if (e.key === "Escape") {
            setFocused(false);
            return;
          }

          if (e.key === "Enter") {
            e.preventDefault();

            if (focused && value.trim() && matches.length > 0) {
              confirmSelection(matches[highlightedIndex] ?? matches[0]);
              return;
            }

            onEnter();

            window.setTimeout(() => {
              if (inputRef.current) {
                focusNextFormField(inputRef.current);
              }
            }, 0);
          }
        }}
      />
      {focused && value.trim() && matches.length > 0 && (
        <div style={dropdown}>
          {matches.map((party, index) => (
            <button
              key={party.name}
              type="button"
              style={{
                ...dropdownItem,
                background: index === highlightedIndex ? "#eff6ff" : "#fff",
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => confirmSelection(party)}
            >
              <div style={{ fontWeight: 700 }}>{party.name}</div>
              {party.aliases && party.aliases.length > 0 && (
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  검색명: {party.aliases.join(", ")}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle<T extends string>({
  label,
  value,
  set,
  options,
}: {
  label: string;
  value: T;
  set: (v: T) => void;
  options: T[];
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={toggleWrap}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => set(o)}
            style={{
              ...toggleBtn,
              background: value === o ? "#2563eb" : "#e5e7eb",
              color: value === o ? "#fff" : "#111827",
            }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 50 }}>
      <h2 style={section}>{title}</h2>
      {children}
    </div>
  );
}

function DetailItem({
  label,
  children,
  full = false,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div style={full ? detailItemFull : detailItem}>
      <div style={detailLabel}>{label}</div>
      <div style={detailValue}>{children}</div>
    </div>
  );
}

async function searchAddress(keyword: string) {
  const confmKey = "U01TX0FVVEgyMDI2MDQxNTIxNDQ0NzExNzkzODk=";

  const trimmed = keyword.trim();
  if (trimmed.length < 2) {
    throw new Error("주소를 2글자 이상 입력해 주세요.");
  }

  const url =
    `https://business.juso.go.kr/addrlink/addrLinkApi.do` +
    `?confmKey=${confmKey}` +
    `&currentPage=1` +
    `&countPerPage=10` +
    `&keyword=${encodeURIComponent(trimmed)}` +
    `&resultType=json`;

  const res = await fetch(url);
  const data = await res.json();

  console.log("Juso raw data:", data);

  const common = data?.results?.common;
  const juso = data?.results?.juso || [];

  if (!common) {
    throw new Error("주소검색 응답 형식이 올바르지 않습니다.");
  }

  if (common.errorCode !== "0") {
    throw new Error(`${common.errorCode} / ${common.errorMessage}`);
  }

  return juso;
}

async function lookupPostalCodeByAddress(address: string) {
  const results = await searchAddress(address);
  if (!results || results.length === 0) return "";

  const exact = results.find(
    (item: any) =>
      String(item.roadAddr || "").replace(/\s/g, "") ===
      String(address || "").replace(/\s/g, "")
  );

  return exact?.zipNo || results[0]?.zipNo || "";
}

function ProgressBadge({ checklist }: { checklist: Checklist }) {
  const progress = checklistProgress(checklist);
  return <div style={progressBadge}>완료율 {progress.percent}%</div>;
}


const verifyUploadBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "14px 16px",
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  marginBottom: 14,
};

const verifyUploadFileName: CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  fontWeight: 700,
};

const verifyInfoText: CSSProperties = {
  marginBottom: 12,
  color: "#475569",
  fontSize: 14,
  lineHeight: 1.5,
};

const verifySummaryGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",
  gap: 12,
  marginBottom: 14,
};

const verifySummaryItem: CSSProperties = {
  padding: "14px 16px",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#fff",
};

const verifySummaryLabel: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 700,
  marginBottom: 6,
};

const verifySummaryValue: CSSProperties = {
  fontSize: 22,
  color: "#111827",
  fontWeight: 800,
};

const verifyFilterBar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "end",
  gap: 12,
  marginBottom: 14,
};

const verifyTableWrap: CSSProperties = {
  overflowX: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 16,
};

const verifyTable: CSSProperties = {
  width: "100%",
  minWidth: 980,
  borderCollapse: "separate",
  borderSpacing: 0,
  background: "#fff",
};

const verifyHeaderCell: CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  fontSize: 13,
  fontWeight: 800,
  color: "#475569",
  background: "#f8fafc",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
};

const verifyCell: CSSProperties = {
  padding: "14px 16px",
  fontSize: 14,
  color: "#111827",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};

const verifyBadge: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 72,
  padding: "6px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
};

const messageCellButton: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  margin: 0,
  color: "#111827",
  textAlign: "left",
  cursor: "pointer",
  width: "100%",
  fontSize: 14,
  lineHeight: 1.5,
};
const page: CSSProperties = {
  background: "#f3f4f6",
  padding: 32,
  minHeight: "100vh",
};

const card: CSSProperties = {
  maxWidth: 1320,
  margin: "0 auto",
  background: "#fff",
  padding: 30,
  borderRadius: 18,
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
};

const title: CSSProperties = {
  fontSize: 30,
  fontWeight: 800,
  marginBottom: 24,
};

const tabWrap: CSSProperties = {
  display: "flex",
  gap: 10,
  marginBottom: 26,
};

const tabButton: CSSProperties = {
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 700,
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 80,
};

const section: CSSProperties = {
  borderBottom: "1px solid #ddd",
  marginBottom: 12,
  paddingBottom: 8,
  fontSize: 18,
  fontWeight: 700,
};

const row2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 16,
};

const input: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  fontSize: 16,
  background: "#fff",
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  marginBottom: 6,
  fontWeight: 700,
};

const saveBtn: CSSProperties = {
  width: "100%",
  marginTop: 20,
  padding: 15,
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  fontSize: 16,
  fontWeight: 800,
  cursor: "pointer",
};

const toggleWrap: CSSProperties = {
  display: "flex",
  gap: 8,
};

const toggleBtn: CSSProperties = {
  padding: "10px 16px",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 700,
};

const noteStyle: CSSProperties = {
  marginTop: 10,
  color: "#dc2626",
  fontSize: 13,
  fontWeight: 600,
};

const dropdown: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 20,
  marginTop: 6,
  background: "#fff",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
  overflow: "hidden",
};

const dropdownItem: CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  background: "#fff",
  cursor: "pointer",
  borderBottom: "1px solid #f3f4f6",
};

const listTitle: CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  marginBottom: 14,
};

const emptyText: CSSProperties = {
  color: "#6b7280",
  fontSize: 14,
};

const scopeBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
};

const scopeToggleWrap: CSSProperties = {
  display: "flex",
  gap: 8,
};

const scopeToggleBtn: CSSProperties = {
  border: "none",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};

const filterBar: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2fr 120px 120px auto auto auto auto",
  gap: 12,
  alignItems: "end",
  padding: "14px 16px",
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  marginBottom: 14,
};

const filterFieldWide: CSSProperties = {
  display: "grid",
  gap: 6,
};

const filterField: CSSProperties = {
  display: "grid",
  gap: 6,
};

const filterLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#6b7280",
};

const filterInput: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "#fff",
};

const filterSelect: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "#fff",
};

const filterCheckLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
  fontWeight: 600,
  paddingBottom: 10,
};

const resetFilterBtn: CSSProperties = {
  border: "none",
  background: "#e5e7eb",
  color: "#111827",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const exportBar: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 16,
  marginBottom: 12,
};

const selectAllLabel: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
  fontWeight: 700,
};

const exportRight: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const selectedCountText: CSSProperties = {
  fontSize: 14,
  color: "#6b7280",
  fontWeight: 700,
};

const exportBtnPrimary: CSSProperties = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 800,
};

const exportBtnSecondary: CSSProperties = {
  border: "none",
  background: "#e5e7eb",
  color: "#111827",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const tableScroll: CSSProperties = {
  overflowX: "auto",
};

const overviewWrap: CSSProperties = {
  display: "grid",
  gap: 8,
  minWidth: 1030,
};

const groupHeaderRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "52px 1.5fr 3fr 1fr 1fr 1.1fr 1.2fr 80px 90px 70px 80px 88px",
  gap: 10,
  alignItems: "center",
  fontSize: 13,
  fontWeight: 800,
  color: "#6b7280",
  marginBottom: 2,
};

const groupSelect: CSSProperties = {
  gridColumn: "1 / 2",
};

const groupInfo: CSSProperties = {
  gridColumn: "2 / 7",
  paddingLeft: 8,
};

const groupChecklist: CSSProperties = {
  gridColumn: "7 / 11",
  paddingLeft: 12,
};

const groupAction: CSSProperties = {
  gridColumn: "11 / 12",
};

const overviewRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "52px 1.5fr 3fr 1fr 1fr 1.1fr 1.2fr 80px 90px 70px 80px 88px",
  gap: 10,
  alignItems: "center",
  padding: "16px 14px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  minHeight: 64,
};

const overviewHeaderRow: CSSProperties = {
  background: "#f3f4f6",
  fontWeight: 800,
  minHeight: 52,
};

const ovSelect: CSSProperties = {
  display: "flex",
  justifyContent: "center",
};

const ovCompany: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const ovPay: CSSProperties = {
  textAlign: "center",
};

const ovDelivery: CSSProperties = {
  textAlign: "center",
};

const ovQty: CSSProperties = {
  textAlign: "center",
};

const ovFare: CSSProperties = {
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const ovCheck: CSSProperties = {
  textAlign: "center",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const ovDelete: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const checkStartBorder: CSSProperties = {
  borderLeft: "2px solid #d1d5db",
  paddingLeft: 10,
};

const checkboxStyle: CSSProperties = {
  width: 22,
  height: 22,
  cursor: "pointer",
  accentColor: "#2563eb",
};

const companyLinkBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  margin: 0,
  color: "#1d4ed8",
  fontWeight: 700,
  cursor: "pointer",
  textAlign: "left",
};

const deleteBtn: CSSProperties = {
  border: "none",
  background: "#ef4444",
  color: "#fff",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};

const summaryBar: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 18,
  marginTop: 14,
  fontSize: 15,
  fontWeight: 800,
  color: "#374151",
};

const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 999,
};

const modalCard: CSSProperties = {
  width: "100%",
  maxWidth: 960,
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#fff",
  borderRadius: 18,
  padding: 24,
  boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
};

const modalHeader: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 20,
};

const modalHeaderRight: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const modalCloseBtn: CSSProperties = {
  border: "none",
  background: "#e5e7eb",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const detailTitle: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
};

const detailSub: CSSProperties = {
  marginTop: 4,
  fontSize: 14,
  color: "#6b7280",
};

const progressBadge: CSSProperties = {
  border: "1px solid #2563eb",
  color: "#2563eb",
  borderRadius: 999,
  padding: "8px 14px",
  fontWeight: 800,
  fontSize: 14,
  background: "#fff",
};


const detailGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
};

const detailItem: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
};

const detailItemFull: CSSProperties = {
  gridColumn: "1 / -1",
  padding: "12px 14px",
  borderRadius: 12,
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
};

const detailLabel: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 6,
  fontWeight: 700,
};

const detailValue: CSSProperties = {
  fontSize: 15,
  color: "#111827",
  fontWeight: 600,
  wordBreak: "break-word",
};


const modalSectionTitle: CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  marginTop: 22,
  marginBottom: 10,
  borderBottom: "1px solid #e5e7eb",
  paddingBottom: 6,
};

const detailEditGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
};

const fareRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 10,
};

const recalcBtn: CSSProperties = {
  border: "none",
  background: "#e5e7eb",
  borderRadius: 10,
  padding: "0 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const modalFooter: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 24,
};

const cancelBtn: CSSProperties = {
  border: "none",
  background: "#e5e7eb",
  color: "#111827",
  borderRadius: 10,
  padding: "12px 18px",
  cursor: "pointer",
  fontWeight: 700,
};

const modalSaveBtn: CSSProperties = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "12px 18px",
  cursor: "pointer",
  fontWeight: 800,
};

const masterGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 18,
};

const masterCard: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
  display: "grid",
  gap: 12,
  alignSelf: "start",
};

const masterTitleRow: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 10,
};

const masterActionRow: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const masterTitle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
};

const masterList: CSSProperties = {
  display: "grid",
  gap: 8,
  maxHeight: 260,
  overflowY: "auto",
  paddingRight: 4,
};

const masterListItem: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "10px 12px",
  cursor: "pointer",
  textAlign: "left",
};

const ovDate: CSSProperties = {
  textAlign: "center",
  fontSize: 13,
  color: "#6b7280",
};

const masterListName: CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "#111827",
};

const masterListSub: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginTop: 4,
};

const masterForm: CSSProperties = {
  display: "grid",
  gap: 10,
};

const masterBtnRow: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const smallGrayBtn: CSSProperties = {
  border: "none",
  background: "#e5e7eb",
  color: "#111827",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
};

const smallBlueBtn: CSSProperties = {
  border: "none",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 800,
};

const smallRedBtn: CSSProperties = {
  border: "none",
  background: "#ef4444",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
};