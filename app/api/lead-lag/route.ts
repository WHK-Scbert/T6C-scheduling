import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LEAD_LAG_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1x4Jr9LOMnyAjSTsFd12JhDct_iy7kTtMmUu7T5ii7ec/export?format=csv&gid=91127733";
const GROUND_STATUS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1x4Jr9LOMnyAjSTsFd12JhDct_iy7kTtMmUu7T5ii7ec/export?format=csv&gid=1854883465";

const THAI_MONTHS: Record<string, string> = {
  "ม.ค.": "01",
  "ก.พ.": "02",
  "มี.ค.": "03",
  "เม.ย.": "04",
  "พ.ค.": "05",
  "มิ.ย.": "06",
  "ก.ค.": "07",
  "ส.ค.": "08",
  "ก.ย.": "09",
  "ต.ค.": "10",
  "พ.ย.": "11",
  "ธ.ค.": "12",
};

type TimelineItem = {
  col: number;
  ref: string;
  flightDay: string;
  date: string;
  displayDate: string;
  mission: string;
  plannedTime: number;
  plannedHours: number;
};

type StudentFlight = {
  col: number;
  date: string;
  mission: string;
  value: string;
  hours: number;
};

type StudentLeadLag = {
  rank: string;
  name: string;
  flights: StudentFlight[];
  actualHoursByCol: Record<string, number>;
  entriesByCol: Record<string, string>;
};

type GroundStatusKind = "HOLD" | "ABORT" | "Not Scheduled";

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((item) => item.some(Boolean));
}

function parseNumber(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseThaiDate(dayValue: string, monthValue: string) {
  const day = Number(dayValue.trim());
  const monthMatch = monthValue.trim().match(/^(.+?)(\d{2})$/);
  if (!Number.isFinite(day) || !monthMatch) return "";

  const [, thaiMonth, shortYear] = monthMatch;
  const month = THAI_MONTHS[thaiMonth];
  if (!month) return "";

  const buddhistYear = 2500 + Number(shortYear);
  const gregorianYear = buddhistYear - 543;
  return `${gregorianYear}-${month}-${String(day).padStart(2, "0")}`;
}

function isStudentRow(row: string[]) {
  const rank = row[1]?.trim() ?? "";
  const name = row[2]?.trim() ?? "";
  return /^\d+$/.test(rank) && Boolean(name) && name !== "#REF!" && !name.includes("ชม.รวม");
}

function shouldCountFlight(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed !== "0" && trimmed !== "0.0" && trimmed !== "#REF!";
}

function buildActualHoursMap(row: string[], timeline: TimelineItem[]) {
  const map: Record<string, number> = {};
  timeline.forEach((item) => {
    const value = parseNumber(row[item.col]);
    if (value > 0) map[item.col] = value;
  });
  return map;
}

function buildEntryMap(row: string[], timeline: TimelineItem[]) {
  const map: Record<string, string> = {};
  timeline.forEach((item) => {
    const value = row[item.col]?.trim() ?? "";
    if (value) map[item.col] = value;
  });
  return map;
}

function timelineKey(date: string, mission: string) {
  return `${date}|${mission.trim().toUpperCase()}`;
}

function groundStatusKind(value: string): GroundStatusKind | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "HOLD") return "HOLD";
  if (normalized === "ABORT") return "ABORT";
  if (normalized === "ไม่จัดบิน" || normalized === "NOT SCHEDULED") return "Not Scheduled";
  return null;
}

function buildGroundStatusMaps(rows: string[][], timeline: TimelineItem[]) {
  const leadColByKey = new Map(timeline.map((item) => [timelineKey(item.date, item.mission), item.col]));
  const dayRow = rows[2] ?? [];
  const monthRow = rows[3] ?? [];
  const missionRow = rows[4] ?? [];
  const groundColToLeadCol = new Map<number, number>();

  for (let col = 4; col < missionRow.length; col += 1) {
    const date = parseThaiDate(dayRow[col] ?? "", monthRow[col] ?? "");
    const mission = missionRow[col]?.trim() ?? "";
    const leadCol = leadColByKey.get(timelineKey(date, mission));
    if (leadCol !== undefined) groundColToLeadCol.set(col, leadCol);
  }

  const mapsByRank = new Map<string, Record<string, string>>();

  for (let rowIndex = 7; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rank = row[1]?.trim() ?? "";
    const name = row[2]?.trim() ?? "";
    if (!/^\d+$/.test(rank) || !name || name === "#REF!") continue;

    const entries: Record<string, string> = {};

    for (let offset = 0; offset < 3; offset += 1) {
      const statusRow = rows[rowIndex + offset] ?? [];
      const status = groundStatusKind(statusRow[3] ?? "");
      if (!status) continue;

      groundColToLeadCol.forEach((leadCol, groundCol) => {
        const reason = statusRow[groundCol]?.trim() ?? "";
        if (reason) entries[leadCol] = `${status}: ${reason}`;
      });
    }

    mapsByRank.set(rank, {
      ...(mapsByRank.get(rank) ?? {}),
      ...entries,
    });
  }

  return mapsByRank;
}

