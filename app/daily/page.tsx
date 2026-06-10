"use client";

import { useEffect, useMemo, useState } from "react";

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

type ResponsesPayload = {
  updatedAt: string;
  rows: ResponseRow[];
  error?: string;
};

type ResolvedFlight = ResponseRow & {
  scheduledPeriod: string;
  scheduledArea: string;
  fallback: "primary" | "reserve" | "any";
};

const PERIODS = ["1 Blue", "1 Black", "2 Blue", "2 Black", "3 Blue"];
const PLANE_LIMIT_BLOCKS = [
  { label: "1 Blue + 1 Black", periods: ["1 Blue", "1 Black"] },
  { label: "2 Blue + 2 Black", periods: ["2 Blue", "2 Black"] },
];
const SP_LIST = ["C-NON", "S-YU", "K-CHAN", "P-PAT", "TH-WIT", "P-POOM", "P-LOT", "PAS-KORN"];
const IP_PRIORITY = ["K-YA", "K-DA", "TH-KRIT", "P-BOB", "S-NA", "P-NART", "K-PHOOM"];

function todayYmd() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function blockForPeriod(period: string) {
  return PLANE_LIMIT_BLOCKS.find((block) => block.periods.includes(period)) ?? null;
}

function ipPriority(ip: string) {
  const index = IP_PRIORITY.indexOf(ip);
  return index === -1 ? IP_PRIORITY.length : index;
}

function timestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function resolveDailyFlights(rows: ResponseRow[], planeCount: number) {
  const usedByPeriod = new Map<string, number>();
  const usedByBlock = new Map<string, number>();
  const usedAreaByPeriod = new Map<string, Set<string>>();

  function canUse(period: string, area: string) {
    if (!period || !PERIODS.includes(period)) return false;
    const block = blockForPeriod(period);
    if (block && (usedByBlock.get(block.label) ?? 0) >= planeCount) return false;
    if (area && usedAreaByPeriod.get(period)?.has(area)) return false;
    return true;
  }

  function reserve(period: string, area: string) {
    usedByPeriod.set(period, (usedByPeriod.get(period) ?? 0) + 1);
    const block = blockForPeriod(period);
    if (block) usedByBlock.set(block.label, (usedByBlock.get(block.label) ?? 0) + 1);
    if (area) {
      if (!usedAreaByPeriod.has(period)) usedAreaByPeriod.set(period, new Set());
      usedAreaByPeriod.get(period)?.add(area);
    }
  }

  const prioritizedRows = rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        ipPriority(a.row.ip) - ipPriority(b.row.ip) ||
        timestampMs(a.row.timestamp) - timestampMs(b.row.timestamp) ||
        a.index - b.index,
    )
    .map(({ row }) => row);

  return prioritizedRows.flatMap((row): ResolvedFlight[] => {
    const candidates = [
      { period: row.period, area: row.area, fallback: "primary" as const },
      { period: row.reservePeriod, area: row.reserveArea, fallback: "reserve" as const },
      ...PERIODS.map((period) => ({
        period,
        area: row.area || row.reserveArea,
        fallback: "any" as const,
      })),
    ];
    const selected = candidates.find((candidate) => canUse(candidate.period, candidate.area));
    if (!selected) return [];
    reserve(selected.period, selected.area);
    return [{ ...row, scheduledPeriod: selected.period, scheduledArea: selected.area, fallback: selected.fallback }];
  });
}

