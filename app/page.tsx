"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Bot,
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleDashed,
  CircleHelp,
  Clock,
  Copy,
  Database,
  ExternalLink,
  Flag,
  Headset,
  Home,
  IndianRupee,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  Moon,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  Play,
  PlugZap,
  Quote,
  Ruler,
  Search,
  ShieldAlert,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  User,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { formatClock, formatDay, formatTime } from "@/lib/format";
import type {
  AutomationOutput,
  CallsResponse,
  CallView,
  CriterionKey,
  CriterionStatus,
  Designer,
  DossierEntity,
  IntegrationStatus,
  OutputKey,
  OutputStatus,
  PricingGuardrail,
  Qualification,
} from "@/lib/types";

/* ────────────────────────────────────────────────────────────────────────────
 * Presentation config
 * ──────────────────────────────────────────────────────────────────────────── */

type FilterTab = "all" | "qualified" | "after-hours";

const QUAL_STYLE: Record<Qualification, { chip: string; dot: string }> = {
  Qualified: { chip: "bg-[#E7EFE6] text-[#3C6446] ring-[#C9DCC9]", dot: "bg-[#5C8A66]" },
  Nurture: { chip: "bg-[#F6ECD9] text-[#8E6420] ring-[#E8D4AE]", dot: "bg-[#C49447]" },
  "Out of Scope": { chip: "bg-[#F3E6E1] text-[#8A4B3E] ring-[#E5CBC2]", dot: "bg-[#B5735F]" },
  Escalation: { chip: "bg-[#F7DED8] text-[#8E2F22] ring-[#EBB9AE]", dot: "bg-[#C0473A]" },
  Missed: { chip: "bg-[#EEEAE4] text-[#6B6259] ring-[#DDD5CA]", dot: "bg-[#9A9084]" },
};

const OUTPUT_CONFIG: Record<OutputKey, { title: string; audience: string; icon: LucideIcon }> = {
  dashboard: { title: "Operational Dashboard", audience: "Front Desk & Designers", icon: LayoutDashboard },
  hubspot: { title: "HubSpot CRM", audience: "Deal pipeline · Nikhil", icon: Database },
  email: { title: "Designer Email", audience: "Lead briefing dossier", icon: Mail },
  calendar: { title: "Calendar Hold", audience: "15-min discovery call", icon: CalendarCheck },
};

const STATUS_STYLE: Record<OutputStatus, { label: string; icon: LucideIcon; pill: string; spin?: boolean }> = {
  delivered: { label: "Delivered", icon: Check, pill: "bg-[#E7EFE6] text-[#3C6446]" },
  syncing: { label: "Syncing", icon: Loader2, pill: "bg-[#EEE9E1] text-[#6B5F51]", spin: true },
  pending: { label: "Ready", icon: CircleDashed, pill: "bg-[#F6ECD9] text-[#8E6420]" },
  "not-connected": { label: "Not connected", icon: PlugZap, pill: "bg-[#EFEBE5] text-[#7D7266]" },
  skipped: { label: "Not required", icon: Ban, pill: "bg-[#F1EEEA] text-[#9A9084]" },
  failed: { label: "Failed", icon: AlertTriangle, pill: "bg-[#F7DED8] text-[#8E2F22]" },
};

type EntityKey = "propertyScope" | "carpetArea" | "budget" | "location" | "timeline";

const ENTITY_FIELDS: { key: EntityKey; label: string; icon: LucideIcon; wide?: boolean }[] = [
  { key: "propertyScope", label: "Property Type & Scope", icon: Home, wide: true },
  { key: "carpetArea", label: "Carpet Area", icon: Ruler },
  { key: "budget", label: "Target Budget", icon: IndianRupee },
  { key: "location", label: "Site Location", icon: MapPin },
  { key: "timeline", label: "Possession / Timeline", icon: CalendarClock },
];

const CRITERIA: { key: CriterionKey; label: string }[] = [
  { key: "realProject", label: "Real project — design + execution" },
  { key: "serviceArea", label: "In Pune / PCMC" },
  { key: "timeline", label: "Realistic timeline" },
  { key: "budget", label: "Budget broadly aligned" },
  { key: "decisionMaker", label: "Decision-maker on call" },
];

const CRITERION_STYLE: Record<CriterionStatus, { icon: LucideIcon; tone: string; label: string }> = {
  pass: { icon: Check, tone: "bg-[#E7EFE6] text-[#3C6446]", label: "Pass" },
  fail: { icon: X, tone: "bg-[#F7DED8] text-[#8E2F22]", label: "Fail" },
  unclear: { icon: CircleHelp, tone: "bg-[#F3EEE6] text-[#8A7F72]", label: "Unclear" },
};

const UNASSESSED: Qualification[] = ["Escalation", "Missed"];
const NOT_CAPTURED = /^(not stated|not mentioned|not captured|unknown|n\/a)$/i;

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

function displayName(call: CallView): string {
  return call.callerName ?? "Unnamed caller";
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter((p) => /^[A-Za-z]/.test(p))
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Deterministic pseudo-waveform so each call's timeline looks stable. */
function buildWaveform(seed: string, bars: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: bars }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const noise = (h % 1000) / 1000;
    const envelope = 0.55 + 0.45 * Math.sin((i / bars) * Math.PI * 6 + noise);
    return Math.max(0.14, Math.min(1, 0.25 + noise * 0.55 * envelope + 0.2 * envelope));
  });
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Primitives
 * ──────────────────────────────────────────────────────────────────────────── */

function QualificationBadge({ value, size = "sm" }: { value: Qualification; size?: "sm" | "md" }) {
  const s = QUAL_STYLE[value];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        s.chip,
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", s.dot)} />
      {value}
    </span>
  );
}

