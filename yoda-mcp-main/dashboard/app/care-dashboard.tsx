"use client";

import useSWR from "swr";
import { useEffect, useRef, useState } from "react";
import type { SeniorProfile, BookedActivity, ActivityRequest, HealthIncident } from "@/lib/db";
import AlertsPanel from "./components/alerts-panel";
import ScreenTabs from "./components/screen-tabs";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ApiResp = {
  profile: SeniorProfile | null;
  requests: ActivityRequest[];
  incidents: HealthIncident[];
  at: number;
};

export default function CareDashboard() {
  const { data, error, isLoading, mutate } = useSWR<ApiResp>("/api/profile", fetcher, {
    refreshInterval: 3000,
    revalidateOnFocus: true,
  });

  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [alertBusy, setAlertBusy] = useState<Set<number>>(new Set());

  // relative "updated Xs ago" ticker
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-generate the AI clinical report once per serious/emergency incident that has none yet.
  const reportRequested = useRef<Set<number>>(new Set());
  useEffect(() => {
    const need = (data?.incidents ?? []).filter(
      (i) =>
        (i.effective_status === "serious" || i.effective_status === "emergency") &&
        !i.report &&
        !reportRequested.current.has(i.id),
    );
    if (need.length === 0) return;
    need.forEach((i) => reportRequested.current.add(i.id));
    (async () => {
      await Promise.all(
        need.map((i) => fetch(`/api/report/${i.id}`, { method: "POST" }).catch(() => {})),
      );
      await mutate();
    })();
  }, [data, mutate]);

  const seen = useRef<Set<string>>(new Set());
  const profile = data?.profile ?? null;
  const yp = profile?.yoda_profile;
  const ident = profile?.section_a_identification;
  const caregiver = profile?.section_p_caregiver?.primary_caregiver;

  const pending = (data?.requests ?? []).filter((r) => r.status === "pending");
  const confirmed = yp?.booked_activities ?? [];
  const incidents = data?.incidents ?? [];

  const name = ident?.preferred_name ?? yp?.preferred_address ?? "—";
  const initials = name.replace(/^Madam\s+|^Mdm\s+|^Mr\s+|^Mrs\s+/i, "").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const caregiverFirst = caregiver?.name?.split(" ")[0] ?? "you";

  const updatedAgo = data?.at ? Math.max(0, Math.round((now - data.at) / 1000)) : null;
  const agoLabel = updatedAgo === null ? "" : updatedAgo < 3 ? "just now" : `${updatedAgo}s ago`;

  async function decide(id: number, decision: "approve" | "decline") {
    setBusy((p) => new Set(p).add(id));
    try {
      await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });
      await mutate();
    } finally {
      setBusy((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
    }
  }

  async function decideAlert(id: number, action: "acknowledge" | "resolve") {
    setAlertBusy((p) => new Set(p).add(id));
    try {
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await mutate();
    } finally {
      setAlertBusy((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
    }
  }

  if (error) return <Centered>Couldn&apos;t reach the care database. Is the dev server connected to Neon?</Centered>;
  if (isLoading && !profile) return <Centered>Opening Madam Tan&apos;s care…</Centered>;
  if (!profile) return <Centered>No profile found for <code>mdm-tan</code> in Neon yet.</Centered>;

  return (
    <main className="mx-auto w-full max-w-[840px] px-6 pb-24 pt-10 sm:px-8">
      {/* top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[26px] font-semibold italic tracking-tight text-ink">Jarvis</span>
          <span className="text-[13px] font-medium uppercase tracking-[0.18em] text-faint">Care</span>
        </div>
        <div className="flex items-center gap-3">
          <ScreenTabs current="care" />
          <LivePill agoLabel={agoLabel} />
        </div>
      </div>

      {/* header card */}
      <section className="rise mt-6 flex items-center gap-5 rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-[0_8px_30px_rgba(120,90,40,0.07)]">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-[22px] font-semibold text-accent ring-1 ring-accent/20">
          {initials}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-semibold leading-none tracking-tight text-ink">{name}</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            {[ident?.age && `${ident.age}`, ident?.living_arrangement, ident?.location].filter(Boolean).join("  ·  ")}
          </p>
          {(yp?.language_preference || caregiver?.name) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
              {yp?.language_preference && (
                <span className="rounded-full border border-line bg-paper px-2.5 py-1 text-muted">Speaks {yp.language_preference}</span>
              )}
              {caregiver?.name && (
                <span className="rounded-full border border-line bg-paper px-2.5 py-1 text-muted">
                  Caregiver · {caregiver.name}
                  {caregiver.relationship ? ` (${caregiver.relationship.replace(/\s*\(.*\)/, "").toLowerCase()})` : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* HEALTH — triage alerts + escalation (Feature 3), surfaced first */}
      <AlertsPanel incidents={incidents} profile={profile} now={now} busy={alertBusy} onDecide={decideAlert} />

      {/* PENDING — needs the caregiver's decision */}
      {pending.length > 0 && (
        <section className="mt-9">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="font-display text-[22px] font-semibold tracking-tight text-ink">Needs your approval</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">
              {pending.length} request{pending.length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="space-y-3">
            {pending.map((req) => {
              const fresh = !seen.current.has(`p-${req.id}`);
              seen.current.add(`p-${req.id}`);
              return (
                <li
                  key={req.id}
                  className={`rounded-[16px] border border-accent/25 bg-card p-4 shadow-[0_6px_22px_rgba(217,114,47,0.08)] ${fresh ? "fresh" : ""}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent">
                      <Sprout />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Jarvis requested</p>
                      <p className="mt-0.5 truncate font-display text-[17px] font-semibold leading-tight text-ink">{req.event.name}</p>
                      <p className="mt-0.5 truncate text-[13.5px] text-muted">
                        {[req.event.location, req.event.date, req.event.time].filter(Boolean).join("  ·  ")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3.5 flex items-center justify-end gap-2.5">
                    <button
                      onClick={() => decide(req.id, "decline")}
                      disabled={busy.has(req.id)}
                      className="rounded-full px-4 py-2 text-[13.5px] font-medium text-muted transition-colors hover:bg-paper disabled:opacity-50"
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => decide(req.id, "approve")}
                      disabled={busy.has(req.id)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-green px-5 py-2 text-[13.5px] font-semibold text-white shadow-[0_2px_10px_rgba(60,122,85,0.25)] transition-transform hover:scale-[1.02] disabled:opacity-60"
                    >
                      {busy.has(req.id) ? "Saving…" : <>Approve & book</>}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* CONFIRMED — the activities approved & booked */}
      <section className="rise mt-9" style={{ animationDelay: "180ms" }}>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-[22px] font-semibold tracking-tight text-ink">Arranged by Jarvis</h2>
          <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-faint">
            {confirmed.length} confirmed
          </span>
        </div>

        {confirmed.length === 0 ? (
          <div className="grid place-items-center rounded-[var(--radius-card)] border border-dashed border-line bg-card/60 px-6 py-12 text-center">
            <p className="font-display text-[17px] italic text-muted">Nothing booked yet.</p>
            <p className="mt-1 text-[13.5px] text-faint">
              When you approve a request above, the confirmed activity appears here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {confirmed.map((a, i) => (
              <ActivityRow key={a.reference ?? `${a.event}-${i}`} activity={a} fresh={!seen.current.has(`c-${a.reference}`)} mark={() => seen.current.add(`c-${a.reference}`)} />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-center text-[12px] text-faint">
        Jarvis asks · {caregiverFirst} decides · Neon Postgres · refreshes every 3s
      </p>
    </main>
  );
}

/* ---------- pieces ---------- */

function LivePill({ agoLabel }: { agoLabel: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-green/25 bg-green-soft px-3 py-1.5">
      <span className="live-dot h-2 w-2 rounded-full bg-green" />
      <span className="text-[12.5px] font-semibold text-green">Live</span>
      {agoLabel && <span className="text-[12px] text-green/70">· {agoLabel}</span>}
    </div>
  );
}

function ActivityRow({ activity, fresh, mark }: { activity: BookedActivity; fresh: boolean; mark: () => void }) {
  mark();
  return (
    <li className={`flex items-center gap-4 rounded-[16px] border border-line bg-card p-4 shadow-[0_4px_18px_rgba(120,90,40,0.05)] ${fresh ? "fresh" : ""}`}>
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-green-soft text-green">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[17px] font-semibold leading-tight text-ink">{activity.event}</p>
        <p className="mt-0.5 truncate text-[13.5px] text-muted">
          {[activity.location, activity.date, activity.time].filter(Boolean).join("  ·  ")}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-soft px-2.5 py-1 text-[12px] font-semibold text-green">Confirmed</span>
        {activity.reference && <p className="mt-1.5 font-mono text-[11px] text-faint">{activity.reference}</p>}
      </div>
    </li>
  );
}

function Sprout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20c4-2.8 7-6 7-10a4 4 0 0 0-7-2.5" />
      <path d="M12 20C8 17.2 5 14 5 10a4 4 0 0 1 7-2.5" />
      <path d="M12 7.5V20" />
    </svg>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <p className="font-display text-[18px] italic text-muted">{children}</p>
    </main>
  );
}
