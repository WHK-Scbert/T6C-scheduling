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
  unavailablePeriods: string;
  checkFlight: string;
  manualPriority?: number;
  manualOverride?: boolean;
};

type ResponsesPayload = {
  updatedAt: string;
  rows: ResponseRow[];
  error?: string;
};

type ResolvedFlight = ResponseRow & {
  scheduledPeriod: string;
  scheduledArea: string;
  fallback: "primary" | "reserve" | "any" | "none";
  status: "scheduled" | "cannot";
};

const PERIODS = ["1 Blue", "1 Black", "2 Blue", "2 Black", "3 Blue", "3 Black"];
const AREAS = ["Cn", "Cs", "Bn", "Bs", "En", "Es", "W"];
const SIM_AREA = "SIM";
const SIM_LIMIT_PER_PERIOD = 2;
const SP_LIST = ["C-NON", "S-YU", "K-CHAN", "P-PAT", "TH-WIT", "P-POOM", "P-LOT", "PAS-KORN"];
const IP_PRIORITY = [
  "N-WAT",
  "K-YA",
  "K-DA",
  "N-PAT",
  "V-RUTH",
  "P-POB",
  "T-KRIT",
  "S-PONG",
  "S-NA",
  "P-NART",
  "K-PHOOM",
];
const IP_PRIORITY_ALIASES: Record<string, string> = {
  "TH-KRIT": "T-KRIT",
  "P-BOB": "P-POB",
};
const FLIGHT_PRIORITY = [
  "C101",
  "C102",
  "C103",
  "C104",
  "C105",
  "C106",
  "C107",
  "C108",
  "C109",
  "C110",
  "C111",
  "C110A",
  "C110B",
  "I101",
  "I102",
  "I103",
  "I104",
  "I105",
  "I106",
  "I107",
  "I108",
  "I108A",
  "C201",
  "C202",
  "C203",
  "C204",
  "C205",
  "C206",
  "C207",
  "C208",
  "C209",
  "C210",
  "C211",
  "C212",
  "C213",
  "C213A",
  "C213B",
  "I201",
  "I202",
  "I203",
  "I204",
  "I205",
  "I206",
  "I207",
  "I207A",
  "I207B",
  "NAV101",
  "NAV102",
  "NAV103",
  "NAV104",
  "NAV105",
  "NAV106",
  "NAV107",
  "NAV108",
  "NAV109",
  "NAV110",
  "NAV111",
  "NAV112",
  "NAV113",
  "NAV114",
  "NAV115",
  "NAV116",
  "NAV117",
  "NAV118",
  "NAV119",
  "NAV120",
  "NAV121",
  "NAV122",
  "NAV123",
  "NAV124",
  "NAV121A",
  "NAV122A",
  "NAV121B",
  "NAV122B",
  "F101",
  "F102",
  "F103",
  "F104",
  "F105",
  "F106",
  "F107",
  "F108",
  "F109",
  "F110",
  "F111",
  "F112",
  "F113",
  "F114",
  "F115",
  "F116",
  "F116A",
  "T101",
  "T102",
  "T103",
  "T104",
  "T105",
  "T106",
  "T106A",
  "T106B",
  "NC101",
  "NN102",
  "NN103",
  "NN104",
];

function todayYmd() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function availableScheduleDates(rows: ResponseRow[]) {
  const today = todayYmd();
  return Array.from(new Set(rows.map((row) => row.date)))
    .filter((date) => date >= today)
    .sort();
}

function normalizeIpName(ip: string) {
  const normalized = ip.trim().toUpperCase();
  return IP_PRIORITY_ALIASES[normalized] ?? normalized;
}

function ipPriority(ip: string) {
  const index = IP_PRIORITY.indexOf(normalizeIpName(ip));
  return index === -1 ? IP_PRIORITY.length : index;
}

function checkFlightPriority(value: string) {
  return value.trim() === "ใช่" ? 0 : 1;
}

function manualPriority(row: ResponseRow) {
  return row.manualPriority ?? Number.MAX_SAFE_INTEGER;
}

