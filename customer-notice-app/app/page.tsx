"use client";

import { useEffect, useRef, useState } from "react";
import * as htmlToImage from "html-to-image";

type ViewMode = "holiday" | "shipping";
type ScheduleType = "상차" | "배송";

type CalendarDay = {
  year: number;
  month: number;
  day: number;
  isCurrentMonth: boolean;
};

export default function Home() {
  const ref = useRef<HTMLDivElement>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("holiday");

  const today = new Date();
  
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [title, setTitle] = useState("상화시스템 휴무 안내");
  const [notice1, setNotice1] = useState("예) MM.DD 휴무이름");
  const [notice2, setNotice2] = useState(
    "** 업무에 참고 부탁드립니다."
  );

  const [shippingTitle, setShippingTitle] = useState(" 배송 스케줄 ");
  const [shippingMemo, setShippingMemo] = useState(
    "** 가급적 상차일 오전 9시 이전에 주문서 입력 부탁드립니다.\n** 화물/배송 구분은 비고란에 꼭 표시 부탁드립니다."
  );

  const [holidayDays, setHolidayDays] = useState("");

  const [templateName, setTemplateName] = useState("");
  const [savedTemplates, setSavedTemplates] = useState<string[]>([]);

  const [shippingMarks, setShippingMarks] = useState<Record<string, ScheduleType>>({});

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    dateKey: string;
  } | null>(null);

  const selectedHolidayDays = holidayDays
    .split(",")
    .map((day) => day.trim())
    .filter((day) => day !== "")
    .map((day) => Number(day))
    .filter((day) => !Number.isNaN(day) && day >= 1 && day <= 31);

  const getDateKey = (date: CalendarDay) => {
    return `${date.year}-${String(date.month).padStart(2, "0")}-${String(
      date.day
    ).padStart(2, "0")}`;
  };

  const downloadImage = async () => {
    if (!ref.current) return;

    setContextMenu(null);

    const dataUrl = await htmlToImage.toPng(ref.current, {
      pixelRatio: 2,
    });

    const link = document.createElement("a");
    link.download = viewMode === "holiday" ? "휴무공지이미지.png" : "배송스케줄이미지.png";
    link.href = dataUrl;
    link.click();
  };

  const generateCalendar = () => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();
    const prevLastDate = new Date(year, month - 1, 0).getDate();

    const weeks: CalendarDay[][] = [];
    let week: CalendarDay[] = [];

    const prevMonthDate = new Date(year, month - 2, 1);
    const nextMonthDate = new Date(year, month, 1);

    const prevYear = prevMonthDate.getFullYear();
    const prevMonth = prevMonthDate.getMonth() + 1;

    const nextYear = nextMonthDate.getFullYear();
    const nextMonth = nextMonthDate.getMonth() + 1;

    for (let i = firstDay - 1; i >= 0; i--) {
      week.push({
        year: prevYear,
        month: prevMonth,
        day: prevLastDate - i,
        isCurrentMonth: false,
      });
    }

    for (let date = 1; date <= lastDate; date++) {
      week.push({
        year,
        month,
        day: date,
        isCurrentMonth: true,
      });

      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }

    let nextDay = 1;

    if (week.length > 0) {
      while (week.length < 7) {
        week.push({
          year: nextYear,
          month: nextMonth,
          day: nextDay,
          isCurrentMonth: false,
        });
        nextDay++;
      }

      weeks.push(week);
    }

    while (weeks.length < 6) {
      const newWeek: CalendarDay[] = [];

      for (let i = 0; i < 7; i++) {
        newWeek.push({
          year: nextYear,
          month: nextMonth,
          day: nextDay,
          isCurrentMonth: false,
        });
        nextDay++;
      }

      weeks.push(newWeek);
    }

    return weeks;
  };

  const calendar = generateCalendar();

  const getKoreanDay = (day: number) => {
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    return dayNames[new Date(year, month - 1, day).getDay()];
  };

  const makeHolidayNoticeText = (days: number[]) => {
    if (days.length === 0) return "";

    return days
      .map((day) => {
        const yoil = getKoreanDay(day);
        return `▶ ${String(month).padStart(2, "0")}.${String(day).padStart(
          2,
          "0"
        )} (${yoil}) : 휴무`;
      })
      .join("\n");
  };

  const toggleHolidayDay = (day: number | "") => {
    if (day === "") return;

    const updatedDays = selectedHolidayDays.includes(day)
      ? selectedHolidayDays.filter((d) => d !== day)
      : [...selectedHolidayDays, day].sort((a, b) => a - b);

    setHolidayDays(updatedDays.join(","));
    setNotice1(makeHolidayNoticeText(updatedDays));
  };

  const openScheduleMenu = (
    e: React.MouseEvent<HTMLTableCellElement>,
    date: CalendarDay
  ) => {
    e.preventDefault();

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      dateKey: getDateKey(date),
    });
  };

  const setScheduleMark = (type: ScheduleType) => {
    if (!contextMenu) return;

    setShippingMarks((prev) => ({
      ...prev,
      [contextMenu.dateKey]: type,
    }));

    setContextMenu(null);
  };

  const removeScheduleMark = () => {
    if (!contextMenu) return;

    setShippingMarks((prev) => {
      const copy = { ...prev };
      delete copy[contextMenu.dateKey];
      return copy;
    });

    setContextMenu(null);
  };

  const clearAllShippingMarks = () => {
    setShippingMarks({});
    setContextMenu(null);
  };

  useEffect(() => {
    refreshTemplateList();
  }, []);

  const refreshTemplateList = () => {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("notice-template-")
    );

    setSavedTemplates(keys.map((key) => key.replace("notice-template-", "")));
  };

  const saveTemplate = () => {
    if (!templateName.trim()) {
      alert("템플릿 이름을 입력해 주세요.");
      return;
    }

    const templateData = {
      year,
      month,
      title,
      notice1,
      notice2,
      holidayDays,
      shippingTitle,
      shippingMemo,
      shippingMarks,
    };

    localStorage.setItem(
      `notice-template-${templateName}`,
      JSON.stringify(templateData)
    );

    refreshTemplateList();
    alert("템플릿 저장 완료!");
  };

  const loadTemplate = (name: string) => {
    const saved = localStorage.getItem(`notice-template-${name}`);
    if (!saved) return;

    const data = JSON.parse(saved);

    setYear(data.year);
    setMonth(data.month);
    setTitle(data.title);
    setNotice1(data.notice1);
    setNotice2(data.notice2);
    setHolidayDays(data.holidayDays);
    setShippingTitle(data.shippingTitle);
    setShippingMemo(data.shippingMemo);
    setShippingMarks(data.shippingMarks || {});

    setTemplateName(name);
  };

  const deleteTemplate = (name: string) => {
    localStorage.removeItem(`notice-template-${name}`);
    refreshTemplateList();
  };

  return (
    <div
      className="flex p-6 gap-6 bg-[#f8f8f8] min-h-screen"
      onClick={() => setContextMenu(null)}
    >
      {/* 왼쪽 입력 */}
      <div className="w-1/3 bg-white p-4 rounded shadow space-y-4">
        <h2 className="text-xl font-bold">공지 설정</h2>

        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("holiday")}
            className={`w-1/2 px-4 py-2 rounded font-bold ${
              viewMode === "holiday"
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-black"
            }`}
          >
            휴무 공지
          </button>

          <button
            onClick={() => setViewMode("shipping")}
            className={`w-1/2 px-4 py-2 rounded font-bold ${
              viewMode === "shipping"
                ? "bg-green-600 text-white"
                : "bg-gray-200 text-black"
            }`}
          >
            배송 스케줄
          </button>
        </div>

        <div className="text-sm font-semibold">연도 / 월</div>
        <div className="flex gap-2">
          <input
            type="number"
            className="w-1/2 border p-2"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
          <input
            type="number"
            className="w-1/2 border p-2"
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          />
        </div>

        {viewMode === "holiday" && (
          <>
            <div className="text-sm font-semibold">휴무일 (쉼표로 구분)</div>
            <input
              className="w-full border p-2"
              value={holidayDays}
              onChange={(e) => setHolidayDays(e.target.value)}
            />
          </>
        )}

        {viewMode === "shipping" && (
          <div className="text-sm text-gray-600 leading-relaxed">
            휴무일은 <strong>휴무 공지</strong>에서 설정한 날짜와 자동 연동됩니다.
          </div>
        )}

        {viewMode === "holiday" && (
          <>
            <div className="text-sm font-semibold">공지 제목</div>
            <input
              className="w-full border p-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <div className="text-sm font-semibold">휴무일 안내</div>
            <textarea
              className="w-full border p-2"
              rows={3}
              value={notice1}
              onChange={(e) => setNotice1(e.target.value)}
            />

            <div className="text-sm font-semibold">휴무일 상세</div>
            <textarea
              className="w-full border p-2"
              rows={5}
              value={notice2}
              onChange={(e) => setNotice2(e.target.value)}
            />

            <div className="text-xs text-gray-500">
              달력 날짜를 클릭하면 휴무일로 추가/삭제됩니다.
            </div>
          </>
        )}

        {viewMode === "shipping" && (
          <>
            <div className="text-sm font-semibold">배송 스케줄 제목</div>
            <input
              className="w-full border p-2"
              value={shippingTitle}
              onChange={(e) => setShippingTitle(e.target.value)}
            />

            <div className="text-sm font-semibold">하단 안내문</div>
            <textarea
              className="w-full border p-2"
              rows={5}
              value={shippingMemo}
              onChange={(e) => setShippingMemo(e.target.value)}
            />

            <button
              onClick={clearAllShippingMarks}
              className="bg-gray-500 text-white px-4 py-2 rounded w-full"
            >
              상차/배송 표시 전체 삭제
            </button>

            <div className="text-xs text-gray-500 leading-relaxed">
              배송 스케줄 달력에서 날짜를 우클릭하면 상차/배송을 선택할 수 있습니다.
              <br />
              휴무일은 휴무 공지 달력과 자동 연동됩니다.
            </div>
          </>
        )}

        <div className="border-t pt-4 space-y-2">
          <div className="text-sm font-semibold">템플릿 저장</div>

          <input
            className="w-full border p-2"
            placeholder="예) 2026년 5월 휴무공지"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
          />

          <button
            onClick={saveTemplate}
            className="bg-purple-500 text-white px-4 py-2 rounded w-full"
          >
            템플릿 저장
          </button>

          <div className="text-sm font-semibold mt-3">저장된 템플릿</div>

          <div className="space-y-1">
            {savedTemplates.map((name) => (
              <div key={name} className="flex gap-2">
                <button
                  onClick={() => loadTemplate(name)}
                  className="flex-1 bg-gray-200 px-3 py-2 rounded text-left"
                >
                  {name}
                </button>

                <button
                  onClick={() => deleteTemplate(name)}
                  className="bg-red-500 text-white px-3 py-2 rounded"
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={downloadImage}
          className="bg-blue-500 text-white px-4 py-2 rounded w-full"
        >
          이미지 다운로드
        </button>
      </div>

      {/* 오른쪽 미리보기 */}
      <div className="w-2/3 flex justify-center items-start">
        {viewMode === "holiday" && (
          <div
            ref={ref}
            className="bg-[#faf7f2] p-10 w-[680px] text-black border-2 border-[#5E6F3A]"
          >
            <div className="flex items-center justify-center gap-3 mb-3">
              <img src="/logo.png" alt="logo" className="h-15" />

              <h1 className="text-4xl tracking-tight text-black font-bold">
                {title}
              </h1>
            </div>

            {/* 휴무 공지 캘린더 */}
            <div className="border-[8px] border-[#5E6F3A] mb-6 bg-white p-3">
              <div className="flex justify-center items-center py-1">
                <div className="text-3xl font-bold">{month}월</div>
              </div>

              <table className="w-full border border-black bg-white table-fixed">
                <thead>
                  <tr className="text-center">
                    <th className="border border-black bg-gray-100 text-base font-semibold text-red-500">
                      일
                    </th>
                    <th className="border border-black bg-gray-100 text-base font-semibold">
                      월
                    </th>
                    <th className="border border-black bg-gray-100 text-base font-semibold">
                      화
                    </th>
                    <th className="border border-black bg-gray-100 text-base font-semibold">
                      수
                    </th>
                    <th className="border border-black bg-gray-100 text-base font-semibold">
                      목
                    </th>
                    <th className="border border-black bg-gray-100 text-base font-semibold">
                      금
                    </th>
                    <th className="border border-black bg-gray-100 text-base font-semibold text-blue-500">
                      토
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {calendar.map((week, i) => (
                    <tr key={i} className="text-center">
                      {week.map((date, j) => (
                        <td
                          key={j}
                          onClick={() => {
                            if (date.isCurrentMonth) {
                              toggleHolidayDay(date.day);
                            }
                          }}
                          className={`border border-black h-9 text-lg font-medium ${
                            date.isCurrentMonth ? "cursor-pointer" : ""
                          } ${
                            date.isCurrentMonth && selectedHolidayDays.includes(date.day)
                              ? "bg-red-200 text-red-600 font-bold"
                              : j === 0
                              ? "bg-gray-100 text-red-500"
                              : j === 6
                              ? "bg-gray-100 text-blue-500"
                              : "bg-white text-black"
                          }`}
                        >
                          {date.isCurrentMonth ? date.day : ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 공지 */}
            <div className="space-y-4 text-lg leading-relaxed whitespace-pre-line">
              <div>
                <strong>◎ 휴무 공지사항</strong>
              </div>

              <div>
                <span className="text-red-600 font-bold">{notice1}</span>
              </div>

              <div className="mb-8">{notice2}</div>

              <div>
                <strong>◎ 배송 및 업무 안내</strong>
              </div>

              <div className="space-y-2">
                <div>
                  - 휴무일에는{" "}
                  <span className="text-red-600">화물, 정기배송, 직송</span> 등
                  모든 <span className="text-red-600">발송 업무가 중단</span>
                  됩니다.
                </div>

                <div>
                  - 문의 및 A/S 대응은 일부{" "}
                  <span className="text-red-600">제한</span>되거나{" "}
                  <span className="text-red-600">지연</span>될 수 있습니다.
                </div>

                <div>
                  - 휴무일로 인해{" "}
                  <span className="text-red-600">변동되는 정기배송 스케줄</span>
                  은 해당 업체별로{" "}
                  <span className="text-red-600">별도공지</span> 될 예정입니다.
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === "shipping" && (
          <div
            ref={ref}
            className="bg-white w-[920px] text-black border border-black p-4"
          >
            <div className="text-center text-4xl font-bold py-4">
              {month}월 &quot;{shippingTitle}&quot;
            </div>

            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr className="text-center">
                  <th className="border border-black bg-[#ddd9c3] h-9 text-red-500">
                    일
                  </th>
                  <th className="border border-black bg-[#ddd9c3] h-9">월</th>
                  <th className="border border-black bg-[#ddd9c3] h-9">화</th>
                  <th className="border border-black bg-[#ddd9c3] h-9">수</th>
                  <th className="border border-black bg-[#ddd9c3] h-9">목</th>
                  <th className="border border-black bg-[#ddd9c3] h-9">금</th>
                  <th className="border border-black bg-[#ddd9c3] h-9 text-blue-500">
                    토
                  </th>
                </tr>
              </thead>

              <tbody>
                {calendar.map((week, i) => (
                  <tr key={i}>
                    {week.map((date, j) => {
                      const dateKey = getDateKey(date);
                      const isHoliday =
                        date.isCurrentMonth && selectedHolidayDays.includes(date.day);
                      const mark = shippingMarks[dateKey];

                      return (
                        <td
                          key={j}
                          onContextMenu={(e) => openScheduleMenu(e, date)}
                          className={`border border-black h-24 align-top p-1 relative select-none cursor-context-menu ${
                            isHoliday
                              ? "bg-red-200"
                              : mark
                              ? "bg-[#e8f1dc]"
                              : j === 0 || j === 6
                              ? "bg-gray-100"
                              : "bg-white"
                          }`}
                        >
                          <div
                            className={`text-base font-bold ${
                              !date.isCurrentMonth
                                ? "text-gray-400"
                                : isHoliday || j === 0
                                ? "text-red-500"
                                : j === 6
                                ? "text-blue-500"
                                : "text-black"
                            }`}
                          >
                            {date.isCurrentMonth ? date.day : `${date.month}/${date.day}`}
                          </div>

                          {isHoliday && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="text-2xl font-bold text-red-600">휴무</div>
                            </div>
                          )}

                          {!isHoliday && mark && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="text-4xl font-bold text-[#4f5f32]">
                                {mark}
                              </div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="px-8 py-4 whitespace-pre-line text-red-600 text-lg font-bold leading-tight">
              {shippingMemo}
            </div>
          </div>
        )}
      </div>

      {/* 우클릭 메뉴 */}
      {contextMenu && viewMode === "shipping" && (
        <div
          className="fixed bg-white border border-gray-400 shadow-lg z-50 rounded overflow-hidden"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="block w-full px-5 py-2 text-left hover:bg-gray-100"
            onClick={() => setScheduleMark("상차")}
          >
            상차
          </button>

          <button
            className="block w-full px-5 py-2 text-left hover:bg-gray-100"
            onClick={() => setScheduleMark("배송")}
          >
            배송
          </button>

          <button
            className="block w-full px-5 py-2 text-left text-red-500 hover:bg-gray-100"
            onClick={removeScheduleMark}
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}