export default function DailySchedulePage() {
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayYmd());
  const [updatedAt, setUpdatedAt] = useState("");
  const [status, setStatus] = useState("Loading responses...");
  const [planeCount, setPlaneCount] = useState(4);

  async function loadResponses() {
    setStatus("Loading responses...");
    try {
      const response = await fetch("/api/responses", { cache: "no-store" });
      const payload = (await response.json()) as ResponsesPayload;
      if (!response.ok) throw new Error(payload.error || "Unable to load responses");

      setRows(payload.rows);
      setUpdatedAt(payload.updatedAt);
      setStatus(`Loaded ${payload.rows.length} response${payload.rows.length === 1 ? "" : "s"}`);

      const dates = Array.from(new Set(payload.rows.map((row) => row.date))).sort();
      if (dates.length > 0 && !dates.includes(selectedDate)) {
        setSelectedDate(dates[dates.length - 1]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load responses");
    }
  }

  useEffect(() => {
    void loadResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dates = useMemo(() => Array.from(new Set(rows.map((row) => row.date))).sort(), [rows]);
  const dailyRows = useMemo(() => rows.filter((row) => row.date === selectedDate), [rows, selectedDate]);
  const resolvedRows = useMemo(() => resolveDailyFlights(dailyRows, planeCount), [dailyRows, planeCount]);
  const dailyScheduleRows = useMemo(() => {
    const responseSps = resolvedRows.map((row) => row.sp).filter(Boolean);
    const allSps = Array.from(new Set([...SP_LIST, ...responseSps]));

    return allSps.map((sp) => {
      const spRows = resolvedRows.filter((row) => row.sp === sp);
      const flightsByPeriod = new Map<string, string>();
      spRows.forEach((row) => {
        flightsByPeriod.set(row.scheduledPeriod, row.flight || "Flight");
      });
      const ips = Array.from(new Set(spRows.map((row) => row.ip).filter(Boolean)));
      const areas = Array.from(new Set(spRows.map((row) => row.scheduledArea).filter(Boolean)));

      return {
        sp,
        ip: ips.join(", "),
        area: areas.join(", "),
        flightsByPeriod,
        scheduled: spRows.length > 0,
      };
    });
  }, [resolvedRows]);
  const capacitySummary = useMemo(() => {
    return PLANE_LIMIT_BLOCKS.map((block) => {
      const used = resolvedRows.filter((row) => block.periods.includes(row.scheduledPeriod)).length;
      return {
        ...block,
        used,
        over: used > planeCount,
      };
    });
  }, [resolvedRows, planeCount]);

  return (
    <main className="shell">
      <section className="topbar" aria-labelledby="daily-title">
        <div>
          <p className="eyebrow">T-6C Daily Planning</p>
          <h1 id="daily-title">Daily Flight Schedule</h1>
        </div>
        <div className="topActions">
          <a className="navButton" href="/">
            Weekly scheduler
          </a>
          <button className="primaryButton compactButton" type="button" onClick={loadResponses}>
            Refresh
          </button>
        </div>
      </section>

      <section className="panel dailyControls">
        <label>
          Schedule date
          <select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
            {dates.length === 0 ? <option value={selectedDate}>{selectedDate}</option> : null}
            {dates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </label>
        <label>
          Number of planes
          <input
            type="number"
            min={1}
            max={20}
            value={planeCount}
            onChange={(event) => setPlaneCount(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
        <div className="statusBlock">
          <strong>{status}</strong>
          <span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : "Waiting for sheet data"}</span>
        </div>
      </section>

      <section className="capacityStrip" aria-label="Aircraft capacity summary">
        {capacitySummary.map((block) => (
          <div className={block.over ? "capacityBadge overCapacity" : "capacityBadge"} key={block.label}>
            <strong>{block.label}</strong>
            <span>
              {block.used}/{planeCount} aircraft
            </span>
          </div>
        ))}
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>Daily Schedule Output</h2>
          <span>
            {resolvedRows.length} scheduled / {dailyRows.length} responses
          </span>
        </div>
        <div className="daySchedule">
          <table className="dailyScheduleTable">
            <thead>
              <tr>
                <th>SP</th>
                <th>IP</th>
                {PERIODS.map((period) => (
                  <th key={period}>{period}</th>
                ))}
                <th>Area</th>
              </tr>
            </thead>
            <tbody>
              {dailyScheduleRows.map((row) => (
                <tr key={row.sp}>
                  <th>{row.sp}</th>
                  <td>{row.ip || ""}</td>
                  {PERIODS.map((period) => {
                    const flight = row.flightsByPeriod.get(period);
                    return (
                      <td key={period} className={flight ? "filled" : ""}>
                        {flight ? <strong>{flight}</strong> : null}
                      </td>
                    );
                  })}
                  <td>{row.area || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>Response Rows</h2>
          <span>{dailyRows.length} for {selectedDate}</span>
        </div>
        <div className="daySchedule">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>SP</th>
                <th>IP</th>
                <th>Area</th>
                <th>Reserve period</th>
                <th>Reserve area</th>
                <th>Used</th>
                <th>Flight</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.length === 0 ? (
                <tr>
                  <td colSpan={9}>No responses for this date.</td>
                </tr>
              ) : (
                dailyRows.map((row, index) => (
                  <tr key={`${row.timestamp}-${index}`}>
                    <td>{row.period}</td>
                    <td>{row.sp}</td>
                    <td>{row.ip}</td>
                    <td>{row.area}</td>
                    <td>{row.reservePeriod}</td>
                    <td>{row.reserveArea}</td>
                    <td>{resolvedRows.find((resolved) => resolved.timestamp === row.timestamp && resolved.sp === row.sp)?.fallback ?? "not scheduled"}</td>
                    <td>{row.flight}</td>
                    <td>{row.timestamp}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
