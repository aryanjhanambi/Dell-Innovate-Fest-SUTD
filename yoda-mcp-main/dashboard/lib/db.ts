import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export type BookedActivity = {
  event?: string;
  location?: string;
  date?: string;
  time?: string;
  reference?: string;
};

export type SeniorProfile = {
  senior_id?: string;
  last_updated?: string;
  section_a_identification?: {
    preferred_name?: string;
    name?: string;
    age?: number;
    gender?: string;
    location?: string;
    living_arrangement?: string;
  };
  section_p_caregiver?: {
    primary_caregiver?: { relationship?: string; name?: string; availability?: string };
  };
  // interRAI health sections surfaced on a health alert (Feature 3)
  section_e_health_conditions?: {
    falls?: { last_30_days?: string; "31_to_90_days_ago"?: string; "91_to_180_days_ago"?: string };
    problem_frequency_last_3_days?: Record<string, string>;
    pain_symptoms?: { frequency?: string; intensity?: string; location?: string };
  };
  section_f_disease_diagnoses?: Record<string, string>;
  // medications + advance-care directives (used in the paramedic handover, Feature 3.5)
  section_m_medications?: {
    total_medications?: number;
    adherence?: string;
    medications?: { name?: string; dose?: string; frequency?: string; for?: string }[];
    allergies?: string[];
  };
  section_s_directives?: {
    appointed_donee_or_deputy?: boolean;
    advance_care_planning_done?: boolean;
    acp_date?: string;
    preferred_care_plan?: string;
    resuscitation_preference?: string;
  };
  yoda_profile?: {
    preferred_address?: string;
    language_preference?: string;
    interests?: string[];
    enrolled_services?: string[];
    fitness_preferences?: {
      preferred_day?: string;
      preferred_location?: string;
      goals?: string[];
    };
    risk_flags?: string[];
    booked_activities?: BookedActivity[];
    caregiver_alerts?: string[];
  };
};

/** Read one senior's full knowledge-base profile from the shared Neon DB. */
export async function getProfile(seniorId = "mdm-tan"): Promise<SeniorProfile | null> {
  const rows = (await sql`
    SELECT data FROM profiles WHERE senior_id = ${seniorId}
  `) as { data: SeniorProfile }[];
  return rows[0]?.data ?? null;
}

export type ActivityRequest = {
  id: number;
  event: { name?: string; location?: string; date?: string; time?: string };
  status: "pending" | "approved" | "declined";
  reference?: string | null;
  created_at?: string;
};

/** Activity requests Yoda raised for the caregiver to decide on. */
export async function listRequests(seniorId = "mdm-tan"): Promise<ActivityRequest[]> {
  const rows = (await sql`
    SELECT id, event, status, reference, created_at
    FROM requests WHERE senior_id = ${seniorId}
    ORDER BY created_at DESC
  `) as ActivityRequest[];
  return rows;
}

/** Caregiver decision. On approve: mint a mock booking ref AND append the confirmed
 *  activity to the senior's profile (so it shows under "Arranged by Yoda"). */
export async function decideRequest(id: number, decision: "approve" | "decline"): Promise<void> {
  const status = decision === "approve" ? "approved" : "declined";
  const reference = decision === "approve" ? `ACT-${Math.floor(1000 + Math.random() * 9000)}` : null;

  const rows = (await sql`
    UPDATE requests
    SET status = ${status}, reference = ${reference}, decided_at = now(), decided_by = 'caregiver'
    WHERE id = ${id}
    RETURNING senior_id, event
  `) as { senior_id: string; event: ActivityRequest["event"] }[];

  const r = rows[0];
  if (decision === "approve" && r) {
    const booking = JSON.stringify({
      event: r.event.name,
      location: r.event.location,
      date: r.event.date,
      time: r.event.time,
      reference,
    });
    await sql`
      UPDATE profiles
      SET data = jsonb_set(
        data, '{yoda_profile,booked_activities}',
        COALESCE(data->'yoda_profile'->'booked_activities', '[]'::jsonb) || ${booking}::jsonb,
        true
      )
      WHERE senior_id = ${r.senior_id}
    `;
  }
}

