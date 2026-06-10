"use client";

import { useEffect, useMemo, useState } from "react";

type Period = "1 Blue" | "1 Black" | "2 Blue" | "2 Black" | "3 Blue";

type Instructor = {
  id: string;
  name: string;
  priority: number;
  preferredAreas: string[];
  maxFlightsPerWeek: number;
};

type Assignment = {
  date: string;
  period: Period;
  ip: string;
  sp: string;
  area: string;
};

type ParsedUnavailable = {
  date: string;
  ip: string;
  periods: Period[];
};

type SpIpLock = {
  id: string;
  date: string;
  sp: string;
  ip: string;
};

const PERIODS: Period[] = ["1 Blue", "1 Black", "2 Blue", "2 Black", "3 Blue"];
const PLANE_LIMIT_BLOCKS: Period[][] = [
  ["1 Blue", "1 Black"],
  ["2 Blue", "2 Black"],
];
const AREAS = ["Cn", "Cs", "Bn", "Bs", "W", "En", "Es"];

const INITIAL_SPS = ["C-NON", "S-YU", "K-CHAN", "P-PAT", "TH-WIT", "P-POOM", "P-LOT", "PAS-KORN"];

const INITIAL_IPS: Instructor[] = [
  { id: "ip-1", name: "P-NART", priority: 1, preferredAreas: ["Cn", "Cs", "W"], maxFlightsPerWeek: 5 },
  { id: "ip-2", name: "K-PHOOM", priority: 2, preferredAreas: ["Bn", "Bs", "Cn"], maxFlightsPerWeek: 5 },
  { id: "ip-3", name: "S-NA", priority: 3, preferredAreas: ["En", "Es", "W"], maxFlightsPerWeek: 5 },
  { id: "ip-4", name: "P-BOB", priority: 4, preferredAreas: ["Cs", "Bs", "En"], maxFlightsPerWeek: 4 },
  { id: "ip-5", name: "K-DA", priority: 5, preferredAreas: ["Es", "W", "Bn"], maxFlightsPerWeek: 4 },
  { id: "ip-6", name: "K-YA", priority: 6, preferredAreas: ["Cn", "Bn", "Es"], maxFlightsPerWeek: 4 },
];

function formatYmd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayYmd() {
  return formatYmd(new Date());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(date: string) {
  const base = new Date(`${date}T00:00:00`);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return formatYmd(addDays(base, diff));
}

function weekDates(start: string) {
  const base = new Date(`${start}T00:00:00`);
  return Array.from({ length: 5 }, (_, index) => formatYmd(addDays(base, index)));
}

function periodIndex(period: Period) {
  return PERIODS.indexOf(period);
}

function normalizePeriod(value: string): Period | null {
  const compact = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return PERIODS.find((period) => period.toLowerCase() === compact) ?? null;
}

function parseUnavailable(text: string): ParsedUnavailable[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,/).map((part) => part.trim()))
    .map((parts) => {
      const [date = "", ip = "", ...periodParts] = parts;
      const periods = periodParts
        .flatMap((part) => part.split(/[;|]/))
        .map(normalizePeriod)
        .filter((period): period is Period => Boolean(period));
      return { date, ip, periods };
    })
    .filter((row) => row.date && row.ip && row.periods.length > 0);
}

function buildUnavailableMap(rows: ParsedUnavailable[]) {
  const map = new Map<string, Set<Period>>();
  rows.forEach((row) => {
    const key = `${row.date}|${row.ip}`;
    if (!map.has(key)) map.set(key, new Set());
    row.periods.forEach((period) => map.get(key)?.add(period));
  });
  return map;
}

function buildLockMap(locks: SpIpLock[]) {
  const map = new Map<string, string>();
  locks.forEach((lock) => {
    if (lock.date && lock.sp && lock.ip) {
      map.set(`${lock.date}|${lock.sp}`, lock.ip);
    }
  });
  return map;
}

function planeBlockForPeriod(period: Period) {
  return PLANE_LIMIT_BLOCKS.find((block) => block.includes(period)) ?? null;
}

function hasPlaneCapacity(params: {
  dayAssignments: Assignment[];
  period: Period;
  planeCount: number;
}) {
  const block = planeBlockForPeriod(params.period);
  if (!block) return true;
  const used = params.dayAssignments.filter((assignment) => block.includes(assignment.period)).length;
  return used < params.planeCount;
}

