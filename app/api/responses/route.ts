import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1L1wkP4OvPQLxtVb8OEwMjHMik5WCsI7F4FGQCIDIGrY/export?format=csv";

type ResponseRow = {
  timestamp: string;
  date: string;
  sp: string;
  ip: string;
  period: string;
  reservePeriod: string;
  area: string;
  reserveArea: string;
  flight: string;
};

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

function normalizeDate(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return trimmed;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function timestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function latestResponsePerSp(rows: ResponseRow[]) {
  const latest = new Map<string, ResponseRow>();

  rows.forEach((row) => {
    const key = `${row.date}|${row.sp}`;
    const previous = latest.get(key);
    if (!previous || timestampMs(row.timestamp) >= timestampMs(previous.timestamp)) {
      latest.set(key, row);
    }
  });

  return Array.from(latest.values()).sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.sp.localeCompare(b.sp);
  });
}

export async function GET() {
  const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Unable to fetch response sheet: ${response.status}` },
      { status: 502 },
    );
  }

  const csv = await response.text();
  const [headerRow = [], ...dataRows] = parseCsv(csv);
  const headers = headerRow.map((header) => header.trim().toLowerCase());

  const rows: ResponseRow[] = dataRows
    .map((dataRow) => {
      const value = (name: string) => dataRow[headers.indexOf(name)]?.trim() ?? "";
      return {
        timestamp: value("timestamp"),
        date: normalizeDate(value("date")),
        sp: value("sp"),
        ip: value("ip"),
        period: value("period"),
        reservePeriod: value("period สำรอง"),
        area: value("area"),
        reserveArea: value("area สำรอง"),
        flight: value("flight"),
      };
    })
    .filter((row) => row.date && row.sp && row.ip && row.period);
  const latestRows = latestResponsePerSp(rows);

  return NextResponse.json({
    source: SHEET_CSV_URL,
    updatedAt: new Date().toISOString(),
    rows: latestRows,
    rawRows: rows.length,
  });
}
