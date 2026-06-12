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
};

type LeadLagPayload = {
  updatedAt: string;
  timeline: TimelineItem[];
  students: StudentLeadLag[];
  error?: string;
};

type StudentStatus = "lead" | "track" | "lag";

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
  const recorded = student.actualHoursByCol[String(selected.col)];
  if (typeof recorded === "number") return recorded;

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
      const nextDate = data.timeline.find((item) => item.date >= today && item.date);
      const fallback = data.timeline.find((item) => item.date) ?? data.timeline[0];
      setSelectedCol((current) => current ?? nextDate?.col ?? fallback?.col ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load lead/lag sheet");
    }
  }

  useEffect(() => {
    void loadLeadLag();
  }, []);

  const timeline = payload?.timeline ?? [];
  const students = payload?.students ?? [];
  const selected = useMemo(
    () => timeline.find((item) => item.col === selectedCol) ?? timeline[0],
    [timeline, selectedCol],
  );
  const studentRows = useMemo(() => {
    if (!selected) return [];

    return students
      .map((student) => {
        const actualHours = actualHoursAt(student, selected);
        const plannedHours = selected.plannedHours;
        const delta = actualHours - plannedHours;
        const lastFlight = lastFlightAt(student, selected);

        return {
          ...student,
          actualHours,
          plannedHours,
          delta,
          lastFlight,
          status: statusFor(delta),
        };
      })
      .sort((a, b) => a.delta - b.delta || Number(a.rank) - Number(b.rank));
  }, [students, selected]);
  const summary = useMemo(() => {
    return studentRows.reduce(
      (totals, row) => ({
        lead: totals.lead + (row.status === "lead" ? 1 : 0),
        track: totals.track + (row.status === "track" ? 1 : 0),
        lag: totals.lag + (row.status === "lag" ? 1 : 0),
      }),
      { lead: 0, track: 0, lag: 0 },
    );
  }, [studentRows]);
  const visibleTimeline = useMemo(() => {
    if (!selected) return timeline.slice(0, 8);
    const index = timeline.findIndex((item) => item.col === selected.col);
    const start = Math.max(0, index - 3);
    return timeline.slice(start, start + 8);
  }, [timeline, selected]);

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
            {timeline.map((item) => (
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
          <span>Behind</span>
          <strong>{summary.lag}</strong>
          <small>Needs catch-up attention</small>
        </div>
        <div className="leadSummaryCard">
          <span>On track</span>
          <strong>{summary.track}</strong>
          <small>Within 1.0 hour</small>
        </div>
        <div className="leadSummaryCard">
          <span>Ahead</span>
          <strong>{summary.lead}</strong>
          <small>At least 1.0 hour ahead</small>
        </div>
      </section>

      <section className="panel wide">
        <div className="panelHeader">
          <h2>Course Timeline</h2>
          <span>{timeline.length} plan columns</span>
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
                <th>Rank</th>
                <th>Student</th>
                <th>Last flight</th>
                <th>Actual</th>
                <th>Plan</th>
                <th>Lead / Lag</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {studentRows.map((row) => (
                <tr key={`${row.rank}-${row.name}`}>
                  <td>{row.rank}</td>
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
                  <td>
                    <span className={`leadStatus ${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