function scheduleWeek(params: {
  dates: string[];
  ips: Instructor[];
  sps: string[];
  unavailableRows: ParsedUnavailable[];
  locks: SpIpLock[];
  planeCount: number;
}) {
  const { dates, ips, sps, unavailableRows, locks, planeCount } = params;
  const unavailable = buildUnavailableMap(unavailableRows);
  const lockedIpBySpDate = buildLockMap(locks);
  const assignments: Assignment[] = [];
  const ipLoads = new Map(ips.map((ip) => [ip.name, 0]));
  const spCursor = new Map(sps.map((sp) => [sp, 0]));
  const warnings: string[] = [];

  const sortedIps = [...ips].sort((a, b) => a.priority - b.priority);

  for (const date of dates) {
    const dayAssignments: Assignment[] = [];

    for (const ip of sortedIps) {
      if ((ipLoads.get(ip.name) ?? 0) >= ip.maxFlightsPerWeek) continue;

      for (const period of PERIODS) {
        if ((ipLoads.get(ip.name) ?? 0) >= ip.maxFlightsPerWeek) break;
        if (unavailable.get(`${date}|${ip.name}`)?.has(period)) continue;
        if (dayAssignments.some((item) => item.ip === ip.name && Math.abs(periodIndex(item.period) - periodIndex(period)) === 1)) continue;
        if (dayAssignments.some((item) => item.ip === ip.name && item.period === period)) continue;
        if (!hasPlaneCapacity({ dayAssignments, period, planeCount })) continue;

        const sp = pickSp({ date, ip: ip.name, sps, spCursor, dayAssignments, lockedIpBySpDate });
        if (!sp) continue;

        const area = pickArea({ ip, dayAssignments, period });
        if (!area) {
          warnings.push(`${date} ${period}: no open area for ${ip.name}`);
          continue;
        }

        dayAssignments.push({ date, period, ip: ip.name, sp, area });
        ipLoads.set(ip.name, (ipLoads.get(ip.name) ?? 0) + 1);
        spCursor.set(sp, (spCursor.get(sp) ?? 0) + 1);
      }
    }

    assignments.push(...dayAssignments);
  }

  return { assignments, warnings, ipLoads };
}

function pickSp(params: {
  date: string;
  ip: string;
  sps: string[];
  spCursor: Map<string, number>;
  dayAssignments: Assignment[];
  lockedIpBySpDate: Map<string, string>;
}) {
  const ordered = [...params.sps].sort((a, b) => (params.spCursor.get(a) ?? 0) - (params.spCursor.get(b) ?? 0));
  const candidates = ordered.filter((sp) => {
    const lockedIp = params.lockedIpBySpDate.get(`${params.date}|${sp}`);
    return !params.dayAssignments.some((item) => item.sp === sp) && (!lockedIp || lockedIp === params.ip);
  });
  return candidates.find((sp) => params.lockedIpBySpDate.get(`${params.date}|${sp}`) === params.ip) ?? candidates[0] ?? null;
}