function flightPriority(flight: string) {
  const normalized = flight.trim().toUpperCase();
  const index = FLIGHT_PRIORITY.indexOf(normalized);
  return index === -1 ? FLIGHT_PRIORITY.length : index;
}

function timestampMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function emptyAircraftCapacity() {
  return Object.fromEntries(PERIODS.map((period) => [period, 4])) as Record<string, number>;
}

function splitPeriodList(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function periodUnavailableSet(value: string) {
  return new Set(splitPeriodList(value));
}

function normalizePeriod(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return PERIODS.find((period) => period.toLowerCase() === normalized) ?? value.trim();
}

function parseManualOverrides(text: string, date: string): ResponseRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [sp = "", ip = "", period = "", area = ""] = line.split(/\t|,/).map((item) => item.trim());
      return {
        timestamp: `Manual override ${index + 1}`,
        date,
        sp,
        ip,
        period: normalizePeriod(period),
        reservePeriod: "",
        area,
        reserveArea: "",
        flight: "Manual",
        unavailablePeriods: "",
        checkFlight: "",
        manualPriority: index,
        manualOverride: true,
      };
    })
    .filter((row) => row.sp && row.ip && row.period && row.area);
}

function seededOrder<T>(items: T[], seedSource: string) {
  let seed = seedSource.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  const ordered = [...items];

  for (let index = ordered.length - 1; index > 0; index -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const swapIndex = seed % (index + 1);
    [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
  }

  return ordered;
}

function seededPeriodOrder(row: ResponseRow) {
  return seededOrder(PERIODS, `${row.timestamp}|${row.sp}|${row.ip}`);
}

function areaCandidates(row: ResponseRow, period: string) {
  if (row.manualOverride) return [row.area];

  const preferredAreas = [row.area, row.reserveArea].map((area) => area.trim()).filter(Boolean);
  if (preferredAreas.some((area) => area.toUpperCase() === SIM_AREA)) return [SIM_AREA];

  const fallbackAreas = AREAS.filter(
    (area) => !preferredAreas.includes(area),
  );

  return Array.from(new Set([...preferredAreas, ...fallbackAreas]));
}

function periodCandidates(row: ResponseRow, unavailablePeriods: Set<string>) {
  if (row.manualOverride) {
    return [{ period: row.period, fallback: "primary" as const }];
  }

  const preferredPeriods = [row.period, row.reservePeriod].filter((period) => PERIODS.includes(period));
  const randomPeriods = seededPeriodOrder(row).filter(
    (period) => !preferredPeriods.includes(period) && !unavailablePeriods.has(period),
  );

  return [
    ...preferredPeriods.map((period, index) => ({
      period,
      fallback: index === 0 ? ("primary" as const) : ("reserve" as const),
    })),
    ...randomPeriods.map((period) => ({ period, fallback: "any" as const })),
  ];
}

function periodTone(period: string) {
  if (period.includes("Blue")) return "blue";
  if (period.includes("Black")) return "black";
  return "";
}

function resolveDailyFlights(rows: ResponseRow[], aircraftCapacity: Record<string, number>) {
  const usedByPeriod = new Map<string, number>();
  const usedAreaByPeriod = new Map<string, Set<string>>();
  const usedSimByPeriod = new Map<string, number>();

  function canUse(period: string, area: string) {
    if (!period || !PERIODS.includes(period)) return false;
    if (area.toUpperCase() === SIM_AREA) return (usedSimByPeriod.get(period) ?? 0) < SIM_LIMIT_PER_PERIOD;
    if ((usedByPeriod.get(period) ?? 0) >= (aircraftCapacity[period] ?? 0)) return false;
    if (area && usedAreaByPeriod.get(period)?.has(area)) return false;
    return true;
  }

  function reserve(period: string, area: string) {
    if (area) {
      if (area.toUpperCase() === SIM_AREA) {
        usedSimByPeriod.set(period, (usedSimByPeriod.get(period) ?? 0) + 1);
        return;
      }
      usedByPeriod.set(period, (usedByPeriod.get(period) ?? 0) + 1);
      if (!usedAreaByPeriod.has(period)) usedAreaByPeriod.set(period, new Set());
      usedAreaByPeriod.get(period)?.add(area);
    }
  }

  const prioritizedRows = rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        manualPriority(a.row) - manualPriority(b.row) ||
        checkFlightPriority(a.row.checkFlight) - checkFlightPriority(b.row.checkFlight) ||
        flightPriority(a.row.flight) - flightPriority(b.row.flight) ||
        ipPriority(a.row.ip) - ipPriority(b.row.ip) ||
        timestampMs(a.row.timestamp) - timestampMs(b.row.timestamp) ||
        a.index - b.index,
    )
    .map(({ row }) => row);

  return prioritizedRows.map((row): ResolvedFlight => {
    const unavailablePeriods = periodUnavailableSet(row.unavailablePeriods);
    const candidates = periodCandidates(row, unavailablePeriods).flatMap(({ period, fallback }) =>
      areaCandidates(row, period).map((area) => ({ period, area, fallback })),
    );
    const selected = candidates.find((candidate) => canUse(candidate.period, candidate.area));
    if (!selected) {
      return { ...row, scheduledPeriod: "", scheduledArea: "", fallback: "none", status: "cannot" };
    }
    reserve(selected.period, selected.area);
    return {
      ...row,
      scheduledPeriod: selected.period,
      scheduledArea: selected.area,
      fallback: selected.fallback,
      status: "scheduled",
    };
  });
}

