"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

type LeadLagPayload = {
  updatedAt: string;
  timeline: TimelineItem[];
  students: StudentLeadLag[];
  error?: string;
};

type StudentStatus = "lead" | "track" | "lag";

type GroundStatus = "HOLD" | "ABORT" | "Not Scheduled";

const TOTAL_SORTIES = 712;
const TOTAL_FLYING_DAYS = 115;

function todayYmd() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHours(value: number) {
  return value.toFixed(1);
}

function actualHoursAt(student: StudentLeadLag, selected: TimelineItem) {
  const actualEntries = Object.entries(student.actualHoursByCol)
    .map(([col, hours]) => ({ col: Number(col), hours }))
    .filter((entry) => Number.isFinite(entry.col) && entry.col <= selected.col);

  if (actualEntries.length > 0) {
    return actualEntries.reduce((total, entry) => total + entry.hours, 0);
  }

  return student.flights
    .filter((flight) => flight.col <= selected.col)
    .reduce((total, flight) => total + flight.hours, 0);
}

function lastFlightAt(student: StudentLeadLag, selected: TimelineItem) {
  return [...student.flights].reverse().find((flight) => flight.col <= selected.col);
}

function statusFor(delta: number): StudentStatus {
  if (delta >= 1) return "lead";
  if (delta <= -1) return "lag";
  return "track";
}

function statusLabel(status: StudentStatus) {
  if (status === "lead") return "Lead";
  if (status === "lag") return "Lag";
  return "On track";
}

function isCourseBlock(item: TimelineItem) {
  const mission = item.mission.trim();
  return Boolean(mission) && mission !== "0";
}

function classifyGroundEntry(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.toUpperCase();
  const prefixed = trimmed.match(/^(HOLD|ABORT|Not Scheduled):\s*(.+)$/i);
  const reason = prefixed?.[2]?.trim() || trimmed;

  if (normalized.includes("ABORT") || trimmed.includes("ยกเลิก")) {
    return { status: "ABORT" as GroundStatus, reason };
  }

  if (normalized.includes("HOLD") || trimmed.includes("งด") || trimmed.includes("พัก")) {
    return { status: "HOLD" as GroundStatus, reason };
  }

  if (
    normalized.includes("NOT SCHEDULED") ||
    normalized.includes("NOT SCHED") ||
    normalized === "NS" ||
    normalized === "N/S" ||
    trimmed.includes("ไม่ได้จัด") ||
    trimmed.includes("ไม่จัด")
  ) {
    return { status: "Not Scheduled" as GroundStatus, reason };
  }

  return null;
}

function emptyGroundCounts() {
  return { hold: 0, abort: 0, notScheduled: 0 };
}

function accumulatedGroundCounts(student: StudentLeadLag, selected: TimelineItem, timeline: TimelineItem[]) {
  return timeline
    .filter((item) => item.col <= selected.col)
    .reduce((counts, item) => {
      const classified = classifyGroundEntry(student.entriesByCol[String(item.col)] ?? "");
      if (classified?.status === "HOLD") counts.hold += 1;
      if (classified?.status === "ABORT") counts.abort += 1;
      if (classified?.status === "Not Scheduled") counts.notScheduled += 1;
      return counts;
    }, emptyGroundCounts());
}

function groundCountLabel(counts: ReturnType<typeof emptyGroundCounts>) {
  const formatCount = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  return `H ${formatCount(counts.hold)} / A ${formatCount(counts.abort)} / NS ${formatCount(counts.notScheduled)}`;
}

function addGroundCounts(items: Array<ReturnType<typeof emptyGroundCounts>>) {
  return items.reduce(
    (totals, item) => ({
      hold: totals.hold + item.hold,
      abort: totals.abort + item.abort,
      notScheduled: totals.notScheduled + item.notScheduled,
    }),
    emptyGroundCounts(),
  );
}

function actualSortiesAt(student: StudentLeadLag, selected: TimelineItem) {
  const actualEntries = Object.keys(student.actualHoursByCol)
    .map(Number)
    .filter((col) => Number.isFinite(col) && col <= selected.col);

  if (actualEntries.length > 0) return actualEntries.length;

  return student.flights.filter((flight) => flight.col <= selected.col).length;
}