function pickArea(params: {
  ip: Instructor;
  dayAssignments: Assignment[];
  period: Period;
}) {
  const takenInPeriod = new Set(
    params.dayAssignments.filter((item) => item.period === params.period).map((item) => item.area),
  );
  return params.ip.preferredAreas.find((area) => !takenInPeriod.has(area)) ?? AREAS.find((area) => !takenInPeriod.has(area)) ?? null;
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function assignmentFor(assignments: Assignment[], date: string, sp: string, period: Period) {
  return assignments.find((item) => item.date === date && item.sp === sp && item.period === period);
}

export default function Home() {
  const [weekStartInput, setWeekStartInput] = useState(startOfWeek(todayYmd()));
  const [spsText, setSpsText] = useState(INITIAL_SPS.join("\n"));
  const [ips, setIps] = useState(INITIAL_IPS);
  const [planeCount, setPlaneCount] = useState(4);
  const [unavailableText, setUnavailableText] = useState(
    "2026-06-15,P-NART,1 Blue,1 Black\n2026-06-16,K-PHOOM,2 Black\n2026-06-17,S-NA,1 Black,2 Blue",
  );
  const [unavailableDraft, setUnavailableDraft] = useState({
    date: weekStartInput,
    ip: INITIAL_IPS[0]?.name ?? "",
    periods: ["1 Blue"] as Period[],
  });
  const [lockDraft, setLockDraft] = useState({
    date: weekStartInput,
    sp: INITIAL_SPS[0] ?? "",
    ip: "",
  });
  const [locks, setLocks] = useState<SpIpLock[]>([
    { id: "lock-1", date: weekStartInput, sp: INITIAL_SPS[0] ?? "", ip: INITIAL_IPS[0]?.name ?? "" },
  ]);

  const dates = useMemo(() => weekDates(weekStartInput), [weekStartInput]);
  const sps = useMemo(() => splitLines(spsText), [spsText]);
  const unavailableRows = useMemo(() => parseUnavailable(unavailableText), [unavailableText]);
  const result = useMemo(
    () => scheduleWeek({ dates, ips, sps, unavailableRows, locks, planeCount }),
    [dates, ips, sps, unavailableRows, locks, planeCount],
  );

  useEffect(() => {
    setUnavailableDraft((current) => (dates.includes(current.date) ? current : { ...current, date: dates[0] ?? "" }));
    setLockDraft((current) => (dates.includes(current.date) ? current : { ...current, date: dates[0] ?? "" }));
  }, [dates]);

  function updateIp(index: number, patch: Partial<Instructor>) {
    setIps((current) => current.map((ip, itemIndex) => (itemIndex === index ? { ...ip, ...patch } : ip)));
  }

  function moveIp(index: number, direction: -1 | 1) {
    setIps((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((ip, itemIndex) => ({ ...ip, priority: itemIndex + 1 }));
    });
  }

  function addUnavailableRow() {
    if (!unavailableDraft.date || !unavailableDraft.ip || unavailableDraft.periods.length === 0) return;
    const nextRow = [unavailableDraft.date, unavailableDraft.ip, ...unavailableDraft.periods].join(",");
    setUnavailableText((current) => (current.trim() ? `${current.trim()}\n${nextRow}` : nextRow));
  }

  function updateUnavailablePeriods(values: string[]) {
    const periods = values.map(normalizePeriod).filter((period): period is Period => Boolean(period));
    setUnavailableDraft((current) => ({ ...current, periods }));
  }

  function addLock() {
    if (!lockDraft.date || !lockDraft.sp) return;
    setLocks((current) => [
      ...current,
      {
        id: `lock-${Date.now()}`,
        ...lockDraft,
      },
    ]);
  }

  function removeLock(id: string) {
    setLocks((current) => current.filter((lock) => lock.id !== id));
  }

  return (
    <main className="shell">
      <section className="topbar" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">T-6C Weekly Planning</p>
          <h1 id="page-title">Flight Scheduler</h1>
        </div>
        <div className="topActions">
          <a className="navButton" href="/daily">
            Daily schedule
          </a>
          <div className="weekPicker">
            <label htmlFor="week-start">Week start</label>
            <input id="week-start" type="date" value={weekStartInput} onChange={(event) => setWeekStartInput(event.target.value)} />
          </div>
        </div>
      </section>

      <section className="plannerGrid">
        <div className="panel">
          <div className="panelHeader">
            <h2>Instructor Priority</h2>
            <span>{ips.length} IPs</span>
          </div>
          <div className="ipList">
            {ips.map((ip, index) => (
              <article className="ipRow" key={ip.id}>
                <div className="rank">{index + 1}</div>
                <div className="ipFields">
                  <label>
                    IP
                    <input value={ip.name} onChange={(event) => updateIp(index, { name: event.target.value })} />
                  </label>
                  <label>
                    Areas
                    <input
                      value={ip.preferredAreas.join(", ")}
                      onChange={(event) =>
                        updateIp(index, {
                          preferredAreas: event.target.value
                            .split(",")
                            .map((area) => area.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </label>
                  <label>
                    Max flights
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={ip.maxFlightsPerWeek}
                      onChange={(event) => updateIp(index, { maxFlightsPerWeek: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <div className="rankControls">
                  <button type="button" onClick={() => moveIp(index, -1)} aria-label={`Move ${ip.name} up`}>
                    ↑
                  </button>
                  <button type="button" onClick={() => moveIp(index, 1)} aria-label={`Move ${ip.name} down`}>
                    ↓
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <h2>Inputs</h2>
            <span>Google Form ready</span>
          </div>
          <div className="inputGroup">
            <h3>Aircraft capacity</h3>
            <div className="controlGrid">
              <label className="wideControl">
                Number of planes
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={planeCount}
                  onChange={(event) => setPlaneCount(Math.max(1, Number(event.target.value) || 1))}
                />
              </label>
            </div>
            <div className="helper compactHelper">
              Limits total flights across <code>1 Blue + 1 Black</code> and <code>2 Blue + 2 Black</code>.
            </div>
          </div>
          <div className="inputGroup">
            <h3>Instructor unavailable</h3>
            <div className="controlGrid">
              <label>
                Date
                <select
                  value={unavailableDraft.date}
                  onChange={(event) => setUnavailableDraft((current) => ({ ...current, date: event.target.value }))}
                >
                  {dates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                IP
                <select
                  value={unavailableDraft.ip}
                  onChange={(event) => setUnavailableDraft((current) => ({ ...current, ip: event.target.value }))}
                >
                  {ips.map((ip) => (
                    <option key={ip.id} value={ip.name}>
                      {ip.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wideControl">
                Periods
                <select
                  multiple
                  value={unavailableDraft.periods}
                  onChange={(event) =>
                    updateUnavailablePeriods(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
                  }
                >
                  {PERIODS.map((period) => (
                    <option key={period} value={period}>
                      {period}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="primaryButton" type="button" onClick={addUnavailableRow}>
              Add unavailable row
            </button>
          </div>
          <label className="fieldBlock">
            SP list
            <textarea value={spsText} onChange={(event) => setSpsText(event.target.value)} rows={8} />
          </label>
          <label className="fieldBlock">
            Instructor unavailable responses
            <textarea value={unavailableText} onChange={(event) => setUnavailableText(event.target.value)} rows={8} />
          </label>
          <div className="helper">
            Format: <code>YYYY-MM-DD, IP, period, period</code>. Use this shape for exported Google Form responses.
          </div>
          <div className="inputGroup lockGroup">
            <h3>Lock IP to SP</h3>
            <div className="controlGrid">
              <label>
                Date
                <select value={lockDraft.date} onChange={(event) => setLockDraft((current) => ({ ...current, date: event.target.value }))}>
                  {dates.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                SP
                <select value={lockDraft.sp} onChange={(event) => setLockDraft((current) => ({ ...current, sp: event.target.value }))}>
                  {sps.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                IP
                <select value={lockDraft.ip} onChange={(event) => setLockDraft((current) => ({ ...current, ip: event.target.value }))}>
                  <option value="">Any IP</option>
                  {ips.map((ip) => (
                    <option key={ip.id} value={ip.name}>
                      {ip.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="primaryButton" type="button" onClick={addLock}>
              Add lock
            </button>
            <div className="lockList" aria-label="Current SP IP locks">
              {locks.length === 0 ? (
                <p>No locks yet.</p>
              ) : (
                locks.map((lock) => (
                  <div className="lockItem" key={lock.id}>
                    <span>{lock.date}</span>
                    <strong>{lock.sp}</strong>
                    <span>{lock.ip || "Any IP"}</span>
                    <button type="button" onClick={() => removeLock(lock.id)} aria-label={`Remove lock for ${lock.sp} on ${lock.date}`}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>Weekly Schedule Output</h2>
          <span>{result.assignments.length} flights scheduled</span>
        </div>
        <div className="scheduleWrap">
          {dates.map((date) => (
            <div className="daySchedule" key={date}>
              <div className="dayTitle">{date}</div>
              <table>
                <thead>
                  <tr>
                    <th>SP</th>
                    {PERIODS.map((period) => (
                      <th key={period}>{period}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sps.map((sp) => (
                    <tr key={sp}>
                      <th>{sp}</th>
                      {PERIODS.map((period) => {
                        const item = assignmentFor(result.assignments, date, sp, period);
                        return (
                          <td key={period} className={item ? "filled" : ""}>
                            {item ? (
                              <>
                                <strong>{item.ip}</strong>
                                <span>{item.area}</span>
                              </>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>

      <section className="bottomGrid">
        <div className="panel">
          <div className="panelHeader">
            <h2>Google Form Fields</h2>
          </div>
          <ol className="steps">
            <li>Date: date question.</li>
            <li>Instructor: dropdown using the IP list above.</li>
            <li>Unavailable periods: checkbox question with the 5 periods.</li>
            <li>Lock date, SP, and IP when an SP must fly with a specific instructor.</li>
            <li>Optional note: paragraph question for maintenance, leave, or duty reason.</li>
          </ol>
        </div>
        <div className="panel">
          <div className="panelHeader">
            <h2>Rules Applied</h2>
          </div>
          <ul className="ruleList">
            <li>Five periods per day: 1 Blue, 1 Black, 2 Blue, 2 Black, 3 Blue.</li>
            <li>No duplicated area in the same period.</li>
            <li>Each SP is scheduled for at most one period per day.</li>
            <li>No IP is scheduled in consecutive periods.</li>
            <li>Plane count limits total flights across each Blue/Black two-period block.</li>
            <li>A locked SP/date only schedules with the selected IP; Any IP leaves the SP free.</li>
            <li>Higher priority IPs are assigned before lower priority IPs.</li>
            <li>Form unavailability blocks the matching IP and period.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