export default function DailySchedulePage() {
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayYmd());
  const [updatedAt, setUpdatedAt] = useState("");
  const [status, setStatus] = useState("Loading responses...");
  const [aircraftCapacity, setAircraftCapacity] = useState(emptyAircraftCapacity);
  const [manualOverrideText, setManualOverrideText] = useState("");

  async function loadResponses() {
    setStatus("Loading responses...");
    try {
      const response = await fetch("/api/responses", { cache: "no-store" });
      const payload = (await response.json()) as ResponsesPayload;
      if (!response.ok) throw new Error(payload.error || "Unable to load responses");

      setRows(payload.rows);
      setUpdatedAt(payload.updatedAt);
      setStatus(`Loaded ${payload.rows.length} response${payload.rows.length === 1 ? "" : "s"}`);

      const dates = availableScheduleDates(payload.rows);
      if (dates.length > 0 && !dates.includes(selectedDate)) {
        setSelectedDate(dates[0]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load responses");
    }
  }

  useEffect(() => {
    void loadResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dates = useMemo(() => availableScheduleDates(rows), [rows]);
  const dailyRows = useMemo(() => rows.filter((row) => row.date === selectedDate), [rows, selectedDate]);
  const manualRows = useMemo(
    () => parseManualOverrides(manualOverrideText, selectedDate),
    [manualOverrideText, selectedDate],
  );
  const scheduleRows = useMemo(() => [...dailyRows, ...manualRows], [dailyRows, manualRows]);
  const resolvedRows = useMemo(
    () => resolveDailyFlights(scheduleRows, aircraftCapacity),
    [scheduleRows, aircraftCapacity],
  );
  const dailyScheduleRows = useMemo(() => {
    const responseSps = scheduleRows.map((row) => row.sp).filter(Boolean);
    const allSps = Array.from(new Set([...SP_LIST, ...responseSps]));

    return allSps.map((sp) => {
      const spRows = resolvedRows.filter((row) => row.sp === sp);
      const scheduledRows = spRows.filter((row) => row.status === "scheduled");
      const flightsByPeriod = new Map<string, ResolvedFlight>();
      scheduledRows.forEach((row) => flightsByPeriod.set(row.scheduledPeriod, row));
      const ips = Array.from(new Set(spRows.map((row) => row.ip).filter(Boolean)));
      const areas = Array.from(new Set(scheduledRows.map((row) => row.scheduledArea).filter(Boolean)));
      const cannot = spRows.find((row) => row.status === "cannot");

      return {
        sp,
        ip: ips.join(", "),
        area: areas.join(", "),
        cannot,
        flightsByPeriod,
        status: cannot ? "cannot" : spRows.length === 0 ? "hold" : "scheduled",
      };
    });
  }, [scheduleRows, resolvedRows]);
  const capacitySummary = useMemo(() => {
    return PERIODS.map((period) => {
      const used = resolvedRows.filter((row) => row.scheduledPeriod === period).length;
      return {
        period,
        used,
        available: aircraftCapacity[period] ?? 0,
        over: used > (aircraftCapacity[period] ?? 0),
      };
    });
  }, [resolvedRows, aircraftCapacity]);

  return (
    <main className="shell">
      <section className="topbar" aria-labelledby="daily-title">
        <div>
          <p className="eyebrow">T-6C Daily Planning</p>
          <h1 id="daily-title">Daily Flight Schedule</h1>
        </div>
        <div className="topActions">
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
        <div className="statusBlock">
          <strong>{status}</strong>
          <span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : "Waiting for sheet data"}</span>
        </div>
      </section>

      <section className="panel wide priorityOverride">
        <div className="panelHeader">
          <h2>Priority Override</h2>
          <span>{manualRows.length} manual row{manualRows.length === 1 ? "" : "s"}</span>
        </div>
        <label className="fieldBlock">
          Manual flights
          <textarea
            value={manualOverrideText}
            onChange={(event) => setManualOverrideText(event.target.value)}
            placeholder={"SP, IP, Period, Area\nC-NON, K-YA, 1 Blue, Cn"}
            rows={4}
          />
        </label>
      </section>

      <section className="capacityStrip" aria-label="Aircraft capacity summary">
        {capacitySummary.map((item) => (
          <div className={item.over ? "capacityBadge overCapacity" : "capacityBadge"} key={item.period}>
            <label>
              <strong>{item.period}</strong>
              <select
                value={item.available}
                onChange={(event) =>
                  setAircraftCapacity((current) => ({
                    ...current,
                    [item.period]: Number(event.target.value),
                  }))
                }
              >
                {Array.from({ length: 11 }, (_, index) => index).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {item.used}/{item.available}
            </span>
          </div>
        ))}
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>Daily Schedule Output</h2>
          <span>
            {resolvedRows.length} scheduled / {scheduleRows.length} inputs
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
                <tr className={row.status === "cannot" ? "cannotRow" : ""} key={row.sp}>
                  <th className={row.status === "cannot" ? "alertNameCell" : ""}>{row.sp}</th>
                  <td className={row.status === "cannot" ? "alertNameCell" : ""}>{row.ip || ""}</td>
                  {row.status === "cannot" ? (
                    <td className="cannotBlock" colSpan={PERIODS.length}>
                      Cannot schedule
                    </td>
                  ) : row.status === "hold" ? (
                    <td className="holdBlock" colSpan={PERIODS.length}>
                      Hold
                    </td>
                  ) : (
                    PERIODS.map((period) => {
                      const flight = row.flightsByPeriod.get(period);
                      return (
                        <td
                          key={period}
                          className={flight ? `filled ${periodTone(period)}Period` : ""}
                        >
                          {flight ? <strong>{flight.flight || "Flight"}</strong> : null}
                        </td>
                      );
                    })
                  )}
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
          <span>{scheduleRows.length} for {selectedDate}</span>
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
                <th>Unavailable</th>
                <th>Check flight</th>
                <th>Used</th>
                <th>Flight</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {scheduleRows.length === 0 ? (
                <tr>
                  <td colSpan={11}>No responses for this date.</td>
                </tr>
              ) : (
                scheduleRows.map((row, index) => (
                  <tr key={`${row.timestamp}-${index}`}>
                    <td>{row.period}</td>
                    <td>{row.sp}</td>
                    <td>{row.ip}</td>
                    <td>{row.area}</td>
                    <td>{row.reservePeriod}</td>
                    <td>{row.reserveArea}</td>
                    <td>{row.unavailablePeriods}</td>
                    <td>{row.checkFlight}</td>
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
