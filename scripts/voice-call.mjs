// Gives a logged (text-only) call a voice recording with Indian-English neural voices:
// each transcript line is spoken (agent and caller in different voices), the clips are joined
// into one MP3, uploaded to Supabase Storage, and the transcript is re-timed to the audio.
// Needs edge-tts in .tools/tts-venv:  python -m venv .tools/tts-venv && .tools/tts-venv/Scripts/python -m pip install edge-tts
// Usage: node scripts/voice-call.mjs <callId> [agentVoice] [callerVoice]
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const [callId, agentVoice = "en-IN-PrabhatNeural", callerVoice = "en-IN-NeerjaNeural"] = process.argv.slice(2);
if (!callId) throw new Error("Usage: node scripts/voice-call.mjs <callId> [agentVoice] [callerVoice]");

const EDGE_TTS = fileURLToPath(new URL("../.tools/tts-venv/Scripts/edge-tts.exe", import.meta.url));
const SB = env.SUPABASE_URL.replace(/\/$/, "");
const KEY = env.SUPABASE_SECRET_KEY;
const sbHeaders = { apikey: KEY, ...(KEY.startsWith("eyJ") ? { Authorization: `Bearer ${KEY}` } : {}) };

// 1. Load the call.
const rows = await (await fetch(`${SB}/rest/v1/calls?id=eq.${encodeURIComponent(callId)}&select=data`, { headers: sbHeaders })).json();
const call = rows[0]?.data;
if (!call) throw new Error(`Call ${callId} not found in Supabase`);

// 2. Speak each line. edge-tts writes 24 kHz, 48 kbps mono MP3, so duration = bytes × 8 / 48000.
const dir = mkdtempSync(join(tmpdir(), "aangan-voice-"));
const clips = [];
let at = 0;
const transcript = call.transcript.map((t, i) => {
  const out = join(dir, `line-${i}.mp3`);
  const voice = t.speaker === "agent" ? agentVoice : callerVoice;
  const r = spawnSync(EDGE_TTS, ["--voice", voice, "--rate=+5%", "--text", t.text, "--write-media", out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`edge-tts failed on line ${i + 1}: ${r.stderr}`);
  const bytes = readFileSync(out);
  clips.push(bytes);
  const line = { ...t, time: Math.round(at * 10) / 10 };
  at += (statSync(out).size * 8) / 48000;
  process.stdout.write(`\r  spoken ${i + 1}/${call.transcript.length}`);
  return line;
});
process.stdout.write("\n");
const mp3 = Buffer.concat(clips);
const durationSec = Math.max(1, Math.round(at));

// 3. Upload to a public "recordings" bucket (created on first use; 409 if it exists).
await fetch(`${SB}/storage/v1/bucket`, {
  method: "POST",
  headers: { ...sbHeaders, "Content-Type": "application/json" },
  body: JSON.stringify({ id: "recordings", name: "recordings", public: true }),
});
const objectPath = `recordings/${encodeURIComponent(callId)}.mp3`;
const up = await fetch(`${SB}/storage/v1/object/${objectPath}`, {
  method: "POST",
  headers: { ...sbHeaders, "Content-Type": "audio/mpeg", "x-upsert": "true" },
  body: mp3,
});
if (!up.ok) throw new Error(`Upload failed ${up.status}: ${await up.text()}`);
const recordingUrl = `${SB}/storage/v1/object/public/${objectPath}?v=${Date.now()}`;

// 4. Save the recording link and re-timed transcript on the call.
const save = await fetch(`${SB}/rest/v1/calls?id=eq.${encodeURIComponent(callId)}`, {
  method: "PATCH",
  headers: { ...sbHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
  body: JSON.stringify({ data: { ...call, recordingUrl, transcript, durationSec }, updated_at: new Date().toISOString() }),
});
if (!save.ok) throw new Error(`Save failed ${save.status}: ${await save.text()}`);
console.log(`voiced ${callId}: ${transcript.length} lines, ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}, ${(mp3.length / 1024).toFixed(0)} KB`);
console.log(`agent: ${agentVoice} · caller: ${callerVoice}`);
console.log(`recording: ${recordingUrl}`);
