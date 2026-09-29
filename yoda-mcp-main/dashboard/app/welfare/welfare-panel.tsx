"use client";

import useSWR from "swr";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SeniorProfile, ActivityRequest, WelfareFrame } from "@/lib/db";
import ScreenTabs from "../components/screen-tabs";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
type ApiResp = { profile: SeniorProfile | null; requests: ActivityRequest[]; at: number };

type Step = "idle" | "pinged" | "camera";
type LogItem = { at: number; text: string; tone: "neutral" | "accent" | "green" | "coral" };

// LAN fallback only (same-Wi-Fi). The primary path is the cloud relay.
function deviceUrl(ip: string, path: string) {
  return `http://${ip}${path}`;
}

export default function WelfarePanel() {
  const { data } = useSWR<ApiResp>("/api/profile", fetcher, { revalidateOnFocus: false });
  const ident = data?.profile?.section_a_identification;
  const name = ident?.preferred_name ?? "Madam Tan";
  const address = ident?.location ?? "Blk 123 Bedok North";
  const initials = name.replace(/^Madam\s+|^Mdm\s+|^Mr\s+|^Mrs\s+/i, "").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  // The cloud relay: device check-in + the latest photo it pushed. Poll fast (~800ms) so the
  // continuously-pushed frames render like a (low-fps) video rather than a slow slideshow.
  const { data: welfare, mutate: refreshFrame } = useSWR<WelfareFrame>(
    "/api/welfare/frame?senior=mdm-tan",
    fetcher,
    { refreshInterval: 800 },
  );
  const online = welfare?.online ?? false;
  const frame = welfare?.frame ?? null;
  const deviceIp = welfare?.device_ip ?? null;

  const [step, setStep] = useState<Step>("idle");
  const [lanStream, setLanStream] = useState(false); // same-Wi-Fi smooth video vs cloud slideshow
  const [busy, setBusy] = useState<null | "ping" | "camera">(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [now, setNow] = useState(0);

  // Preload-swap: only show a new frame once it has decoded, so the feed never flashes black.
  const [shownFrame, setShownFrame] = useState<string | null>(null);
  useEffect(() => {
    if (!frame) { setShownFrame(null); return; }
    const url = `data:image/jpeg;base64,${frame}`;
    const img = new window.Image();
    img.onload = () => setShownFrame(url);
    img.src = url;
  }, [frame]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const addLog = useCallback((text: string, tone: LogItem["tone"] = "neutral") => {
    setLog((l) => [{ at: Date.now(), text, tone }, ...l]);
  }, []);

  // Send a caregiver command to the cloud; the necklace picks it up on its next poll.
  async function command(action: "ping" | "camera_on" | "camera_off") {
    const r = await fetch("/api/welfare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senior: "mdm-tan", action }),
    });
    if (!r.ok) throw new Error("Couldn't reach the cloud");
  }

  async function onPing() {
    setBusy("ping");
    try {
      await command("ping");
      setStep((s) => (s === "idle" ? "pinged" : s));
      addLog(`Ping sent — Jarvis will beep and ask her to respond`, "accent");
    } catch (e) {
      addLog((e as Error).message, "coral");
    } finally {
      setBusy(null);
    }
  }

  async function onCamera() {
    setBusy("camera");
    try {
      if (deviceIp) {
        // Same Wi-Fi (demo): arm + announce directly on the necklace, then stream smooth MJPEG.
        const r = await fetch(deviceUrl(deviceIp, "/camera/on")).catch(() => null);
        if (!r || !r.ok) throw new Error("Couldn't reach the necklace on this Wi-Fi — is the laptop on the same network?");
        setStep("camera");
        setLanStream(true);
        addLog(`Jarvis announced “we're checking on you now” — live video starting`, "accent");
      } else {
        // Remote: fall back to the cloud relay (photo-by-photo, slower).
        await command("camera_on");
        setStep("camera");
        setLanStream(false);
        addLog(`Jarvis will announce, then send photos to the cloud`, "accent");
        refreshFrame();
      }
    } catch (e) {
      addLog((e as Error).message, "coral");
    } finally {
      setBusy(null);
    }
  }

  async function onResolve() {
    try {
      if (deviceIp) await fetch(deviceUrl(deviceIp, "/camera/off")).catch(() => {});
      await command("camera_off").catch(() => {});
    } finally {
      setLanStream(false);
      setStep("idle");
      addLog("Marked resolved — camera turned off", "green");
    }
  }

  const frameAgo = welfare?.frame_at ? ago(now, new Date(welfare.frame_at).getTime()) : null;

  return (
    <main className="mx-auto w-full max-w-[840px] px-6 pb-24 pt-10 sm:px-8">
      {/* top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[26px] font-semibold italic tracking-tight text-ink">Jarvis</span>
          <span className="text-[13px] font-medium uppercase tracking-[0.18em] text-faint">Welfare check</span>
        </div>
        <ScreenTabs current="welfare" />
      </div>

      {/* senior + status */}
      <section className="rise mt-6 flex items-center gap-5 rounded-[var(--radius-card)] border border-line bg-card p-6 shadow-[0_8px_30px_rgba(120,90,40,0.07)]">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent-soft font-display text-[22px] font-semibold text-accent ring-1 ring-accent/20">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[30px] font-semibold leading-none tracking-tight text-ink">{name}</h1>
          <p className="mt-1.5 text-[15px] text-muted">{address}</p>
        </div>
        <span className="shrink-0 rounded-full bg-coral-soft px-3 py-1.5 text-[12.5px] font-semibold text-coral">
          Doorbell + call · no answer
        </span>
      </section>

      {/* device online status — no IP needed (necklace reports in to the cloud) */}
      <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-line bg-card/70 px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${online ? "text-green" : "text-faint"}`}>
          <span className={`h-2 w-2 rounded-full ${online ? "bg-green live-dot" : "bg-faint"}`} />
          {online ? "Necklace online" : "Necklace offline — not checked in recently"}
        </span>
        <span className="ml-auto text-[12px] text-faint">No setup — Jarvis reaches the cloud from anywhere</span>
      </div>

      {/* STEP 1 — ping */}
      <StepCard
        n={1}
        title="Ping Madam Tan"
        done={step !== "idle"}
        desc="You couldn't reach her at the door or by phone. Jarvis beeps and asks her to respond — if she answers, you know she's okay."
        delay="120ms"
      >
        <button
          onClick={onPing}
          disabled={busy === "ping"}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_2px_12px_rgba(217,114,47,0.3)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "ping" ? "Pinging…" : step !== "idle" ? "Ping again" : "Ping Madam Tan"}
        </button>
        {step !== "idle" && (
          <span className="text-[13px] font-medium text-green">✓ Ping sent — waiting for her to respond</span>
        )}
      </StepCard>

      {/* STEP 2 — camera (cloud relay) */}
      <StepCard
        n={2}
        title="View camera (only if no response)"
        locked={step === "idle"}
        desc="Only if she doesn't answer the ping. Jarvis announces “we are checking on you now”, then shows a live view of the room so you can see she's okay."
        delay="200ms"
      >
        {step !== "camera" ? (
          <>
            <button
              onClick={onCamera}
              disabled={busy === "camera" || step === "idle"}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_2px_12px_rgba(34,29,22,0.25)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "camera" ? "Announcing…" : "View camera"}
            </button>
            {step === "idle" && <span className="text-[12.5px] text-faint">Unlocks after you ping her</span>}
          </>
        ) : (
          <div className="w-full">
            <div className="relative overflow-hidden rounded-[16px] border border-line bg-black/90 shadow-inner">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {lanStream && deviceIp ? (
                // smooth same-Wi-Fi MJPEG — a real video feed, not a slideshow
                <img
                  src={deviceUrl(deviceIp, "/stream")}
                  alt="Live video from Madam Tan's necklace"
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : shownFrame ? (
                <img
                  src={shownFrame}
                  alt="Live view from Madam Tan's necklace"
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="grid aspect-[4/3] w-full place-items-center text-center text-[13px] text-white/60">
                  Waiting for the necklace to send a photo…
                  <br />
                  <span className="text-white/40">(she's being announced to first)</span>
                </div>
              )}
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-coral/90 px-2.5 py-1 text-[11px] font-semibold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white live-dot" /> LIVE
              </span>
              {lanStream ? (
                <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white/85">
                  live video · same Wi-Fi
                </span>
              ) : frameAgo ? (
                <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white/85">
                  updated {frameAgo}
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12.5px] text-muted">
                {lanStream
                  ? "Live video · streaming directly from the necklace · she was told the camera is on"
                  : "Live · relayed from the cloud · she was told the camera is on"}
              </span>
              <button
                onClick={onResolve}
                className="rounded-full bg-green px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_10px_rgba(60,122,85,0.25)] transition-transform hover:scale-[1.02]"
              >
                Mark resolved
              </button>
            </div>
            <p className="mt-3 text-[12.5px] text-faint">
              After viewing, decide next steps yourself — call her, call family, or dial 995. Jarvis does not escalate on its own.
            </p>
          </div>
        )}
      </StepCard>

      {/* action log */}
      <section className="rise mt-9" style={{ animationDelay: "280ms" }}>
        <h2 className="mb-3 font-display text-[20px] font-semibold tracking-tight text-ink">Session log</h2>
        {log.length === 0 ? (
          <p className="rounded-[16px] border border-dashed border-line bg-card/60 px-5 py-8 text-center font-display text-[15px] italic text-faint">
            Actions you take will be timestamped here for the record.
          </p>
        ) : (
          <ul className="space-y-2">
            {log.map((item, i) => (
              <li key={i} className="flex items-baseline gap-3 rounded-[12px] border border-line bg-card px-4 py-2.5">
                <span className="shrink-0 font-mono text-[11.5px] text-faint">{ago(now, item.at)}</span>
                <span
                  className={`text-[13.5px] ${
                    item.tone === "accent" ? "text-accent" : item.tone === "green" ? "text-green" : item.tone === "coral" ? "text-coral" : "text-muted"
                  }`}
                >
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-center text-[12px] text-faint">
        Caregiver-initiated · the necklace announces before the camera turns on · all actions logged
      </p>
    </main>
  );
}

/* ---------- pieces ---------- */

function StepCard({
  n, title, desc, children, done, locked, delay,
}: {
  n: number; title: string; desc: string; children: React.ReactNode;
  done?: boolean; locked?: boolean; delay?: string;
}) {
  return (
    <section
      className={`rise mt-5 rounded-[var(--radius-card)] border bg-card p-6 shadow-[0_6px_22px_rgba(120,90,40,0.06)] ${
        locked ? "border-line opacity-60" : done ? "border-green/30" : "border-line"
      }`}
      style={delay ? { animationDelay: delay } : undefined}
    >
      <div className="flex items-start gap-4">
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-[16px] font-semibold ${
            done ? "bg-green-soft text-green" : "bg-accent-soft text-accent"
          }`}
        >
          {done ? "✓" : n}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[19px] font-semibold leading-tight text-ink">{title}</h3>
          <p className="mt-1 text-[14px] leading-snug text-muted">{desc}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function ago(now: number, at: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 3) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