function findStudentRows(rows: string[][]) {
  const firstSummaryIndex = rows.findIndex((row) => row[1]?.trim() === "บินจริง");
  const studentGridRows = rows.slice(0, firstSummaryIndex === -1 ? rows.length : firstSummaryIndex).filter(isStudentRow);
  const actualRows = rows.slice(firstSummaryIndex === -1 ? 0 : firstSummaryIndex).filter(isStudentRow);
  const actualByRank = new Map(actualRows.map((row) => [row[1]?.trim() ?? "", row]));

  return studentGridRows.map((row) => ({
    gridRow: row,
    actualRow: actualByRank.get(row[1]?.trim() ?? ""),
  }));
}

export async function GET() {
  const [response, groundResponse] = await Promise.all([
    fetch(LEAD_LAG_CSV_URL, { cache: "no-store" }),
    fetch(GROUND_STATUS_CSV_URL, { cache: "no-store" }),
  ]);

  if (!response.ok) {
    return NextResponse.json(
      { error: `Unable to fetch lead/lag sheet: ${response.status}` },
      { status: 502 },
    );
  }

  if (!groundResponse.ok) {
    return NextResponse.json(
      { error: `Unable to fetch HOLD/ABORT sheet: ${groundResponse.status}` },
      { status: 502 },
    );
  }

  const csv = await response.text();
  const groundCsv = await groundResponse.text();
  const rows = parseCsv(csv);
  const groundRows = parseCsv(groundCsv);
  const refRow = rows[1] ?? [];
  const flightDayRow = rows[2] ?? [];
  const dayRow = rows[3] ?? [];
  const monthRow = rows[4] ?? [];
  const missionRow = rows[5] ?? [];
  const timeRow = rows[6] ?? [];
  const plannedRow = rows[7] ?? [];

  const timeline: TimelineItem[] = [];
  for (let col = 3; col < missionRow.length; col += 1) {
    const mission = missionRow[col]?.trim() ?? "";
    const date = parseThaiDate(dayRow[col] ?? "", monthRow[col] ?? "");
    const plannedTime = parseNumber(timeRow[col] ?? "");
    const plannedHours = parseNumber(plannedRow[col] ?? "");

    if (!date && !mission && plannedTime === 0 && plannedHours === 0) continue;

    timeline.push({
      col,
      ref: refRow[col]?.trim() ?? "",
      flightDay: flightDayRow[col]?.trim() ?? "",
      date,
      displayDate: `${dayRow[col]?.trim() ?? ""} ${monthRow[col]?.trim() ?? ""}`.trim(),
      mission,
      plannedTime,
      plannedHours,
    });
  }

  const groundEntriesByRank = buildGroundStatusMaps(groundRows, timeline);

  const students: StudentLeadLag[] = findStudentRows(rows).map(({ gridRow, actualRow }) => {
    const flights = timeline
      .filter((item) => shouldCountFlight(gridRow[item.col] ?? ""))
      .map((item) => ({
        col: item.col,
        date: item.date,
        mission: item.mission,
        value: gridRow[item.col].trim(),
        hours: item.plannedTime,
      }));

    return {
      rank: gridRow[1]?.trim() ?? "",
      name: gridRow[2]?.trim() ?? "",
      flights,
      actualHoursByCol: actualRow ? buildActualHoursMap(actualRow, timeline) : {},
      entriesByCol: {
        ...buildEntryMap(gridRow, timeline),
        ...(groundEntriesByRank.get(gridRow[1]?.trim() ?? "") ?? {}),
      },
    };
  });

  return NextResponse.json({
    source: LEAD_LAG_CSV_URL,
    updatedAt: new Date().toISOString(),
    timeline,
    students,
  });
}