/* ---------- Feature 3: health incidents (triage + escalation) ---------- */

// AI-synthesized clinical report (Feature 3.5) — produced server-side from the incident + interRAI record.
export type HealthReport = {
  caregiver_summary: { what_happened: string; why_it_matters: string; do_now: string[] };
  sbar: { situation: string; background: string; assessment: string; recommendation: string };
  paramedic_handover: {
    presenting: string;
    key_history: string;
    medications: string;
    allergies: string;
    code_status: string;
    mobility: string;
    caregiver_contact: string;
  };
  red_flags: string[];
  confidence_note: string;
};

export type HealthIncident = {
  id: number;
  senior_id?: string;
  complaint?: string | null;
  primary_symptom?: string | null;
  location?: string | null;
  severity_1_10?: number | null;
  dizziness?: boolean;
  chest_pain?: boolean;
  triage_level?: "mild" | "serious" | null;
  status: "in_progress" | "triaged" | "acknowledged" | "resolved";
  notes?: string | null;
  started_at?: string;
  triaged_at?: string | null;
  // Derived in SQL: 'checking' (mid-triage) | 'mild' | 'serious' | 'emergency' (no response) | 'acknowledged'
  effective_status: "checking" | "mild" | "serious" | "emergency" | "acknowledged";
  age_s?: number;
  report?: HealthReport | null;
  report_generated_at?: string | null;
};

// How long an open (in_progress) incident may sit before silence reads as an emergency.
const EMERGENCY_TIMEOUT_S = Number(process.env.EMERGENCY_TIMEOUT_S ?? 25);

/** Active health incidents, newest first, with effective_status computed at query time.
 *  The 'emergency' value IS the no-response watchdog: derived from now() vs started_at,
 *  so the dashboard's normal 3s poll surfaces an escalation with no cron/worker. */
export async function listHealthIncidents(seniorId = "mdm-tan"): Promise<HealthIncident[]> {
  const rows = (await sql`
    SELECT id, senior_id, complaint, primary_symptom, location, severity_1_10, dizziness, chest_pain,
           triage_level, status, notes, started_at, triaged_at, report, report_generated_at,
           CASE
             WHEN status = 'in_progress' AND now() - started_at > make_interval(secs => ${EMERGENCY_TIMEOUT_S}) THEN 'emergency'
             WHEN status = 'in_progress' THEN 'checking'
             WHEN status = 'triaged' AND triage_level = 'serious' THEN 'serious'
             WHEN status = 'triaged' AND triage_level = 'mild'    THEN 'mild'
             ELSE status
           END AS effective_status,
           EXTRACT(EPOCH FROM (now() - started_at))::int AS age_s
    FROM health_incidents
    WHERE senior_id = ${seniorId} AND status <> 'resolved'
    ORDER BY started_at DESC
  `) as HealthIncident[];
  return rows;
}

/** Caregiver action on an alert: acknowledge (seen, still open) or resolve (closed). */
export async function decideIncident(id: number, action: "acknowledge" | "resolve"): Promise<void> {
  const status = action === "resolve" ? "resolved" : "acknowledged";
  await sql`
    UPDATE health_incidents SET status = ${status}, decided_at = now() WHERE id = ${id}
  `;
}

/** One incident by id (incl. any cached report) — used by the report route + printable page. */
export async function getIncident(id: number): Promise<HealthIncident | null> {
  const rows = (await sql`
    SELECT id, senior_id, complaint, primary_symptom, location, severity_1_10, dizziness, chest_pain,
           triage_level, status, notes, started_at, triaged_at, report, report_generated_at,
           status AS effective_status
    FROM health_incidents WHERE id = ${id}
  `) as HealthIncident[];
  return rows[0] ?? null;
}