export default function LeadLagPage() {
  const [payload, setPayload] = useState<LeadLagPayload | null>(null);
  const [selectedCol, setSelectedCol] = useState<number | null>(null);
  const [status, setStatus] = useState("Loading lead/lag sheet...");

  async function loadLeadLag() {
    setStatus("Loading lead/lag sheet...");
    try {
      const response = await fetch("/api/lead-lag", { cache: "no-store" });
      const data = (await response.json()) as LeadLagPayload;
      if (!response.ok) throw new Error(data.error || "Unable to load lead/lag sheet");

      setPayload(data);
      setStatus(`Loaded ${data.students.length} student${data.students.length === 1 ? "" : "s"}`);

      const today = todayYmd();
      const courseItems = data.timeline.filter(isCourseBlock);
      const nextDate = courseItems.find((item) => item.date >= today && item.date);
      const fallback = courseItems.find((item) => item.date) ?? courseItems[0] ?? data.timeline[0];
      setSelectedCol((current) => current ?? nextDate?.col ?? fallback?.col ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load lead/lag sheet");
    }
  }

  useEffect(() => {
    void loadLeadLag();
  }, []);

  const timeline = payload?.timeline ?? [];
  const courseTimeline = useMemo(() => timeline.filter(isCourseBlock), [timeline]);
  const students = payload?.students ?? [];
  const selected = useMemo(
    () => courseTimeline.find((item) => item.col === selectedCol) ?? courseTimeline[0] ?? timeline[0],
    [courseTimeline, timeline, selectedCol],
  );
  const studentRows = useMemo(() => {
    if (!selected) return [];

    return students
      .map((student) => {
        const actualHours = actualHoursAt(student, selected);
        const plannedHours = selected.plannedHours;
        const delta = actualHours - plannedHours;
        const lastFlight = lastFlightAt(student, selected);
        const groundCounts = accumulatedGroundCounts(student, selected, timeline);

        return {
          ...student,
          actualHours,
          plannedHours,
          delta,
          lastFlight,
          groundCounts,
          status: statusFor(delta),
        };
      })
      .sort((a, b) => a.delta - b.delta || Number(a.rank) - Number(b.rank));
  }, [students, selected]);
  const remainingPlan = useMemo(() => {
    if (!selected) return { hours: 0, flyingDays: 0 };

    const futureItems = courseTimeline.filter((item) => item.col > selected.col);
    const lastPlannedHours = Math.max(...timeline.map((item) => item.plannedHours), selected.plannedHours);

    return {
      hours: Math.max(0, lastPlannedHours - selected.plannedHours),
      flyingDays: futureItems.length,
    };
  }, [courseTimeline, selected, timeline]);
  const operationsSummary = useMemo(() => {
    if (!selected) return { sortiesLeft: TOTAL_SORTIES, flyingDaysLeft: TOTAL_FLYING_DAYS, flightsNeededPerDay: 0 };

    const sortiesFlown = students.reduce((total, student) => total + actualSortiesAt(student, selected), 0);
    const daysSoFar = courseTimeline.filter((item) => item.col <= selected.col).length;
    const sortiesLeft = Math.max(0, TOTAL_SORTIES - sortiesFlown);
    const flyingDaysLeft = Math.max(0, TOTAL_FLYING_DAYS - daysSoFar);

    return {
      sortiesLeft,
      flyingDaysLeft,
      flightsNeededPerDay: flyingDaysLeft > 0 ? sortiesLeft / flyingDaysLeft : 0,
    };
  }, [courseTimeline, selected, students]);
  const tableTotals = useMemo(() => {
    const totalGround = addGroundCounts(studentRows.map((row) => row.groundCounts));
    const totalActual = studentRows.reduce((total, row) => total + row.actualHours, 0);
    const totalPlanned = studentRows.reduce((total, row) => total + row.plannedHours, 0);
    const totalDelta = studentRows.reduce((total, row) => total + row.delta, 0);
    const count = Math.max(1, studentRows.length);

    return {
      totalGround,
      totalActual,
      totalPlanned,
      totalDelta,
      averageGround: {
        hold: totalGround.hold / count,
        abort: totalGround.abort / count,
        notScheduled: totalGround.notScheduled / count,
      },
      averageActual: totalActual / count,
      averagePlanned: totalPlanned / count,
      averageDelta: totalDelta / count,
    };
  }, [studentRows]);
  const groundRows = useMemo(() => {
    if (!selected) return [];

    return students
      .map((student) => {
        const entry = student.entriesByCol[String(selected.col)] ?? "";
        const classified = classifyGroundEntry(entry);
        if (!classified) return null;

        return {
          rank: student.rank,
          name: student.name,
          entry,
          groundCounts: accumulatedGroundCounts(student, selected, timeline),
          ...classified,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [selected, students, timeline]);
  const visibleTimeline = useMemo(() => {
    if (!selected) return courseTimeline.slice(0, 8);
    const index = courseTimeline.findIndex((item) => item.col === selected.col);
    const start = Math.max(0, index - 3);
    return courseTimeline.slice(start, start + 8);
  }, [courseTimeline, selected]);

  return (
    <main className="shell leadLagShell">
      <section className="topbar" aria-labelledby="lead-lag-title">
        <div>
          <p className="eyebrow">T-6C Progress</p>
          <h1 id="lead-lag-title">Lead / Lag</h1>
        </div>
        <div className="topActions">
          <Link className="navButton" href="/">
            Daily Schedule
          </Link>
          <button className="primaryButton compactButton" type="button" onClick={loadLeadLag}>
            Refresh
          </button>
        </div>
      </section>

      <section className="panel leadLagControls">
        <label>
          Plan date
          <select
            value={selected?.col ?? ""}
            onChange={(event) => setSelectedCol(Number(event.target.value))}
          >
            {courseTimeline.map((item) => (
              <option key={item.col} value={item.col}>
                {item.date || item.displayDate} - {item.mission || "No mission"}
              </option>
            ))}
          </select>
        </label>
        <div className="statusBlock">
          <strong>{status}</strong>
          <span>
            {payload?.updatedAt ? `Updated ${new Date(payload.updatedAt).toLocaleString()}` : "Waiting for sheet data"}
          </span>
        </div>
      </section>

      <section className="leadSummaryGrid" aria-label="Lead lag summary">
        <div className="leadSummaryCard">
          <span>Selected plan</span>
          <strong>{selected?.date || "-"}</strong>
          <small>
            {selected?.mission || "No mission"} / {formatHours(selected?.plannedHours ?? 0)} planned hours
          </small>
        </div>
        <div className="leadSummaryCard">
          <span>Remaining</span>
          <strong>{formatHours(remainingPlan.hours)} hr</strong>
          <small>Total planned hours left</small>
        </div>
        <div className="leadSummaryCard">
          <span>Sorties left</span>
          <strong>{operationsSummary.sortiesLeft}</strong>
          <small>{TOTAL_SORTIES} total sorties</small>
        </div>
        <div className="leadSummaryCard">
          <span>Flying days</span>
          <strong>{operationsSummary.flyingDaysLeft}</strong>
          <small>{TOTAL_FLYING_DAYS} planned non-0 mission days</small>
        </div>
        <div className="leadSummaryCard">
          <span>Flights / day</span>
          <strong>{operationsSummary.flightsNeededPerDay.toFixed(1)}</strong>
          <small>Needed from today forward</small>
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>Course Timeline</h2>
          <span>{courseTimeline.length} course blocks</span>
        </div>
        <div className="timelineStrip">
          {visibleTimeline.map((item) => (
            <button
              className={item.col === selected?.col ? "timelineItem active" : "timelineItem"}
              key={item.col}
              type="button"
              onClick={() => setSelectedCol(item.col)}
            >
              <span>{item.date || item.displayDate}</span>
              <strong>{item.mission || "0"}</strong>
              <small>{formatHours(item.plannedHours)} hr</small>
            </button>
          ))}
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>Student Lead / Lag</h2>
          <span>Sorted by most behind first</span>
        </div>
        <div className="daySchedule">
          <table className="leadLagTable">
            <thead>
              <tr>
                <th>Student</th>
                <th>Last flight</th>
                <th>Actual</th>
                <th>Plan</th>
                <th>Lead / Lag</th>
                <th>Ground total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {studentRows.map((row) => (
                <tr key={`${row.rank}-${row.name}`}>
                  <th>{row.name}</th>
                  <td>
                    {row.lastFlight ? (
                      <>
                        <strong>{row.lastFlight.value}</strong>
                        <span>{row.lastFlight.date || "No date"}</span>
                      </>
                    ) : (
                      "No flight"
                    )}
                  </td>
                  <td>{formatHours(row.actualHours)}</td>
                  <td>{formatHours(row.plannedHours)}</td>
                  <td>
                    <strong className={row.delta < 0 ? "negativeDelta" : "positiveDelta"}>
                      {row.delta > 0 ? "+" : ""}
                      {formatHours(row.delta)}
                    </strong>
                  </td>
                  <td>{groundCountLabel(row.groundCounts)}</td>
                  <td>
                    <span className={`leadStatus ${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>Total</th>
                <td>{studentRows.length} students</td>
                <td>{formatHours(tableTotals.totalActual)}</td>
                <td>{formatHours(tableTotals.totalPlanned)}</td>
                <td>{formatHours(tableTotals.totalDelta)}</td>
                <td>{groundCountLabel(tableTotals.totalGround)}</td>
                <td />
              </tr>
              <tr>
                <th>Average</th>
                <td>Per student</td>
                <td>{formatHours(tableTotals.averageActual)}</td>
                <td>{formatHours(tableTotals.averagePlanned)}</td>
                <td className={tableTotals.averageDelta < 0 ? "negativeDelta" : "positiveDelta"}>
                  {formatHours(tableTotals.averageDelta)}
                </td>
                <td>{groundCountLabel(tableTotals.averageGround)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>HOLD / ABORT / Not Scheduled</h2>
          <span>{selected?.date || "No date"} / {groundRows.length} row{groundRows.length === 1 ? "" : "s"}</span>
        </div>
        <div className="daySchedule">
          <table className="groundStatusTable">
            <thead>
              <tr>
                <th>Student</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Accumulated</th>
              </tr>
            </thead>
            <tbody>
              {groundRows.length === 0 ? (
                <tr>
                  <td colSpan={4}>No HOLD, ABORT, or Not Scheduled rows for this selected plan date.</td>
                </tr>
              ) : (
                groundRows.map((row) => (
                  <tr key={`${row.rank}-${row.name}-${row.status}`}>
                    <th>{row.name}</th>
                    <td>
                      <span className={`groundStatus ${row.status.replace(/\s+/g, "").toLowerCase()}`}>
                        {row.status}
                      </span>
                    </td>
                    <td>{row.reason}</td>
                    <td>{groundCountLabel(row.groundCounts)}</td>
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