function AfterHoursTag() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#2A241E] px-2 py-0.5 text-[11px] font-medium text-[#F3E9DA]">
      <Moon className="h-3 w-3 text-[#E0B872]" strokeWidth={2} />
      Outside 10am–7pm
    </span>
  );
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section
      className={cx(
        "rounded-[20px] border border-[#E8E1D6] bg-white/90 shadow-[0_1px_2px_rgba(42,36,30,0.04),0_8px_24px_-12px_rgba(42,36,30,0.08)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

function SectionLabel({ icon: Icon, children, right }: { icon: LucideIcon; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A7F72]">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {children}
      </div>
      {right}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Top bar
 * ──────────────────────────────────────────────────────────────────────────── */

function TopBar({
  integrations,
  pendingCount,
  bulkSyncing,
  onPushAll,
}: {
  integrations: IntegrationStatus | null;
  pendingCount: number;
  bulkSyncing: boolean;
  onPushAll: () => void;
}) {
  const vaaniReady = integrations?.vaani.apiKeyConfigured && integrations.vaani.webhookSecretConfigured;
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[#E8E1D6] bg-[#FBF9F6]/90 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-end justify-center overflow-hidden rounded-xl bg-[#2A241E] pb-1.5">
          <span className="h-4 w-4 rounded-t-full border-2 border-b-0 border-[#E0B872]" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="font-display truncate text-[18px]">Aangan Studio</p>
          <p className="truncate text-[11px] text-[#9A8F82]">Voice AI Call Console</p>
        </div>
      </div>
      {integrations && (
        <div className="flex items-center gap-2">
          <span
            className="hidden items-center gap-2 rounded-full border border-[#E3DACD] bg-white px-3 py-1.5 text-[12px] text-[#5E5347] md:inline-flex"
            title={vaaniReady ? "Webhook secret and API key configured" : "Set VAANI_WEBHOOK_SECRET in .env.local"}
          >
            <span className={cx("h-2 w-2 rounded-full", vaaniReady ? "bg-[#5C8A66]" : "bg-[#C49447]")} />
            Vaani · {vaaniReady ? "webhook ready" : "awaiting setup"}
          </span>
          <span className="hidden items-center gap-2 rounded-full border border-[#E3DACD] bg-white px-3 py-1.5 text-[12px] text-[#5E5347] sm:inline-flex">
            <span className={cx("h-2 w-2 rounded-full", integrations.hubspot.connected ? "bg-[#5C8A66]" : "bg-[#C4B9AB]")} />
            HubSpot · {integrations.hubspot.connected ? "connected" : "not connected"}
          </span>
          {integrations.hubspot.connected && pendingCount > 0 && (
            <button
              onClick={onPushAll}
              disabled={bulkSyncing}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#2A241E] px-3 py-1.5 text-[12px] font-medium text-[#F6F1E9] transition hover:bg-[#3A3129] disabled:opacity-60"
            >
              {bulkSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Push {pendingCount} to HubSpot
            </button>
          )}
        </div>
      )}
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sidebar
 * ──────────────────────────────────────────────────────────────────────────── */

function CallListItem({ call, selected, onSelect }: { call: CallView; selected: boolean; onSelect: () => void }) {
  const name = displayName(call);
  return (
    <button
      onClick={onSelect}
      className={cx(
        "group relative w-full rounded-2xl px-4 py-3.5 text-left transition-all duration-200",
        selected
          ? "bg-white shadow-[0_1px_2px_rgba(42,36,30,0.05),0_10px_28px_-14px_rgba(42,36,30,0.25)] ring-1 ring-[#E3D9CB]"
          : "hover:bg-white/60",
      )}
    >
      {selected && <span className="absolute bottom-4 left-0 top-4 w-[3px] rounded-r-full bg-[#9C6B43]" />}
      <div className="flex items-start gap-3">
        <div
          className={cx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors",
            selected ? "bg-[#2A241E] text-[#F3E9DA]" : "bg-[#EFE8DE] text-[#6B5B4B]",
          )}
        >
          {call.qualification === "Missed" ? (
            <PhoneMissed className="h-4 w-4" />
          ) : call.callerName ? (
            initials(name)
          ) : (
            <User className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cx("truncate text-[14px] font-semibold", call.callerName ? "text-[#211C17]" : "text-[#7D7266]")}>{name}</p>
            <span className="shrink-0 text-[11px] tabular-nums text-[#9A8F82]">
              {formatDay(call.receivedAt)} · {formatTime(call.receivedAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[#8A7F72]">
            <span className="truncate">{call.dossier.location.value}</span>
            <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-[#C4B9AB]" />
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3" />
              {call.durationSec ? formatClock(call.durationSec) : "—"}
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <QualificationBadge value={call.qualification} />
            {call.afterHours && <AfterHoursTag />}
          </div>
        </div>
      </div>
    </button>
  );
}

function Sidebar({
  calls,
  allCalls,
  selectedId,
  query,
  tab,
  onQuery,
  onTab,
  onSelect,
  className,
}: {
  calls: CallView[];
  allCalls: CallView[];
  selectedId: string | null;
  query: string;
  tab: FilterTab;
  onQuery: (q: string) => void;
  onTab: (t: FilterTab) => void;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const counts: Record<FilterTab, number> = {
    all: allCalls.length,
    qualified: allCalls.filter((c) => c.qualification === "Qualified").length,
    "after-hours": allCalls.filter((c) => c.afterHours).length,
  };
  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All Calls" },
    { key: "qualified", label: "Qualified" },
    { key: "after-hours", label: "After-Hours" },
  ];
  const qualifiedShare = Math.round((counts.qualified / Math.max(1, counts.all)) * 100);

  return (
    <aside className={cx("min-h-0 flex-col border-r border-[#E8E1D6] bg-[#F3EFE8]", className)}>
      <div className="space-y-4 px-5 pb-4 pt-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9A8F82]">Inbound queue</p>
            <h2 className="font-display mt-1 text-[26px] leading-none text-[#211C17]">Calls</h2>
          </div>
          <div className="text-right">
            <p className="font-display text-[22px] leading-none text-[#9C6B43]">{qualifiedShare}%</p>
            <p className="mt-1 text-[11px] text-[#9A8F82]">qualified for a designer</p>
          </div>
        </div>

        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A59A8C]" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search name, locality, scope…"
            className="h-10 w-full rounded-xl border border-[#E3DACD] bg-white/80 pl-10 pr-3 text-[13px] text-[#211C17] outline-none transition placeholder:text-[#ADA293] focus:border-[#C9A57F] focus:bg-white focus:ring-4 focus:ring-[#C9A57F]/15"
          />
        </label>

        <div className="flex rounded-xl bg-[#E9E2D7]/70 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onTab(t.key)}
              className={cx(
                "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[12px] font-medium transition-all",
                tab === t.key ? "bg-white text-[#211C17] shadow-sm" : "text-[#7D7266] hover:text-[#211C17]",
              )}
            >
              {t.label}
              <span
                className={cx(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  tab === t.key ? "bg-[#F3E9DA] text-[#8A5D38]" : "bg-[#DDD4C6]/70 text-[#7D7266]",
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-soft min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-6">
        {calls.length === 0 ? (
          <div className="mx-2 mt-6 rounded-2xl border border-dashed border-[#DCD2C4] px-5 py-10 text-center">
            <Search className="mx-auto h-5 w-5 text-[#B3A899]" />
            <p className="mt-3 text-[13px] font-medium text-[#5E5347]">No calls match</p>
            <p className="mt-1 text-[12px] text-[#9A8F82]">Try a different name, locality or scope.</p>
          </div>
        ) : (
          calls.map((c) => <CallListItem key={c.id} call={c} selected={c.id === selectedId} onSelect={() => onSelect(c.id)} />)
        )}
      </div>
    </aside>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Recording / transcript timeline
 * ──────────────────────────────────────────────────────────────────────────── */

function AudioPlayer({
  call,
  currentTime,
  isPlaying,
  rate,
  onToggle,
  onSeek,
  onRate,
}: {
  call: CallView;
  currentTime: number;
  isPlaying: boolean;
  rate: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onRate: () => void;
}) {
  const bars = useMemo(() => buildWaveform(call.id, 96), [call.id]);
  const progress = currentTime / call.durationSec;
  const g = call.guardrail;
  const markerPct = g.triggered && g.time !== undefined ? g.time / call.durationSec : null;
  const hasAudio = Boolean(call.recordingUrl);

  return (
    <Card className="px-5 py-4 sm:px-6">
      <div className="flex items-center gap-4 sm:gap-5">
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => onSeek(currentTime - 10)}
            aria-label="Back 10 seconds"
            className="hidden h-9 w-9 items-center justify-center rounded-full text-[#7D7266] transition hover:bg-[#F3EDE4] hover:text-[#211C17] sm:flex"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            onClick={onToggle}
            aria-label={isPlaying ? "Pause" : "Play"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2A241E] text-[#F6F1E9] shadow-[0_8px_20px_-8px_rgba(42,36,30,0.6)] transition hover:scale-[1.04] active:scale-95"
          >
            {isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="ml-0.5 h-5 w-5" fill="currentColor" />}
          </button>
          <button
            onClick={() => onSeek(currentTime + 10)}
            aria-label="Forward 10 seconds"
            className="hidden h-9 w-9 items-center justify-center rounded-full text-[#7D7266] transition hover:bg-[#F3EDE4] hover:text-[#211C17] sm:flex"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[#9A8F82]">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium uppercase tracking-[0.12em]">
              <Volume2 className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden truncate sm:inline">{hasAudio ? "Call recording" : "Transcript replay · timings estimated"}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="text-[#211C17]">{formatClock(currentTime)}</span> / {formatClock(call.durationSec)}
            </span>
          </div>
          <div className="relative h-11">
            <div className="absolute inset-0 flex items-center gap-px sm:gap-[2px]">
              {bars.map((h, i) => (
                <span
                  key={i}
                  className={cx(
                    "flex-1 rounded-full transition-colors duration-150",
                    i % 2 === 1 && "hidden sm:block",
                    i / bars.length < progress ? "bg-[#9C6B43]" : "bg-[#E6DED2]",
                  )}
                  style={{ height: `${h * 100}%` }}
                />
              ))}
            </div>
            {markerPct !== null && (
              <span
                className={cx("pointer-events-none absolute -top-1 h-[calc(100%+8px)] w-px", g.breached ? "bg-[#C0473A]" : "bg-[#C99547]")}
                style={{ left: `${markerPct * 100}%` }}
              >
                <span
                  className={cx(
                    "absolute -left-[5px] -top-1 h-2.5 w-2.5 rounded-full border-2 border-white",
                    g.breached ? "bg-[#C0473A]" : "bg-[#C99547]",
                  )}
                />
              </span>
            )}
            <input
              type="range"
              min={0}
              max={call.durationSec}
              step={0.5}
              value={currentTime}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Seek"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
        </div>

        <button
          onClick={onRate}
          aria-label="Change playback speed"
          className="shrink-0 rounded-lg border border-[#E3DACD] px-2.5 py-1.5 text-[12px] font-semibold tabular-nums text-[#5E5347] transition hover:border-[#C9A57F] hover:text-[#211C17]"
        >
          {rate}×
        </button>
      </div>
      {(markerPct !== null || !hasAudio) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#9A8F82] sm:pl-[152px]">
          {markerPct !== null && (
            <span className="inline-flex items-center gap-1.5">
              <span className={cx("h-1.5 w-1.5 rounded-full", g.breached ? "bg-[#C0473A]" : "bg-[#C99547]")} />
              Pricing question answered here
            </span>
          )}
          {!hasAudio && <span>No recording on file — the transcript replays at reading pace.</span>}
        </p>
      )}
    </Card>
  );
}

function MissedCallCard({ call }: { call: CallView }) {
  return (
    <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F1ECE4]">
        <PhoneMissed className="h-5 w-5 text-[#8A7F72]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[19px] text-[#211C17]">Missed at {formatTime(call.receivedAt)} — no recording, no transcript</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[#7D7266]">
          This call came in before Vaani was answering after hours. Calls like this are the gap the voice agent closes.
        </p>
      </div>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Lead dossier (left column)
 * ──────────────────────────────────────────────────────────────────────────── */

function CutBanner({ guardrail, agent, onJump }: { guardrail: PricingGuardrail; agent: string; onJump: (t: number) => void }) {
  if (!guardrail.triggered) {
    return (
      <div className="flex items-center gap-3 rounded-[20px] border border-dashed border-[#DCD2C4] bg-white/50 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F1ECE4]">
          <ShieldCheck className="h-4 w-4 text-[#A59A8C]" />
        </div>
        <div>
          <p className="text-[13px] font-medium text-[#5E5347]">The Cut · not triggered</p>
          <p className="text-[12px] text-[#9A8F82]">The caller didn't ask about pricing on this call.</p>
        </div>
      </div>
    );
  }

  const breached = guardrail.breached;
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-[20px] p-5 text-[#F6EEE2] shadow-[0_18px_40px_-20px_rgba(42,30,20,0.7)]",
        breached ? "bg-gradient-to-br from-[#4A1D17] via-[#5E2A20] to-[#76362A]" : "bg-gradient-to-br from-[#2A211A] via-[#3A2B20] to-[#4E3726]",
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full border border-[#E0B872]/15" />
      <div className="pointer-events-none absolute -right-2 -top-8 h-28 w-28 rounded-full border border-[#E0B872]/20" />
      <div className="relative flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#E0B872]/15 ring-1 ring-[#E0B872]/30">
          {breached ? <ShieldAlert className="h-5 w-5 text-[#F2B4A6]" /> : <ShieldCheck className="h-5 w-5 text-[#E8C489]" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-[19px] leading-tight">The Cut</p>
            <span
              className={cx(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                breached ? "bg-[#F2B4A6]/20 text-[#F6C7BC]" : "bg-[#E0B872]/20 text-[#EBCB94]",
              )}
            >
              {breached ? "Figure quoted — review" : "Policy held"}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#D9CBB8]">
            {breached
              ? `${agent} appears to have shared a number. Pricing is indicative and must only come from the designer after site measurement.`
              : `${agent} declined to quote a number. Pricing is indicative until a designer measures the site.`}
          </p>
          {guardrail.callerAsk && (
            <p className="mt-3 text-[12px] text-[#BCA88F]">
              <span className="font-medium text-[#D9CBB8]">Caller asked:</span> “{guardrail.callerAsk}”
            </p>
          )}
          {guardrail.agentResponse && (
            <blockquote className="mt-2 border-l-2 border-[#E0B872]/50 pl-3">
              <p className="font-display text-[14px] italic leading-snug text-[#F6EEE2]">“{guardrail.agentResponse}”</p>
            </blockquote>
          )}
          {guardrail.time !== undefined && (
            <button
              onClick={() => onJump(guardrail.time as number)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#F6EEE2] px-3 py-1.5 text-[12px] font-semibold text-[#2A211A] transition hover:bg-white"
            >
              <Play className="h-3 w-3" fill="currentColor" /> Replay · {formatClock(guardrail.time)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EscalationBanner({ call }: { call: CallView }) {
  return (
    <div className="flex items-start gap-4 rounded-[20px] border border-[#EBB9AE] bg-[#FBEDEA] p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#C0473A] text-white">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <p className="font-display text-[19px] leading-tight text-[#5E1F16]">Existing client — escalate now</p>
        <p className="mt-1 text-[13px] leading-relaxed text-[#8E2F22]">{call.qualificationReason}.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {call.flags.map((f) => (
            <span key={f} className="rounded-full bg-white px-2.5 py-1 text-[12px] font-medium text-[#8E2F22] ring-1 ring-[#EBB9AE]">
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function EntityCard({ label, icon: Icon, entity, wide }: { label: string; icon: LucideIcon; entity: DossierEntity; wide?: boolean }) {
  const missing = NOT_CAPTURED.test(entity.value);
  return (
    <div
      className={cx(
        "rounded-2xl border p-4 transition",
        missing ? "border-dashed border-[#E6DFD4] bg-transparent" : "border-[#EEE7DC] bg-[#FBF9F5] hover:border-[#E0D3C1] hover:bg-white",
        wide && "col-span-2",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#8A7F72]">
        <Icon className="h-3.5 w-3.5 text-[#B08560]" strokeWidth={2} />
        {label}
      </span>
      <p
        className={cx(
          "font-display mt-2 leading-tight",
          wide ? "text-[22px]" : "text-[19px]",
          missing ? "text-[#B3A899]" : "text-[#211C17]",
        )}
      >
        {entity.value}
        {label === "Site Location" && !missing && !/nashik|nanded/i.test(entity.value) && <span className="text-[#A59A8C]">, Pune</span>}
      </p>
      {entity.note && <p className="mt-1 text-[12px] leading-snug text-[#8A7F72]">{entity.note}</p>}
    </div>
  );
}

function CriteriaCard({ call }: { call: CallView }) {
  const passed = CRITERIA.filter((c) => call.criteria[c.key].status === "pass").length;
  return (
    <Card className="p-5 sm:p-6">
      <SectionLabel icon={ListChecks} right={<span className="text-[11px] tabular-nums text-[#8A7F72]">{passed}/5 clear passes</span>}>
        Nikhil&apos;s 5 Criteria
      </SectionLabel>
      <ul className="mt-4 divide-y divide-[#F0EAE0]">
        {CRITERIA.map(({ key, label }) => {
          const r = call.criteria[key];
          const s = CRITERION_STYLE[r.status];
          const Icon = s.icon;
          return (
            <li key={key} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", s.tone)} title={s.label}>
                <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[#2E2721]">{label}</p>
                <p className="text-[12px] text-[#8A7F72]">{r.note}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 rounded-xl bg-[#F7F3EE] px-3 py-2 text-[11.5px] leading-relaxed text-[#7D7266]">
        Unclear on budget or decision-maker still forwards to a designer, with the uncertainty noted.
      </p>
    </Card>
  );
}

function DossierPanel({ call, onJump }: { call: CallView; onJump: (t: number) => void }) {
  const [copied, setCopied] = useState(false);
  const { dossier } = call;

  useEffect(() => setCopied(false), [call.id]);

  const copySummary = () => {
    navigator.clipboard?.writeText(dossier.summary).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-5">
      {call.qualification === "Escalation" ? (
        <EscalationBanner call={call} />
      ) : (
        call.qualification !== "Missed" && <CutBanner guardrail={call.guardrail} agent={call.handledBy} onJump={onJump} />
      )}

      <Card className="p-5 sm:p-6">
        <SectionLabel icon={Sparkles} right={
          <button
            onClick={copySummary}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#8A7F72] transition hover:bg-[#F3EDE4] hover:text-[#211C17]"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        }>
          Context Summary
        </SectionLabel>
        <div className="relative mt-4">
          <Quote className="absolute -left-0.5 -top-1 h-5 w-5 text-[#E8DCCB]" fill="currentColor" strokeWidth={0} />
          <p className="pl-7 text-[14px] leading-[1.7] text-[#3D352D]">{dossier.summary}</p>
        </div>
        {dossier.knownContext.length > 0 && (
          <div className="mt-5 border-t border-[#F0EAE0] pt-4">
            <p className="text-[11px] font-medium text-[#8A7F72]">Already captured — no need to re-ask</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {dossier.knownContext.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[#F6F0E7] px-2.5 py-1 text-[12px] text-[#6B5B4B]">
                  <Check className="h-3 w-3 text-[#9C6B43]" />
                  {k}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionLabel icon={Home} right={<span className="text-[11px] capitalize text-[#A59A8C]">{dossier.segment}</span>}>
          Lead Dossier
        </SectionLabel>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {ENTITY_FIELDS.map((f) => (
            <EntityCard key={f.key} label={f.label} icon={f.icon} entity={dossier[f.key]} wide={f.wide} />
          ))}
        </div>
      </Card>

      {!UNASSESSED.includes(call.qualification) && <CriteriaCard call={call} />}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transcript & outputs (right column)
 * ──────────────────────────────────────────────────────────────────────────── */

function TranscriptPanel({
  call,
  currentTime,
  isPlaying,
  onSeek,
}: {
  call: CallView;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (t: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const started = currentTime > 0 || isPlaying;
  const agentLabel = call.handledBy === "Vaani" ? "Agent (Vaani)" : "Front Desk";
  const guardrailTime = call.guardrail.triggered ? call.guardrail.time : undefined;

  let activeIndex = -1;
  if (started) {
    call.transcript.forEach((t, i) => {
      if (t.time <= currentTime) activeIndex = i;
    });
  }
  const activeId = activeIndex >= 0 ? call.transcript[activeIndex].id : null;

  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [call.id]);

  useEffect(() => {
    const container = containerRef.current;
    const el = activeId ? itemRefs.current[activeId] : null;
    if (!container || !el) return;
    container.scrollTo({ top: el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [activeId]);

  return (
    <Card className="flex flex-col">
      <div className="px-5 pt-5 sm:px-6">
        <SectionLabel
          icon={PhoneIncoming}
          right={
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#A59A8C]">
              <span className={cx("h-1.5 w-1.5 rounded-full", isPlaying ? "animate-pulse bg-[#9C6B43]" : "bg-[#D4CABD]")} />
              {isPlaying ? "Following playback" : "Tap a line to jump"}
            </span>
          }
        >
          Synchronized Transcript
        </SectionLabel>
      </div>
      <div ref={containerRef} className="scroll-soft relative mt-3 max-h-[520px] space-y-3 overflow-y-auto px-5 pb-6 pt-1 sm:px-6">
        {call.transcript.map((item, i) => {
          const agent = item.speaker === "agent";
          const active = item.id === activeId;
          const future = started && i > activeIndex;
          const isCut = agent && item.time === guardrailTime;
          return (
            <div
              key={item.id}
              ref={(el) => {
                itemRefs.current[item.id] = el;
              }}
              className={cx("flex gap-2.5 transition-opacity duration-300", agent ? "justify-start" : "flex-row-reverse", future && "opacity-45")}
            >
              <div
                className={cx(
                  "mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  agent ? "bg-[#F3E9DA] text-[#8A5D38]" : "bg-[#EAE4DB] text-[#5E5347]",
                )}
              >
                {agent ? call.handledBy === "Vaani" ? <Bot className="h-3.5 w-3.5" /> : <Headset className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
              </div>
              <div className={cx("flex max-w-[82%] flex-col", agent ? "items-start" : "items-end")}>
                <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-[#A59A8C]">
                  <span className="font-medium text-[#7D7266]">{agent ? agentLabel : "Caller"}</span>
                  <span className="tabular-nums">{formatClock(item.time)}</span>
                </div>
                <button
                  onClick={() => onSeek(item.time)}
                  className={cx(
                    "rounded-2xl px-4 py-2.5 text-left text-[13.5px] leading-relaxed transition-all duration-200",
                    agent ? "rounded-tl-md text-[#2E2721]" : "rounded-tr-md bg-[#2A241E] text-[#F3ECE1]",
                    agent &&
                      (isCut
                        ? call.guardrail.breached
                          ? "bg-[#FBEDEA] ring-1 ring-[#E3A396]"
                          : "bg-[#FBF2E2] ring-1 ring-[#D9AE6A]"
                        : "bg-[#F5F0E8]"),
                    active && (agent ? "ring-2 ring-[#9C6B43]/60" : "ring-2 ring-[#C9A57F] ring-offset-2 ring-offset-white"),
                  )}
                >
                  {item.text}
                </button>
                {(isCut || item.extracted) && (
                  <div className={cx("mt-1.5 flex flex-wrap gap-1 px-1", agent ? "justify-start" : "justify-end")}>
                    {isCut && (
                      <span
                        className={cx(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          call.guardrail.breached ? "bg-[#8E2F22] text-white" : "bg-[#2A211A] text-[#EBCB94]",
                        )}
                      >
                        <ShieldCheck className="h-3 w-3" /> The Cut
                      </span>
                    )}
                    {item.extracted?.map((e) => (
                      <span key={e} className="rounded-full border border-[#EADFCF] bg-white px-2 py-0.5 text-[10px] font-medium text-[#9C6B43]">
                        ↳ {e}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function OutputsTracker({
  outputs,
  hubspotBusy,
  onPushHubSpot,
}: {
  outputs: AutomationOutput[];
  hubspotBusy: boolean;
  onPushHubSpot: () => void;
}) {
  const shown = outputs.map((o) => (o.key === "hubspot" && hubspotBusy ? { ...o, status: "syncing" as OutputStatus, detail: "Pushing contact + deal…" } : o));
  const delivered = shown.filter((o) => o.status === "delivered").length;
  const applicable = shown.filter((o) => o.status !== "skipped").length;

  return (
    <Card className="p-5 sm:p-6">
      <SectionLabel
        icon={ArrowUpRight}
        right={
          <span className="text-[11px] tabular-nums text-[#8A7F72]">
            <span className="font-semibold text-[#211C17]">{delivered}</span> / {applicable} delivered
          </span>
        }
      >
        Automation Outputs
      </SectionLabel>

      <div className="mt-3 flex gap-1">
        {shown.map((o) => (
          <span
            key={o.key}
            className={cx(
              "h-1 flex-1 rounded-full transition-colors duration-500",
              o.status === "delivered" && "bg-[#5C8A66]",
              o.status === "pending" && "bg-[#D2A85E]",
              o.status === "syncing" && "animate-pulse bg-[#C9BBA8]",
              o.status === "failed" && "bg-[#C0473A]",
              (o.status === "skipped" || o.status === "not-connected") && "bg-[#ECE6DD]",
            )}
          />
        ))}
      </div>

      <ol className="mt-5 space-y-2.5">
        {shown.map((o, i) => {
          const cfg = OUTPUT_CONFIG[o.key];
          const st = STATUS_STYLE[o.status];
          const StatusIcon = st.icon;
          const Icon = cfg.icon;
          const muted = o.status === "skipped" || o.status === "not-connected";
          const canPush = o.key === "hubspot" && (o.status === "pending" || o.status === "failed" || o.status === "delivered");
          return (
            <li
              key={o.key}
              className={cx(
                "rounded-2xl border p-4 transition-colors",
                muted ? "border-dashed border-[#E6DFD4] bg-transparent" : "border-[#EEE7DC] bg-[#FBF9F5]",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    muted ? "bg-[#F3EFE9] text-[#B3A899]" : "bg-white text-[#9C6B43] ring-1 ring-[#EADFCF]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className={cx("text-[13.5px] font-semibold", muted ? "text-[#8A7F72]" : "text-[#211C17]")}>
                        <span className="mr-1.5 tabular-nums text-[#B3A899]">0{i + 1}</span>
                        {cfg.title}
                      </p>
                      <p className="text-[11px] text-[#9A8F82]">{cfg.audience}</p>
                    </div>
                    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", st.pill)}>
                      <StatusIcon className={cx("h-3 w-3", st.spin && "animate-spin")} strokeWidth={2.4} />
                      {st.label}
                    </span>
                  </div>
                  <p className={cx("mt-2 text-[12.5px] leading-snug", o.status === "failed" ? "text-[#8E2F22]" : "text-[#5E5347]")}>{o.detail}</p>
                  {o.meta && (
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-white p-3 ring-1 ring-[#F0EAE0]">
                      {o.meta.map((m) => (
                        <div key={m.label} className="min-w-0">
                          <dt className="text-[10px] uppercase tracking-[0.1em] text-[#A59A8C]">{m.label}</dt>
                          <dd className="truncate text-[12.5px] font-semibold tabular-nums text-[#2E2721]">{m.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {(o.at || canPush || o.link) && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                      {o.at && <span className="text-[11px] text-[#A59A8C]">{o.at}</span>}
                      {o.link && (
                        <a
                          href={o.link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-[#9C6B43] hover:text-[#7A4F2E]"
                        >
                          Open deal <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {canPush && (
                        <button
                          onClick={onPushHubSpot}
                          className={cx(
                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition",
                            o.status === "delivered"
                              ? "text-[#7D7266] hover:bg-[#F3EDE4] hover:text-[#211C17]"
                              : "bg-[#2A241E] text-[#F6F1E9] hover:bg-[#3A3129]",
                          )}
                        >
                          <Upload className="h-3 w-3" />
                          {o.status === "delivered" ? "Re-sync" : o.status === "failed" ? "Retry push" : "Push to HubSpot"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Designer assignment
 * ──────────────────────────────────────────────────────────────────────────── */

function DesignerSelect({
  designers,
  value,
  busy,
  onChange,
}: {
  designers: Designer[];
  value: string | null;
  busy: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const current = designers.find((d) => d.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = filter.toLowerCase();
  const list = designers.filter((d) => d.name.toLowerCase().includes(q) || d.specialty.toLowerCase().includes(q));

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          setFilter("");
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl border border-[#E3DACD] bg-white py-1.5 pl-1.5 pr-3 text-left transition hover:border-[#C9A57F] sm:w-[248px]"
      >
        <span
          className={cx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold",
            current ? "bg-[#F3E9DA] text-[#8A5D38]" : "border border-dashed border-[#D4CABD] text-[#B3A899]",
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : current ? initials(current.name) : <User className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-[0.12em] text-[#A59A8C]">{current ? "Assigned designer" : "Assign designer"}</span>
          <span className={cx("block truncate text-[13px] font-medium", current ? "text-[#211C17]" : "text-[#8A7F72]")}>
            {current ? current.name : "Unassigned"}
          </span>
        </span>
        <ChevronDown className={cx("h-4 w-4 text-[#A59A8C] transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[#E8E1D6] bg-white shadow-[0_24px_60px_-20px_rgba(42,36,30,0.35)]">
          <div className="border-b border-[#F0EAE0] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A59A8C]" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Search ${designers.length} designers…`}
                className="h-9 w-full rounded-lg bg-[#F7F3EE] pl-8 pr-3 text-[13px] outline-none placeholder:text-[#ADA293] focus:ring-2 focus:ring-[#C9A57F]/30"
              />
            </div>
          </div>
          <ul role="listbox" className="scroll-soft max-h-[320px] overflow-y-auto p-1.5">
            {list.map((d) => {
              const selected = d.id === value;
              return (
                <li key={d.id}>
                  <button
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(d.id);
                      setOpen(false);
                    }}
                    className={cx("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition", selected ? "bg-[#F6F0E7]" : "hover:bg-[#FAF7F2]")}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1EBE2] text-[11px] font-semibold text-[#6B5B4B]">
                      {initials(d.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[#211C17]">{d.name}</span>
                      <span className="block truncate text-[11px] text-[#9A8F82]">{d.specialty}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-[#9C6B43]" />}
                  </button>
                </li>
              );
            })}
            {list.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-[#9A8F82]">No designer found</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Page
 * ──────────────────────────────────────────────────────────────────────────── */

const RATES = [1, 1.5, 2];

export default function CallConsolePage() {
  const [calls, setCalls] = useState<CallView[]>([]);
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [busy, setBusy] = useState<{ hubspot: Set<string>; assign: Set<string>; bulk: boolean }>({
    hubspot: new Set(),
    assign: new Set(),
    bulk: false,
  });
  const [toast, setToast] = useState<{ id: number; message: string; tone: "ok" | "error" } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const notify = useCallback((message: string, tone: "ok" | "error" = "ok") => setToast({ id: Date.now(), message, tone }), []);

  useEffect(() => {
    api<CallsResponse>("/api/calls")
      .then((data) => {
        setCalls(data.calls);
        setDesigners(data.designers);
        setIntegrations(data.integrations);
        setSelectedId((id) => id ?? data.calls.find((c) => c.qualification === "Qualified")?.id ?? data.calls[0]?.id ?? null);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const selected = calls.find((c) => c.id === selectedId) ?? null;
  const duration = selected?.durationSec ?? 0;
  const hasAudio = Boolean(selected?.recordingUrl);

  const visibleCalls = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter((c) => {
      if (tab === "qualified" && c.qualification !== "Qualified") return false;
      if (tab === "after-hours" && !c.afterHours) return false;
      if (!q) return true;
      return [c.callerName, c.phone, c.dossier.location.value, c.dossier.propertyScope.value, c.reference]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [calls, query, tab]);

  const pendingHubSpot = calls.filter((c) => c.outputs.some((o) => o.key === "hubspot" && (o.status === "pending" || o.status === "failed"))).length;

  // Transcript replay clock (only when there's no real recording to follow).
  useEffect(() => {
    if (!isPlaying || hasAudio) return;
    const id = window.setInterval(() => setCurrentTime((t) => t + 0.2 * rate), 200);
    return () => window.clearInterval(id);
  }, [isPlaying, rate, hasAudio]);

  useEffect(() => {
    if (!hasAudio && duration && currentTime >= duration) {
      setIsPlaying(false);
      setCurrentTime(duration);
    }
  }, [currentTime, duration, hasAudio]);

  // Real recording: drive the <audio> element and mirror its clock.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) return;
    audio.playbackRate = rate;
    if (isPlaying) audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [isPlaying, rate, hasAudio, selectedId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const togglePlay = useCallback(() => {
    if (!isPlaying && duration && currentTime >= duration) setCurrentTime(0);
    setIsPlaying((p) => !p);
  }, [isPlaying, currentTime, duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.code !== "Space" || tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || !selected?.transcript.length) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, selected]);

  function selectCall(id: string) {
    setSelectedId(id);
    setCurrentTime(0);
    setIsPlaying(false);
    setMobileDetail(true);
  }

  function seek(t: number) {
    const next = Math.max(0, Math.min(duration, t));
    setCurrentTime(next);
    if (audioRef.current && hasAudio) audioRef.current.currentTime = next;
  }

  function jumpAndPlay(t: number) {
    seek(t);
    setIsPlaying(true);
  }

  function mergeCalls(updated: CallView[]) {
    const byId = new Map(updated.map((c) => [c.id, c]));
    setCalls((cs) => cs.map((c) => byId.get(c.id) ?? c));
  }

  function setBusyFlag(kind: "hubspot" | "assign", id: string, on: boolean) {
    setBusy((b) => {
      const next = new Set(b[kind]);
      if (on) next.add(id);
      else next.delete(id);
      return { ...b, [kind]: next };
    });
  }

  async function assign(callId: string, designerId: string) {
    setBusyFlag("assign", callId, true);
    try {
      const { call } = await api<{ call: CallView }>(`/api/calls/${callId}/assign`, { designerId });
      mergeCalls([call]);
      notify(`${designers.find((d) => d.id === designerId)?.name ?? "Designer"} assigned`);
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusyFlag("assign", callId, false);
    }
  }

  async function pushHubSpot(callId: string) {
    setBusyFlag("hubspot", callId, true);
    try {
      const res = await api<{ synced: number; calls: CallView[] }>("/api/hubspot/sync", { callId });
      mergeCalls(res.calls);
      if (res.synced) notify("Pushed to HubSpot");
      else notify(res.calls[0]?.hubspot?.error ?? "HubSpot push failed", "error");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusyFlag("hubspot", callId, false);
    }
  }

  async function pushAll() {
    setBusy((b) => ({ ...b, bulk: true }));
    try {
      const res = await api<{ synced: number; failed: number; calls: CallView[] }>("/api/hubspot/sync", { all: true });
      mergeCalls(res.calls);
      notify(`${res.synced} lead${res.synced === 1 ? "" : "s"} pushed${res.failed ? ` · ${res.failed} failed` : ""}`, res.failed ? "error" : "ok");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy((b) => ({ ...b, bulk: false }));
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[#F7F4EF] text-[#211C17]">
      <TopBar integrations={integrations} pendingCount={pendingHubSpot} bulkSyncing={busy.bulk} onPushAll={pushAll} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          calls={visibleCalls}
          allCalls={calls}
          selectedId={selectedId}
          query={query}
          tab={tab}
          onQuery={setQuery}
          onTab={setTab}
          onSelect={selectCall}
          className={cx("w-full lg:w-[372px] lg:shrink-0", mobileDetail ? "hidden lg:flex" : "flex")}
        />

        <main className={cx("scroll-soft min-w-0 flex-1 overflow-y-auto", mobileDetail ? "block" : "hidden lg:block")}>
          {loadError ? (
            <div className="mx-auto mt-24 max-w-md px-6 text-center">
              <AlertTriangle className="mx-auto h-6 w-6 text-[#C0473A]" />
              <p className="font-display mt-3 text-[22px]">Couldn&apos;t load calls</p>
              <p className="mt-1 text-[13px] text-[#7D7266]">{loadError}</p>
            </div>
          ) : !selected ? (
            <div className="flex h-full items-center justify-center text-[13px] text-[#9A8F82]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading calls…
            </div>
          ) : (
            <div className="mx-auto max-w-[1360px] space-y-5 px-4 py-6 sm:px-8 sm:py-8">
              <button onClick={() => setMobileDetail(false)} className="-ml-1 inline-flex items-center gap-1 text-[13px] font-medium text-[#7D7266] lg:hidden">
                <ChevronLeft className="h-4 w-4" /> All calls
              </button>

              {/* Call header */}
              <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#9A8F82]">
                    <span className="font-mono tracking-wide">{selected.reference}</span>
                    <span className="h-0.5 w-0.5 rounded-full bg-[#C4B9AB]" />
                    <span>
                      {formatDay(selected.receivedAt)} · {formatTime(selected.receivedAt)} IST
                    </span>
                    {selected.durationSec > 0 && (
                      <>
                        <span className="h-0.5 w-0.5 rounded-full bg-[#C4B9AB]" />
                        <span className="tabular-nums">{formatClock(selected.durationSec)}</span>
                      </>
                    )}
                    <span className="h-0.5 w-0.5 rounded-full bg-[#C4B9AB]" />
                    <span className="inline-flex items-center gap-1">
                      {selected.handledBy === "Vaani" ? <Bot className="h-3 w-3" /> : <Headset className="h-3 w-3" />}
                      {selected.handledBy === "Vaani" ? "Answered by Vaani" : "Front desk · Sept baseline"}
                    </span>
                  </div>
                  <h1 className={cx("font-display mt-2 text-[34px] leading-[1.05] sm:text-[40px]", selected.callerName ? "text-[#211C17]" : "text-[#7D7266]")}>
                    {displayName(selected)}
                  </h1>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <QualificationBadge value={selected.qualification} size="md" />
                    {selected.afterHours && <AfterHoursTag />}
                    <span className="text-[12px] text-[#8A7F72]">{selected.qualificationReason}</span>
                  </div>
                  {(selected.flags.length > 0 || selected.source) && selected.qualification !== "Escalation" && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {selected.flags.map((f) => (
                        <span key={f} className="inline-flex items-center gap-1 rounded-full border border-[#E6D3BC] bg-[#FBF5EC] px-2 py-0.5 text-[11px] font-medium text-[#8A5D38]">
                          <Flag className="h-3 w-3" />
                          {f}
                        </span>
                      ))}
                      {selected.source && <span className="text-[11px] text-[#9A8F82]">Source: {selected.source}</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <DesignerSelect
                    designers={designers}
                    value={selected.assignedDesignerId}
                    busy={busy.assign.has(selected.id)}
                    onChange={(id) => assign(selected.id, id)}
                  />
                  {selected.phone ? (
                    <a
                      href={`tel:${selected.phone.replace(/\s/g, "")}`}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2A241E] px-4 py-2.5 text-[13px] font-medium text-[#F6F1E9] transition hover:bg-[#3A3129] sm:w-[248px]"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call back {selected.phone}
                    </a>
                  ) : (
                    <span className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#DCD2C4] px-4 py-2.5 text-[12.5px] text-[#9A8F82] sm:w-[248px]">
                      <Phone className="h-3.5 w-3.5" />{" "}
                      {selected.handledBy === "Vaani" ? "No number — browser test call" : "Number redacted in source"}
                    </span>
                  )}
                  {selected.email && (
                    <span className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#E3DACD] bg-white px-4 py-2 text-[12.5px] text-[#5E5347] select-all sm:w-[248px]">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-[#9C6B43]" />
                      <span className="truncate">{selected.email}</span>
                    </span>
                  )}
                </div>
              </div>

              {selected.transcript.length > 0 ? (
                <AudioPlayer
                  call={selected}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  rate={rate}
                  onToggle={togglePlay}
                  onSeek={seek}
                  onRate={() => setRate((r) => RATES[(RATES.indexOf(r) + 1) % RATES.length])}
                />
              ) : (
                <MissedCallCard call={selected} />
              )}
              {selected.recordingUrl && (
                <audio
                  ref={audioRef}
                  key={selected.id}
                  src={selected.recordingUrl}
                  preload="metadata"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onEnded={() => setIsPlaying(false)}
                  className="hidden"
                />
              )}

              <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <DossierPanel call={selected} onJump={jumpAndPlay} />
                <div className="space-y-5">
                  {selected.transcript.length > 0 && (
                    <TranscriptPanel call={selected} currentTime={currentTime} isPlaying={isPlaying} onSeek={seek} />
                  )}
                  <OutputsTracker
                    outputs={selected.outputs}
                    hubspotBusy={busy.hubspot.has(selected.id) || (busy.bulk && selected.outputs.some((o) => o.key === "hubspot" && o.status === "pending"))}
                    onPushHubSpot={() => pushHubSpot(selected.id)}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div
          key={toast.id}
          role="status"
          className={cx(
            "fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full px-4 py-2.5 text-[13px] shadow-[0_20px_40px_-16px_rgba(42,36,30,0.6)]",
            toast.tone === "ok" ? "bg-[#2A241E] text-[#F6F1E9]" : "bg-[#8E2F22] text-white",
          )}
          style={{ animation: "toast-in 220ms ease-out both" }}
        >
          {toast.tone === "ok" ? <Check className="h-4 w-4 shrink-0 text-[#E0B872]" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span className="truncate">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