/** Cache a generated clinical report on the incident row. */
export async function saveReport(id: number, report: HealthReport, model: string): Promise<void> {
  await sql`
    UPDATE health_incidents
    SET report = ${JSON.stringify(report)}::jsonb, report_model = ${model}, report_generated_at = now()
    WHERE id = ${id}
  `;
}

/* ---------- Cloud-relay welfare (no LAN IP): device polls + pushes photos ---------- */

export type WelfareFrame = {
  frame: string | null; // base64 JPEG (no data: prefix)
  frame_at: string | null;
  last_seen: string | null;
  device_ip: string | null;
  camera_requested: boolean;
  online: boolean;
};

/** Necklace poll: record it's alive (+ its LAN IP), deliver pending commands, clear the one-shot ping. */
export async function recordPoll(seniorId: string, ip: string | null): Promise<{ ping: boolean; camera: boolean }> {
  const cur = (await sql`
    SELECT ping_requested, camera_requested FROM device_state WHERE senior_id = ${seniorId}
  `) as { ping_requested: boolean; camera_requested: boolean }[];
  const ping = cur[0]?.ping_requested ?? false;
  const camera = cur[0]?.camera_requested ?? false;
  await sql`
    INSERT INTO device_state (senior_id, last_seen, device_ip, ping_requested, updated_at)
    VALUES (${seniorId}, now(), ${ip}, false, now())
    ON CONFLICT (senior_id) DO UPDATE
      SET last_seen = now(),
          device_ip = COALESCE(${ip}, device_state.device_ip),
          ping_requested = false,
          updated_at = now()
  `;
  return { ping, camera };
}

/** Necklace upload: store the latest photo (base64 JPEG). */
export async function saveFrame(seniorId: string, base64: string): Promise<void> {
  await sql`
    INSERT INTO device_state (senior_id, latest_frame, frame_at, last_seen, updated_at)
    VALUES (${seniorId}, ${base64}, now(), now(), now())
    ON CONFLICT (senior_id) DO UPDATE
      SET latest_frame = ${base64}, frame_at = now(), last_seen = now(), updated_at = now()
  `;
}

/** Caregiver action: ping (beep+announce) or camera on/off. */
export async function setWelfareCommand(seniorId: string, action: "ping" | "camera_on" | "camera_off"): Promise<void> {
  if (action === "ping") {
    await sql`
      INSERT INTO device_state (senior_id, ping_requested, updated_at) VALUES (${seniorId}, true, now())
      ON CONFLICT (senior_id) DO UPDATE SET ping_requested = true, updated_at = now()`;
  } else {
    const on = action === "camera_on";
    await sql`
      INSERT INTO device_state (senior_id, camera_requested, updated_at) VALUES (${seniorId}, ${on}, now())
      ON CONFLICT (senior_id) DO UPDATE SET camera_requested = ${on}, updated_at = now()`;
  }
}

/** Dashboard read: the latest photo + online/IP status. `online` = polled within ~12s. */
export async function getWelfareFrame(seniorId: string): Promise<WelfareFrame> {
  const rows = (await sql`
    SELECT latest_frame, frame_at, last_seen, device_ip, camera_requested,
           (last_seen IS NOT NULL AND now() - last_seen < interval '45 seconds') AS online
    FROM device_state WHERE senior_id = ${seniorId}
  `) as {
    latest_frame: string | null;
    frame_at: string | null;
    last_seen: string | null;
    device_ip: string | null;
    camera_requested: boolean;
    online: boolean;
  }[];
  const r = rows[0];
  return {
    frame: r?.latest_frame ?? null,
    frame_at: r?.frame_at ?? null,
    last_seen: r?.last_seen ?? null,
    device_ip: r?.device_ip ?? null,
    camera_requested: r?.camera_requested ?? false,
    online: r?.online ?? false,
  };
}
