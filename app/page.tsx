'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript Interfaces
// ─────────────────────────────────────────────────────────────────────────────

interface ConfidenceMap {
  Advanced:     number;
  Intermediate: number;
  Beginner:     number;
}

interface PredictionResult {
  tingkat_pengalaman: 'Advanced' | 'Intermediate' | 'Beginner';
  confidence:         ConfidenceMap;
  rekomendasi_pace:   string;
  estimasi_durasi:    string;
  total_detik:        number;
}

interface DebugInfo {
  rf_raw_detik:          number;
  physics_detik:         number;
  alpha_used:            number;
  pace_base_used:        number;
  training_dist_km_used: number;
  race_dist_km_used:     number;
}

interface ApiResponse {
  status:   'success' | 'error';
  hasil:    PredictionResult;
  debug:    DebugInfo;
  message?: string;
}

interface TrainingSession {
  jarakKm:   number;
  heartRate: number;
}

type WizardStep    = 1 | 2 | 3;
type RaceCategory  = '10K' | 'HALF' | 'FULL';
type FeedbackRating = 1 | 2 | 3 | 4 | 5;
type ActiveTab      = 'about' | 'eda' | 'preprocessing' | 'training' | 'evaluation' | 'simulator';

// ─────────────────────────────────────────────────────────────────────────────
// Static Configuration
// ─────────────────────────────────────────────────────────────────────────────

const RACE_CONFIG: Record<
  RaceCategory,
  { label: string; sublabel: string; jarakKm: number; cotDetik: number; cotLabel: string }
> = {
  '10K':  { label: '10K Race',      sublabel: '10.0 km', jarakKm: 10.0, cotDetik: 12600, cotLabel: '3:30:00' },
  'HALF': { label: 'Half Marathon', sublabel: '21.1 km', jarakKm: 21.1, cotDetik: 12600, cotLabel: '3:30:00' },
  'FULL': { label: 'Full Marathon', sublabel: '42.2 km', jarakKm: 42.2, cotDetik: 25200, cotLabel: '7:00:00' },
};

const KASTA_CONFIG: Record<
  'Advanced' | 'Intermediate' | 'Beginner',
  { text: string; bg: string; border: string; bar: string; dot: string; label: string }
> = {
  Advanced:     { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    bar: 'bg-rose-500',    dot: 'bg-rose-400',    label: 'Advanced'     },
  Intermediate: { text: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     bar: 'bg-sky-500',     dot: 'bg-sky-400',     label: 'Intermediate' },
  Beginner:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', bar: 'bg-emerald-500', dot: 'bg-emerald-400', label: 'Beginner'     },
};

const FEEDBACK_LABELS: Record<FeedbackRating, string> = {
  1: 'Tidak Akurat',
  2: 'Kurang Akurat',
  3: 'Cukup Akurat',
  4: 'Akurat',
  5: 'Sangat Akurat',
};

const DEFAULT_SESSIONS: [TrainingSession, TrainingSession, TrainingSession] = [
  { jarakKm: 5.0,  heartRate: 155 },
  { jarakKm: 7.0,  heartRate: 160 },
  { jarakKm: 10.0, heartRate: 158 },
];

const SESSION_ACCENT = 'rgb(251 146 60)';

// ─────────────────────────────────────────────────────────────────────────────
// Pure Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildTrackStyle(
  value: number,
  min:   number,
  max:   number,
  color  = 'rgb(20 184 166)'
): CSSProperties {
  const pct = ((value - min) / (max - min)) * 100;
  return {
    background: `linear-gradient(to right,
      ${color} 0%, ${color} ${pct}%,
      rgb(15 23 42) ${pct}%, rgb(15 23 42) 100%)`,
  };
}

function resolveWaktu(jam: number): { label: string; classes: string } {
  if (jam >= 5  && jam < 11) return { label: 'PAGI',  classes: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
  if (jam >= 11 && jam < 16) return { label: 'SIANG', classes: 'text-orange-400 bg-orange-500/10 border-orange-500/20' };
  return                             { label: 'MALAM', classes: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' };
}

function formatSeconds(totalSec: number): string {
  const abs = Math.abs(totalSec);
  const h   = Math.floor(abs / 3600);
  const m   = Math.floor((abs % 3600) / 60);
  const s   = Math.floor(abs % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Converts a float pace (minutes/km) to "M:SS" display string.
// e.g. 5.5 -> "5:30", 4.0833 -> "4:05"
function formatPace(paceFloat: number): string {
  const totalSec = Math.round(paceFloat * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Parses "M:SS /km" strings from backend back to float minutes for comparison.
function parsePaceToFloat(paceStr: string): number {
  const match = paceStr.match(/(\d+):(\d+)/);
  if (!match) return 0;
  return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
}

// Indonesian-style duration string matching backend _format_duration output.
function formatDurationIndo(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h   = Math.floor(sec / 3600);
  const m   = Math.floor((sec % 3600) / 60);
  const s   = sec % 60;
  if (h > 0) return `${h} jam ${m} menit ${s} detik`;
  return `${m} menit ${s} detik`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface SessionSliderRowProps {
  index:    number;
  session:  TrainingSession;
  locked:   boolean;
  onChange: (idx: number, field: keyof TrainingSession, val: number) => void;
}

function SessionSliderRow({ index, session, locked, onChange }: SessionSliderRowProps) {
  return (
    <div className={`bg-slate-950/60 border rounded-xl p-4 transition-opacity duration-300 ${
      locked ? 'border-orange-500/5 opacity-60' : 'border-orange-500/10'
    }`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-5 h-5 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-[9px] font-black text-orange-400 flex-shrink-0">
          {index + 1}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
          Sesi Latihan {index + 1}
        </span>
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-700">Jarak Latihan</span>
            <span className="text-base font-black tabular-nums text-orange-400 leading-none">
              {session.jarakKm.toFixed(1)}
              <span className="text-[10px] font-semibold text-slate-600 ml-1">km</span>
            </span>
          </div>
          <input
            type="range" min={1.0} max={30.0} step={0.5}
            value={session.jarakKm}
            disabled={locked}
            onChange={(e) => onChange(index, 'jarakKm', parseFloat(e.target.value))}
            style={buildTrackStyle(session.jarakKm, 1.0, 30.0, SESSION_ACCENT)}
            className="slider-session w-full h-[5px] rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[9px] text-slate-800 font-mono select-none">
            <span>1.0</span><span>15.5</span><span>30.0</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-700">Avg Heart Rate</span>
            <span className="text-base font-black tabular-nums text-slate-200 leading-none">
              {session.heartRate}
              <span className="text-[10px] font-semibold text-slate-600 ml-1">bpm</span>
            </span>
          </div>
          <input
            type="range" min={90} max={190} step={1}
            value={session.heartRate}
            disabled={locked}
            onChange={(e) => onChange(index, 'heartRate', parseInt(e.target.value))}
            style={buildTrackStyle(session.heartRate, 90, 190, SESSION_ACCENT)}
            className="slider-session w-full h-[5px] rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-[9px] text-slate-800 font-mono select-none">
            <span>90</span><span>140</span><span>190</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StepIndicatorProps { current: WizardStep; }

function StepIndicator({ current }: StepIndicatorProps) {
  const steps: { n: WizardStep; label: string }[] = [
    { n: 1, label: 'Profil Latihan'   },
    { n: 2, label: 'Parameter Lomba'  },
    { n: 3, label: 'Laporan Akhir'    },
  ];
  return (
    <div className="flex items-center gap-0 mb-10">
      {steps.map(({ n, label }, i) => {
        const done   = current > n;
        const active = current === n;
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border transition-all duration-300 ${
                done   ? 'bg-teal-500 border-teal-400 text-slate-950' :
                active ? 'bg-teal-500/15 border-teal-400/60 text-teal-300' :
                         'bg-slate-900 border-slate-800 text-slate-700'
              }`}>
                {done ? (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : n}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wider hidden sm:block transition-colors duration-300 ${
                active ? 'text-teal-400' : done ? 'text-slate-500' : 'text-slate-700'
              }`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-3 transition-colors duration-300 ${
                done ? 'bg-teal-500/40' : 'bg-slate-800'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RunPaceDashboard() {

  // ── Wizard state ─────────────────────────────────────────────────────────────
  const [step,          setStep]          = useState<WizardStep>(1);
  const [, setProfileLocked] = useState<boolean>(false);

  // ── Training inputs ──────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<[TrainingSession, TrainingSession, TrainingSession]>(
    DEFAULT_SESSIONS
  );

  // ── Race parameter inputs ────────────────────────────────────────────────────
  const [raceCategory, setRaceCategory] = useState<RaceCategory>('HALF');
  const [elevasiM,     setElevasiM]     = useState<number>(25);
  const [gender,       setGender]       = useState<'M' | 'F'>('M');
  const [jamLari,      setJamLari]      = useState<number>(6);

  // ── Prediction state ─────────────────────────────────────────────────────────
  const [hasil,    setHasil]    = useState<PredictionResult | null>(null);
  const [debug,    setDebug]    = useState<DebugInfo | null>(null);
  const [loading,  setLoading]  = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // ── Feedback state ───────────────────────────────────────────────────────────
  const [fbRating,    setFbRating]    = useState<FeedbackRating | null>(null);
  const [fbComment,   setFbComment]   = useState<string>('');
  const [fbSubmitted, setFbSubmitted] = useState<boolean>(false);

  // ── Target pace (frontend-only — never sent to backend) ──────────────────────
  const [targetPace, setTargetPace] = useState<number>(5.0);

  // ── Dashboard / Sidebar navigation state ─────────────────────────────────────
  const [activeTab,       setActiveTab]       = useState<ActiveTab>('about');
  const [unlockedTabs,    setUnlockedTabs]    = useState<Set<ActiveTab>>(new Set(['about']));
  const [edaFeature,      setEdaFeature]      = useState<'Distance' | 'ElapsedTime' | 'Elevation'>('Distance');
  const [edaChartType,    setEdaChartType]    = useState<'Histogram' | 'Boxplot'>('Histogram');
  const [ppTestSize,      setPpTestSize]      = useState<number>(20);
  const [ppRandomState,   setPpRandomState]   = useState<number>(42);
  const [ppScalingMethod, setPpScalingMethod] = useState<string>('standard');
  const [classifierAlgo,  setClassifierAlgo]  = useState<string>('rf');
  const [regressorAlgo,   setRegressorAlgo]   = useState<string>('rf');
  const [nEstimators,     setNEstimators]     = useState<number>(100);
  const [isTraining,      setIsTraining]      = useState<boolean>(false);
  const [trainDone,       setTrainDone]       = useState<boolean>(false);
  const [trainMetrics,    setTrainMetrics]    = useState<{classifier:{algo:string;accuracy:number;samples:number;test_size:number};regressor:{algo:string;mae_minutes:number;mape:number;r2:number;samples:number};config:{random_state:number;scaling_method:string;n_estimators:number|string;train_samples:number}} | null>(null);
  const [trainError,      setTrainError]      = useState<string | null>(null);
  const [evalView,        setEvalView]        = useState<'clustering' | 'classifier' | 'regressor'>('clustering');
  const [hoveredInsight,  setHoveredInsight]  = useState<string>('Hover over any chart element to see a detailed analytical insight here.');

  // ── Session mutation ─────────────────────────────────────────────────────────
  const updateSession = useCallback(
    (idx: number, field: keyof TrainingSession, val: number) => {
      setSessions((prev) => {
        const next = [...prev] as [TrainingSession, TrainingSession, TrainingSession];
        next[idx] = { ...next[idx], [field]: val };
        return next;
      });
    }, []
  );

  // ── Derived training aggregates ──────────────────────────────────────────────
  const avgHeartRate = Math.round(
    sessions.reduce((sum, s) => sum + s.heartRate, 0) / sessions.length
  );
  const avgTrainingDistance = parseFloat(
    (sessions.reduce((sum, s) => sum + s.jarakKm, 0) / sessions.length).toFixed(1)
  );

  const raceCfg   = RACE_CONFIG[raceCategory];
  const waktuInfo = resolveWaktu(jamLari);

  // ── Auto-predict on step 3 only ──────────────────────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    if (avgHeartRate < 40 || avgHeartRate > 220) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setApiError(null);
      try {
        const res = await fetch('/api/predict', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            training_dist_km: avgTrainingDistance,
            jarak_km:         raceCfg.jarakKm,
            elevasi_m:        elevasiM,
            gender,
            jam_lari:         jamLari,
            heart_rate:       avgHeartRate,
            classifier_algo:  classifierAlgo,
            regressor_algo:   regressorAlgo,
          }),
          signal: controller.signal,
        });
        const data: ApiResponse = await res.json();
        if (data.status === 'success') {
          setHasil(data.hasil);
          setDebug(data.debug);
        } else {
          setApiError(data.message ?? 'Prediction request failed.');
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setApiError('Backend unreachable. Ensure python3 api/index.py is running on port 5000.');
        }
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [step, raceCategory, elevasiM, gender, jamLari, avgHeartRate, avgTrainingDistance, raceCfg.jarakKm, classifierAlgo, regressorAlgo]);

  // ── Derived output ───────────────────────────────────────────────────────────
  const kastaCfg        = hasil ? KASTA_CONFIG[hasil.tingkat_pengalaman] : null;
  const worthinessReady = hasil ? hasil.total_detik < raceCfg.cotDetik   : null;
  const cotMarginSec    = hasil ? raceCfg.cotDetik - hasil.total_detik    : 0;

  // Expectation vs Reality — pure frontend math, no ML involvement
  const expectedDurationSec = raceCfg.jarakKm * targetPace * 60;
  const aiPaceFloat         = hasil ? parsePaceToFloat(hasil.rekomendasi_pace) : 0;
  // True when user's target pace is > 0.2 min/km faster than AI recommendation
  const paceGapAggressive   = hasil ? (aiPaceFloat - targetPace) > 0.2 : false;

  // Three-state banner status for COT Worthiness Validation:
  //   CRITICAL_RISK      — AI prediction exceeds COT (red)
  //   UNREALISTIC_TARGET — Under COT but pace target too aggressive (amber)
  //   FULLY_READY        — Under COT and pace target realistic (green)
  const bannerStatus = !hasil
    ? ('IDLE' as const)
    : hasil.total_detik >= raceCfg.cotDetik
      ? ('CRITICAL_RISK' as const)
      : paceGapAggressive
        ? ('UNREALISTIC_TARGET' as const)
        : ('FULLY_READY' as const);

  // Dynamic race category constraints derived from Step 1 training volume.
  // Thresholds mirror the Sanity Gate in the Flask backend to prevent
  // out-of-distribution requests before they reach the model.
  const halfAllowed = avgTrainingDistance >= 8.0;
  const fullAllowed = avgTrainingDistance >= 15.0;
  const raceConstraintWarning: string | null = !fullAllowed
    ? `Pilihan kategori ${
        !halfAllowed ? 'Half Marathon dan Full Marathon' : 'Full Marathon'
      } dikunci karena rata-rata volume latihan Anda saat ini (${avgTrainingDistance.toFixed(1)} km) belum memenuhi ambang batas adaptasi fisik yang aman untuk simulasi.`
    : null;

  // ── Wizard actions ───────────────────────────────────────────────────────────
  const handleLockProfile = () => {
    setProfileLocked(true);
    // Auto-correct raceCategory if the current selection is now locked
    // by the training-volume constraint.
    if (avgTrainingDistance < 8.0 && raceCategory !== '10K') {
      setRaceCategory('10K');
    } else if (avgTrainingDistance < 15.0 && raceCategory === 'FULL') {
      setRaceCategory('HALF');
    }
    setStep(2);
  };

  const handleUnlockProfile = () => {
    setProfileLocked(false);
    setHasil(null);
    setDebug(null);
    setStep(1);
  };

  const handleStartSimulation = () => {
    setHasil(null);
    setDebug(null);
    setStep(3);
  };

  const handleFeedbackSubmit = async () => {
    if (!fbRating) return;
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: fbRating, comment: fbComment }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        setApiError(`Feedback gagal tersimpan: ${err.message ?? res.statusText}`);
        return;
      }
      setFbSubmitted(true);
    } catch (e) {
      setApiError(`Feedback gagal tersimpan: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── Real model training ──────────────────────────────────────────────────────
  const handleTrainModel = async () => {
    setIsTraining(true);
    setTrainDone(false);
    setTrainMetrics(null);
    setTrainError(null);
    try {
      const res = await fetch('/api/retrain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_size:       ppTestSize / 100,
          random_state:    ppRandomState,
          scaling_method:  ppScalingMethod,
          classifier_algo: classifierAlgo,
          regressor_algo:  regressorAlgo,
          n_estimators:    nEstimators,
        }),
      });
      const json = await res.json();
      if (json.status === 'success') {
        setTrainMetrics(json.metrics);
        setTrainDone(true);
      } else {
        setTrainError(json.message ?? 'Training gagal.');
      }
    } catch {
      setTrainError('Backend tidak dapat dijangkau.');
    } finally {
      setIsTraining(false);
    }
  };

  // ── Tab navigation helpers ───────────────────────────────────────────────────
  const TAB_ORDER: ActiveTab[] = ['about', 'eda', 'preprocessing', 'training', 'evaluation', 'simulator'];

  const navigateTo = (id: ActiveTab) => {
    if (!unlockedTabs.has(id)) return;
    setActiveTab(id);
  };

  const goNext = () => {
    const idx = TAB_ORDER.indexOf(activeTab);
    if (idx < TAB_ORDER.length - 1) {
      const next = TAB_ORDER[idx + 1];
      setUnlockedTabs(prev => new Set([...prev, next]));
      setActiveTab(next);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes cot-risk-pulse {
          0%, 100% { background-color: rgb(185 28 28); box-shadow: 0 0 0 0 rgba(239,68,68,0.45); }
          50%       { background-color: rgb(220 38 38); box-shadow: 0 0 0 8px rgba(239,68,68,0);  }
        }
        .animate-cot-risk { animation: cot-risk-pulse 1.4s ease-in-out infinite; }

        .slider-custom::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(20 184 166); cursor: pointer;
          border: 2px solid rgb(2 6 23);
          box-shadow: 0 0 0 3px rgba(20,184,166,0.20);
          transition: box-shadow 0.15s;
        }
        .slider-custom::-webkit-slider-thumb:hover { box-shadow: 0 0 0 5px rgba(20,184,166,0.25); }
        .slider-custom::-moz-range-thumb {
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(20 184 166); cursor: pointer;
          border: 2px solid rgb(2 6 23);
        }

        .slider-session::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(251 146 60); cursor: pointer;
          border: 2px solid rgb(2 6 23);
          box-shadow: 0 0 0 3px rgba(251,146,60,0.20);
          transition: box-shadow 0.15s;
        }
        .slider-session::-webkit-slider-thumb:hover { box-shadow: 0 0 0 5px rgba(251,146,60,0.25); }
        .slider-session::-moz-range-thumb {
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(251 146 60); cursor: pointer;
          border: 2px solid rgb(2 6 23);
        }

        .slider-pp::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(139 92 246); cursor: pointer;
          border: 2px solid rgb(2 6 23);
          box-shadow: 0 0 0 3px rgba(139,92,246,0.20);
        }
        .slider-pp::-moz-range-thumb {
          width: 15px; height: 15px; border-radius: 50%;
          background: rgb(139 92 246); cursor: pointer;
          border: 2px solid rgb(2 6 23);
        }
      `}</style>

      <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-60 flex-shrink-0 bg-slate-900/80 border-r border-slate-800 flex flex-col overflow-y-auto">
          <div className="px-5 py-6 border-b border-slate-800/60">
            <h1 className="text-xl font-black tracking-tight leading-none">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-300">RunPace</span>
              <span className="text-slate-500 ml-2 text-base font-light">AI</span>
            </h1>
            <p className="text-[9px] text-slate-600 mt-1.5 font-medium uppercase tracking-widest">ML Dashboard</p>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            <div className="px-1 pb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">Progress</span>
                <span className="text-[9px] font-mono text-slate-500">{unlockedTabs.size}/6</span>
              </div>
              <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500/60 rounded-full transition-all duration-500"
                  style={{ width: `${(unlockedTabs.size / 6) * 100}%` }} />
              </div>
            </div>
            {([
              { id: 'about',         label: '1. About The Project', sub: 'Pipeline & Architecture'   },
              { id: 'eda',           label: '2. EDA',               sub: 'Exploratory Data Analysis' },
              { id: 'preprocessing', label: '3. Preprocessing',     sub: 'Data Cleaning & Splitting' },
              { id: 'training',      label: '4. Model Training',    sub: 'Config & Hyperparameters'  },
              { id: 'evaluation',    label: '5. Evaluation',        sub: 'Metrics & Sanity Gate'     },
              { id: 'simulator',     label: '6. Simulator',         sub: 'Predictive Testing'        },
            ] as { id: ActiveTab; label: string; sub: string }[]).map(({ id, label, sub }) => {
              const unlocked = unlockedTabs.has(id);
              const active   = activeTab === id;
              return (
                <button key={id} type="button" onClick={() => navigateTo(id)} disabled={!unlocked}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-all duration-150 border ${
                    active
                      ? 'bg-teal-500/15 border-teal-500/25 cursor-pointer'
                      : unlocked
                      ? 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer'
                      : 'border-transparent text-slate-700 cursor-not-allowed opacity-40'
                  }`}>
                  <div className="flex items-center justify-between">
                    <p className={`text-[11px] font-bold leading-tight ${active ? 'text-teal-300' : ''}`}>{label}</p>
                    {!unlocked && <span className="text-slate-700 text-[9px]">🔒</span>}
                    {unlocked && !active && <span className="text-teal-600 text-[9px]">✓</span>}
                  </div>
                  <p className={`text-[9px] leading-tight mt-0.5 ${active ? 'text-teal-600' : 'text-slate-700'}`}>{sub}</p>
                </button>
              );
            })}
          </nav>
          <div className="px-5 py-4 border-t border-slate-800/60">
            <p className="text-[9px] text-slate-700 font-mono">BINUS University · ML Final Project</p>
          </div>
        </aside>

        {/* ── Content Viewport ────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">

          {/* ══ TAB 6: PREDICTIVE SIMULATOR (existing wizard — intact) ══════ */}
          {activeTab === 'simulator' && (<div>
            <div className="mb-8">
              <h2 className="text-2xl font-black text-white mb-1">Predictive Simulator</h2>
              <p className="text-xs text-slate-500">Live inference via Flask backend — 3-Step COT Readiness Wizard</p>
            </div>

          {/* ── Step Indicator ──────────────────────────────────────────────── */}
          <StepIndicator current={step} />

          {/* ── Error Banner ─────────────────────────────────────────────────── */}
          {apiError && (
            <div className="mb-6 px-4 py-3 bg-rose-500/5 border border-rose-500/20 rounded-xl flex items-start gap-3">
              <div className="w-1 min-h-[16px] bg-rose-500/40 rounded-full flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-400 font-mono leading-relaxed">{apiError}</p>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 1 — PROFIL LATIHAN
          ══════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="space-y-5">

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-start justify-between pb-5 mb-5 border-b border-slate-800">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-[0.2em] text-teal-400">
                      Langkah 1 — Profil Kebugaran
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Masukkan data 3 sesi latihan terakhirmu. Kasta pelari ditentukan dari profil ini.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {sessions.map((s, i) => (
                    <SessionSliderRow
                      key={i}
                      index={i}
                      session={s}
                      locked={false}
                      onChange={updateSession}
                    />
                  ))}
                </div>

                {/* Live aggregate display */}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl px-4 py-3">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600 block">
                      Rata-rata Jarak Latihan
                    </span>
                    <span className="text-xl font-black font-mono text-orange-400 tabular-nums leading-tight mt-0.5 block">
                      {avgTrainingDistance.toFixed(1)}
                      <span className="text-[11px] text-slate-600 ml-1">km</span>
                    </span>
                    <span className="text-[9px] text-slate-700 mt-0.5 block">
                      Dikirim ke Classifier sebagai training_dist_km
                    </span>
                  </div>
                  <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl px-4 py-3">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600 block">
                      Rata-rata Heart Rate
                    </span>
                    <span className="text-xl font-black font-mono text-teal-300 tabular-nums leading-tight mt-0.5 block">
                      {avgHeartRate}
                      <span className="text-[11px] text-slate-600 ml-1">bpm</span>
                    </span>
                    <span className="text-[9px] text-slate-700 mt-0.5 block">
                      Representasi kapasitas kardiovaskular
                    </span>
                  </div>
                </div>
              </div>

              {/* CTA */}
              <button
                type="button"
                onClick={handleLockProfile}
                className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest border transition-all duration-150 cursor-pointer bg-teal-500/15 border-teal-400/50 text-teal-300 hover:bg-teal-500/25 hover:border-teal-300/70 active:scale-[0.99]"
              >
                Kunci Profil Kebugaran &amp; Lanjut ke Simulasi
              </button>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 2 — PARAMETER TARGET LOMBA
          ══════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="space-y-5">

              {/* Locked profile summary */}
              <div className="bg-teal-500/5 border border-teal-500/20 rounded-2xl px-5 py-4 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-teal-600 block">
                    Profil Kebugaran Terkunci
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Avg Jarak: <span className="font-black text-orange-400">{avgTrainingDistance.toFixed(1)} km</span>
                    <span className="mx-2 text-slate-700">|</span>
                    Avg HR: <span className="font-black text-teal-300">{avgHeartRate} bpm</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleUnlockProfile}
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400 transition-colors flex-shrink-0 ml-4 cursor-pointer"
                >
                  Ubah Profil
                </button>
              </div>

              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                <div className="pb-4 border-b border-slate-800">
                  <h2 className="text-sm font-black uppercase tracking-[0.2em] text-teal-400">
                    Langkah 2 — Parameter Target Lomba
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Tentukan spesifikasi lomba yang ingin kamu ikuti untuk simulasi COT.
                  </p>
                </div>

                {/* Race category */}
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 block">
                    Kategori Target Lomba
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(RACE_CONFIG) as RaceCategory[]).map((cat) => {
                      const cfg      = RACE_CONFIG[cat];
                      const isActive = raceCategory === cat;
                      const isLocked =
                        (cat === 'HALF' && !halfAllowed) ||
                        (cat === 'FULL' && !fullAllowed);
                      return (
                        <button
                          key={cat}
                          type="button"
                          disabled={isLocked}
                          onClick={() => !isLocked && setRaceCategory(cat)}
                          className={`py-4 px-2 rounded-xl border transition-all duration-150 text-center ${
                            isLocked
                              ? 'bg-slate-950/20 border-slate-800/40 opacity-40 cursor-not-allowed'
                              : isActive
                                ? 'bg-teal-500/15 border-teal-400/50 cursor-pointer'
                                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 cursor-pointer'
                          }`}
                        >
                          <span className={`text-[10px] font-black uppercase tracking-wide block ${
                            isLocked ? 'text-slate-700' : isActive ? 'text-teal-300' : 'text-slate-500'
                          }`}>
                            {cfg.label}
                          </span>
                          <span className={`text-[9px] font-mono mt-1 block ${
                            isLocked ? 'text-slate-800' : isActive ? 'text-teal-500' : 'text-slate-700'
                          }`}>
                            {cfg.sublabel}
                          </span>
                          <span className={`text-[8px] font-bold uppercase tracking-wider mt-1 block ${
                            isLocked ? 'text-slate-800' : isActive ? 'text-teal-600' : 'text-slate-800'
                          }`}>
                            {isLocked ? 'DIKUNCI' : `COT ${cfg.cotLabel}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {raceConstraintWarning && (
                    <p className="text-[10px] text-amber-500/80 leading-relaxed pt-1">
                      {raceConstraintWarning}
                    </p>
                  )}
                </div>

                {/* Elevation */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Estimasi Elevasi Rute Lomba
                    </span>
                    <span className="text-xl font-black tabular-nums text-slate-200 leading-none">
                      {elevasiM}
                      <span className="text-[11px] font-semibold text-slate-500 ml-1">m</span>
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={500} step={5}
                    value={elevasiM}
                    onChange={(e) => setElevasiM(parseFloat(e.target.value))}
                    style={buildTrackStyle(elevasiM, 0, 500)}
                    className="slider-custom w-full h-[5px] rounded-full appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none">
                    <span>0</span><span>250</span><span>500</span>
                  </div>
                </div>

                {/* Race start time */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                      Jam Mulai Lomba
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-black tabular-nums font-mono text-slate-200 leading-none">
                        {String(jamLari).padStart(2, '0')}:00
                      </span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${waktuInfo.classes}`}>
                        {waktuInfo.label}
                      </span>
                    </div>
                  </div>
                  <input
                    type="range" min={0} max={23} step={1}
                    value={jamLari}
                    onChange={(e) => setJamLari(parseInt(e.target.value))}
                    style={buildTrackStyle(jamLari, 0, 23)}
                    className="slider-custom w-full h-[5px] rounded-full appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none">
                    <span>00:00</span><span>12:00</span><span>23:00</span>
                  </div>
                </div>

                {/* Gender */}
                <div className="space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 block">
                    Physiological Gender
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    {(['M', 'F'] as const).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGender(g)}
                        className={`py-3 rounded-xl text-xs font-bold uppercase tracking-widest border transition-all duration-100 cursor-pointer ${
                          gender === g
                            ? 'bg-teal-500/15 border-teal-400/50 text-teal-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                        }`}
                      >
                        {g === 'M' ? 'Male' : 'Female'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Target Pace — frontend-only, never sent to backend */}
                <div className="space-y-2 pt-2 border-t border-slate-800/60">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 block">
                        Target Pace Incaran Kamu
                      </span>
                      <span className="text-[9px] text-slate-700 mt-0.5 block">
                        Hanya untuk komparasi — tidak masuk ke model AI
                      </span>
                    </div>
                    <span className="text-xl font-black tabular-nums font-mono text-violet-400 leading-none flex-shrink-0 ml-4">
                      {formatPace(targetPace)}
                      <span className="text-[11px] font-semibold text-slate-500 ml-1">/km</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={4.0} max={10.0} step={0.0833}
                    value={targetPace}
                    onChange={(e) => setTargetPace(parseFloat(parseFloat(e.target.value).toFixed(4)))}
                    style={buildTrackStyle(targetPace, 4.0, 10.0, 'rgb(167 139 250)')}
                    className="slider-custom w-full h-[5px] rounded-full appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none">
                    <span>4:00 (cepat)</span><span>7:00</span><span>10:00 (santai)</span>
                  </div>
                </div>

              </div>

              {/* CTA */}
              <button
                type="button"
                onClick={handleStartSimulation}
                className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest border transition-all duration-150 cursor-pointer bg-teal-500/15 border-teal-400/50 text-teal-300 hover:bg-teal-500/25 hover:border-teal-300/70 active:scale-[0.99]"
              >
                Mulai Simulasi Kesiapan Maraton
              </button>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              STEP 3 — LAPORAN KELAYAKAN
          ══════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="space-y-5">

              {/* Input summary strip */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-5 py-3 flex flex-wrap gap-x-6 gap-y-1 items-center justify-between">
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span className="text-[10px] text-slate-600">
                    Avg Jarak Latihan: <span className="font-black text-orange-400">{avgTrainingDistance.toFixed(1)} km</span>
                  </span>
                  <span className="text-[10px] text-slate-600">
                    Avg HR: <span className="font-black text-teal-300">{avgHeartRate} bpm</span>
                  </span>
                  <span className="text-[10px] text-slate-600">
                    Target: <span className="font-black text-slate-300">{raceCfg.label}</span>
                  </span>
                  <span className="text-[10px] text-slate-600">
                    Elevasi: <span className="font-black text-slate-300">{elevasiM} m</span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                    loading
                      ? 'text-amber-400 bg-amber-500/5 border-amber-500/20'
                      : hasil
                        ? 'text-teal-500 bg-teal-500/5 border-teal-500/20'
                        : 'text-slate-600 bg-slate-800/50 border-slate-700'
                  }`}>
                    {loading ? 'COMPUTING' : hasil ? 'DONE' : 'PENDING'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="text-[9px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded border border-slate-700 text-slate-500 hover:text-slate-400 hover:border-slate-600 transition-colors cursor-pointer"
                  >
                    Ubah Parameter
                  </button>
                </div>
              </div>

              {/* ── Expectation vs Reality ──────────────────────────────────── */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                    Expectation vs. Reality Check
                  </span>
                  <span className="text-[9px] font-mono text-slate-700">
                    Uji Realita Pace Target
                  </span>
                </div>
                <div className="grid grid-cols-2 divide-x divide-slate-800">

                  {/* Kolom kiri — ekspektasi subjektif */}
                  <div className="px-5 py-4 space-y-3">
                    <span className="text-[9px] font-black uppercase tracking-widest text-violet-500 block">
                      Ekspektasi Subjektif
                    </span>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Target Pace Incaran</span>
                      <span className="text-2xl font-black font-mono tabular-nums text-violet-400 leading-none">
                        {formatPace(targetPace)}
                        <span className="text-[11px] text-slate-600 ml-1">/km</span>
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Estimasi Durasi Ekspektasi</span>
                      <span className={`text-sm font-extrabold leading-snug text-violet-300`}>
                        {formatDurationIndo(expectedDurationSec)}
                      </span>
                    </div>
                    <div className="pt-1">
                      <span className="text-[9px] text-slate-700 leading-relaxed block">
                        Berdasarkan: {formatPace(targetPace)} /km x {raceCfg.jarakKm} km
                      </span>
                    </div>
                  </div>

                  {/* Kolom kanan — proyeksi objektif AI */}
                  <div className="px-5 py-4 space-y-3">
                    <span className="text-[9px] font-black uppercase tracking-widest text-teal-500 block">
                      Proyeksi Objektif AI
                    </span>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Rekomendasi Pace AI</span>
                      {hasil ? (
                        <span className="text-2xl font-black font-mono tabular-nums text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 leading-none">
                          {hasil.rekomendasi_pace}
                        </span>
                      ) : (
                        <span className={`text-2xl font-black font-mono text-slate-700 leading-none ${loading ? 'animate-pulse' : ''}`}>
                          --:--
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-600 block mb-0.5">Estimasi Durasi AI</span>
                      <span className={`text-sm font-extrabold leading-snug transition-all duration-200 ${
                        loading ? 'text-amber-700 opacity-40' : hasil ? 'text-amber-400' : 'text-slate-700'
                      }`}>
                        {hasil ? hasil.estimasi_durasi : loading ? 'Menghitung...' : '—'}
                      </span>
                    </div>
                    <div className="pt-1">
                      <span className="text-[9px] text-slate-700 leading-relaxed block">
                        Hybrid physics + RF Regressor
                      </span>
                    </div>
                  </div>

                </div>

                {/* Gap indicator — only when AI result is available */}
                {hasil && (
                  <div className={`px-5 py-3 border-t border-slate-800 flex items-center justify-between ${
                    paceGapAggressive ? 'bg-amber-500/5' : ''
                  }`}>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600">
                      Selisih Pace
                    </span>
                    <span className={`text-xs font-black font-mono tabular-nums ${
                      paceGapAggressive
                        ? 'text-amber-400'
                        : targetPace > aiPaceFloat
                          ? 'text-slate-500'
                          : 'text-teal-400'
                    }`}>
                      {paceGapAggressive
                        ? `Target kamu ${formatPace(aiPaceFloat - targetPace)} /km lebih cepat dari AI`
                        : targetPace > aiPaceFloat
                          ? `Target kamu ${formatPace(targetPace - aiPaceFloat)} /km lebih lambat dari AI`
                          : 'Target pace selaras dengan rekomendasi AI'}
                    </span>
                  </div>
                )}
              </div>

              {/* ── COT Status Banner (three-state) ─────────────────────── */}
              <div className={`rounded-2xl border transition-colors duration-500 overflow-hidden ${
                loading || !hasil
                  ? 'bg-slate-900/40 border-slate-800'
                  : bannerStatus === 'FULLY_READY'
                    ? 'bg-emerald-700 border-emerald-500'
                    : bannerStatus === 'UNREALISTIC_TARGET'
                      ? 'bg-amber-600 border-amber-500'
                      : 'border-rose-600 animate-cot-risk'
              }`}>
                <div className="px-6 py-5">

                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
                      !hasil || loading ? 'text-slate-600' : 'text-white/60'
                    }`}>
                      Marathon Worthiness Validation
                    </span>
                    <span className={`text-[9px] font-mono px-2.5 py-0.5 rounded border uppercase tracking-wider flex-shrink-0 ml-3 ${
                      !hasil || loading
                        ? 'text-slate-600 bg-slate-800/50 border-slate-700'
                        : bannerStatus === 'FULLY_READY'
                          ? 'text-emerald-100 bg-emerald-900/30 border-emerald-400/30'
                          : bannerStatus === 'UNREALISTIC_TARGET'
                            ? 'text-amber-100 bg-amber-900/30 border-amber-400/30'
                            : 'text-rose-100 bg-rose-900/30 border-rose-400/30'
                    }`}>
                      {raceCfg.label} &mdash; COT {raceCfg.cotLabel}
                    </span>
                  </div>

                  {/* Main status text */}
                  <p className={`text-base font-black uppercase tracking-wider leading-snug ${
                    !hasil || loading ? 'text-slate-700' : 'text-white'
                  }`}>
                    {loading
                      ? 'STATUS: COMPUTING...'
                      : !hasil
                        ? 'STATUS: AWAITING PREDICTION'
                        : bannerStatus === 'FULLY_READY'
                          ? 'STATUS: READY FOR RACE (Diprediksi Lolos dari Cut-Off Time Lomba)'
                          : bannerStatus === 'UNREALISTIC_TARGET'
                            ? 'STATUS: REGISTRASI AMAN, TAPI TARGET EKSEKUSI BERISIKO TINGGI'
                            : 'STATUS: HIGH RISK (Diprediksi Melebihi Batas Waktu / Terkena Sweeper Bus)'}
                  </p>

                  {/* Amber warning body — hanya muncul pada state UNREALISTIC_TARGET */}
                  {hasil && !loading && bannerStatus === 'UNREALISTIC_TARGET' && (
                    <p className="mt-2 text-[11px] text-amber-100/90 leading-relaxed">
                      Secara kapasitas total durasi Anda diprediksi mampu finis sebelum batas
                      Cut-Off Time, DENGAN SYARAT Anda wajib menurunkan ego dan berlari mengikuti
                      rekomendasi pace aman dari AI. Memaksakan target pace impian Anda saat ini
                      akan memicu deplesi energi ekstrem atau kegagalan fisik sebelum kilometer 15.
                    </p>
                  )}

                  {/* Info stats row */}
                  {hasil && !loading && (
                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-4 border-t border-white/10">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">COT Limit</span>
                        <span className="text-xs font-black font-mono text-white">{raceCfg.cotLabel}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">Prediksi Kamu</span>
                        <span className="text-xs font-black font-mono text-white">{hasil.estimasi_durasi}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                          {bannerStatus === 'CRITICAL_RISK' ? 'Over Limit By' : 'Safety Margin'}
                        </span>
                        <span className={`text-xs font-black font-mono ${
                          bannerStatus === 'CRITICAL_RISK' ? 'text-rose-200' : 'text-white'
                        }`}>
                          {bannerStatus === 'CRITICAL_RISK' ? '-' : '+'}{formatSeconds(cotMarginSec)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">Avg HR Input</span>
                        <span className="text-xs font-black font-mono text-white">{avgHeartRate} bpm</span>
                      </div>
                    </div>
                  )}

                </div>
              </div>

              {/* ── 3 Metric Cards ──────────────────────────────────────────── */}
              <div className="grid grid-cols-3 gap-4">
                <div className={`rounded-2xl p-5 flex flex-col gap-3 border bg-slate-900/40 transition-colors duration-500 ${kastaCfg ? kastaCfg.border : 'border-slate-800'}`}>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Runner Class</span>
                  <div className="flex-1 flex items-center min-h-[34px]">
                    {hasil && kastaCfg ? (
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider border ${kastaCfg.text} ${kastaCfg.bg} ${kastaCfg.border}`}>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${kastaCfg.dot}`} />
                        {hasil.tingkat_pengalaman}
                      </span>
                    ) : (
                      <span className={`text-sm font-bold text-slate-700 ${loading ? 'animate-pulse' : ''}`}>— — —</span>
                    )}
                  </div>
                  <span className="text-[9px] text-slate-700">K-Means + RF Classifier</span>
                </div>

                <div className="rounded-2xl p-5 flex flex-col gap-3 border border-teal-500/20 bg-gradient-to-br from-teal-950/50 to-slate-900/40 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-teal-500/5 rounded-full translate-x-5 -translate-y-5 pointer-events-none" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-500">Target Pace</span>
                  <div className="flex-1 flex items-center min-h-[34px]">
                    <span className={`text-2xl font-black font-mono tabular-nums leading-none text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 transition-opacity duration-200 ${loading ? 'opacity-30' : 'opacity-100'}`}>
                      {hasil ? hasil.rekomendasi_pace : '--:--'}
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-600">per km</span>
                </div>

                <div className="rounded-2xl p-5 flex flex-col gap-3 border border-slate-800 bg-slate-900/40">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Est. Duration</span>
                  <div className="flex-1 flex items-center min-h-[34px]">
                    <span className={`text-sm font-extrabold leading-tight transition-all duration-200 ${loading ? 'text-amber-700 opacity-40' : 'text-amber-400'}`}>
                      {hasil ? hasil.estimasi_durasi : '—'}
                    </span>
                  </div>
                  <span className="text-[9px] text-slate-700">Hybrid physics + RF</span>
                </div>
              </div>

              {/* ── Confidence Bars ──────────────────────────────────────────── */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Classifier Confidence</span>
                  <span className="text-[10px] font-mono text-slate-700">predict_proba output</span>
                </div>
                <div className="space-y-4">
                  {(['Advanced', 'Intermediate', 'Beginner'] as const).map((kasta) => {
                    const cfg      = KASTA_CONFIG[kasta];
                    const prob     = hasil?.confidence[kasta] ?? 0;
                    const isActive = hasil?.tingkat_pengalaman === kasta;
                    return (
                      <div key={kasta}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? cfg.dot : 'bg-slate-700'}`} />
                            <span className={`text-xs font-bold uppercase tracking-wider ${isActive ? cfg.text : 'text-slate-600'}`}>{kasta}</span>
                          </div>
                          <span className={`text-xs font-mono tabular-nums ${isActive ? cfg.text : 'text-slate-700'}`}>
                            {(prob * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-[5px] bg-slate-800/80 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ease-out ${isActive ? cfg.bar : 'bg-slate-700/50'}`}
                            style={{ width: `${prob * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {loading && (
                  <p className="text-center text-slate-700 text-[11px] font-mono mt-5 pt-4 border-t border-slate-800/50 animate-pulse">
                    Menghitung prediksi...
                  </p>
                )}
              </div>

              {/* ── AI Actionable Coaching Advice ───────────────────────────── */}
              {hasil && (
                <div className={`rounded-2xl border p-6 ${
                  worthinessReady
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'bg-rose-500/5 border-rose-500/20'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                      AI Actionable Coaching Advice
                    </span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                      worthinessReady
                        ? 'text-emerald-500 bg-emerald-500/5 border-emerald-500/20'
                        : 'text-rose-500 bg-rose-500/5 border-rose-500/20'
                    }`}>
                      {worthinessReady ? 'RACE DAY TIPS' : 'IMPROVEMENT PLAN'}
                    </span>
                  </div>

                  {paceGapAggressive && (
                    <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 space-y-1">
                      <span className="text-[9px] font-black uppercase tracking-widest text-amber-500 block">
                        Peringatan Pace Agresif
                      </span>
                      <p className="text-[11px] text-amber-300 leading-relaxed">
                        Target pace incaran kamu terlalu agresif dibandingkan kapasitas kardiovaskular
                        hasil latihan kamu (Avg HR {avgHeartRate} bpm). Memaksakan pace ini berisiko
                        memaksa jantung beroperasi di zona anaerobik terlalu dini sebelum kilometer 20.
                        AI menyarankan kamu mengikuti rekomendasi pace aman{' '}
                        <span className="font-black text-white">{hasil.rekomendasi_pace} /km</span>{' '}
                        demi keselamatan dan performa optimal di hari H.
                      </p>
                    </div>
                  )}

                  {worthinessReady ? (
                    <div className="space-y-3">
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Profil latihanmu menunjukkan kesiapan fisik yang cukup untuk menyelesaikan{' '}
                        <span className="font-bold text-emerald-400">{raceCfg.label}</span> dalam
                        batas Cut-Off Time. Berikut rekomendasi manajemen energi pada hari H:
                      </p>
                      <ul className="space-y-2 mt-3">
                        {[
                          `Mulailah dengan pace ${hasil.rekomendasi_pace} /km dan pertahankan konsistensi. Jangan tergoda lari lebih cepat di 5 km pertama karena euforia crowd.`,
                          `Dengan elevasi ${elevasiM} m, atur napas saat tanjakan dan manfaatkan turunan untuk recovery. Jangan sprint di downhill terlalu agresif.`,
                          `Konsumsi gel energi atau asupan karbohidrat setiap 45 menit sekali, terutama menjelang km 30 untuk menghindari dinding energi (the wall).`,
                          `Pantau Heart Rate agar tidak melebihi zona anaerobik secara konsisten. Target HR lomba sebaiknya berada di kisaran yang serupa dengan rata-rata latihanmu (${avgHeartRate} bpm).`,
                        ].map((tip, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
                            <span className="w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-[8px] font-black text-emerald-500 flex-shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        Berdasarkan profil latihan dan prediksi durasi, risiko terkena sweeper bus
                        di <span className="font-bold text-rose-400">{raceCfg.label}</span> cukup
                        tinggi. Berikut langkah perbaikan yang terukur:
                      </p>
                      <ul className="space-y-2 mt-3">
                        {[
                          raceCategory === 'FULL'
                            ? `Pertimbangkan untuk mendaftar Half Marathon (21.1 km, COT 3:30:00) terlebih dahulu. Rata-rata jarak latihanmu ${avgTrainingDistance.toFixed(1)} km lebih sesuai dengan kategori tersebut untuk saat ini.`
                            : `Pertimbangkan untuk turun ke kategori 10K (COT 3:30:00) dan bangun volume latihan secara progresif sebelum mencoba ${raceCfg.label}.`,
                          `Tingkatkan volume latihan mingguan secara bertahap. Tambah rata-rata jarak per sesi sebesar 10% per minggu selama 8-12 minggu ke depan.`,
                          `Fokus pada latihan Zone 2 (65-75% max HR) untuk membangun base aerobik. Berlari terlalu sering di intensitas tinggi (HR ${avgHeartRate} bpm) menghambat adaptasi aerobik jangka panjang.`,
                          `Lakukan long run sekali per minggu dengan jarak progresif. Targetkan minimal satu long run sejauh 75% dari jarak lomba sebelum hari H.`,
                        ].map((tip, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[11px] text-slate-400 leading-relaxed">
                            <span className="w-4 h-4 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-[8px] font-black text-rose-500 flex-shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* ── Debug Panel ──────────────────────────────────────────────── */}
              <div className={`bg-slate-950 border border-slate-800/60 rounded-2xl p-5 transition-opacity duration-300 ${debug ? 'opacity-100' : 'opacity-35'}`}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Hybrid Formula Debug</span>
                  <span className="text-[10px] font-mono text-slate-700">Academic transparency panel</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { key: 'alpha_used',       val: debug ? debug.alpha_used.toFixed(3)               : '—', note: 'physics weight (alpha)' },
                    { key: 'pace_base',        val: debug ? `${debug.pace_base_used.toFixed(0)} s/km` : '—', note: 'from dataset median'    },
                    { key: 'physics_detik',    val: debug ? `${debug.physics_detik.toFixed(1)} s`     : '—', note: 'domain logic output'    },
                    { key: 'rf_raw_detik',     val: debug ? `${debug.rf_raw_detik.toFixed(1)} s`      : '—', note: 'RF model raw output'    },
                  ].map(({ key, val, note }) => (
                    <div key={key} className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-3">
                      <p className="text-[10px] font-mono text-slate-700 mb-1.5 truncate">{key}</p>
                      <p className="text-sm font-black font-mono text-slate-200 tabular-nums">{val}</p>
                      <p className="text-[9px] text-slate-700 mt-1.5 leading-tight">{note}</p>
                    </div>
                  ))}
                </div>
                {debug && (
                  <div className="bg-slate-900/40 rounded-xl px-3 py-2.5 border border-slate-800/40 mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1">Classifier Input</p>
                    <p className="text-[10px] font-mono text-slate-600">
                      training_dist = {debug.training_dist_km_used} km
                      <span className="mx-2 text-slate-800">|</span>
                      race_dist = {debug.race_dist_km_used} km
                    </p>
                  </div>
                )}
                <div className="bg-slate-900/40 rounded-xl px-3 py-2.5 border border-slate-800/40">
                  <p className="text-[11px] font-mono text-slate-500 leading-relaxed break-all">
                    {debug && hasil
                      ? `final = ${debug.alpha_used.toFixed(2)} x physics(${debug.physics_detik.toFixed(1)}s) + ${(1 - debug.alpha_used).toFixed(2)} x rf(${debug.rf_raw_detik.toFixed(1)}s) = ${hasil.total_detik.toFixed(1)}s`
                      : 'final = alpha x physics_detik + (1 - alpha) x rf_raw_detik — awaiting data'
                    }
                  </p>
                </div>
              </div>


            </div>
          )}

          {/* ── Footer ──────────────────────────────────────────────────────── */}
          <footer className="mt-12 pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-[11px] text-slate-700 font-mono">Machine Learning Final Project · BINUS University</p>
            <p className="text-[11px] text-slate-700 font-mono">K-Means + RF Classifier + RF Regressor · Hybrid Formula</p>
          </footer>
          </div>)}
          {/* ══ end simulator ══ */}

          {/* ══ TAB 1: ABOUT THE PROJECT ════════════════════════════════════ */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-black text-white mb-1">About The Project</h2>
                <p className="text-xs text-slate-500">Machine Learning Final Project — BINUS University</p>
              </div>
              <div className="bg-gradient-to-br from-teal-950/60 to-slate-900/60 border border-teal-500/20 rounded-2xl p-6">
                <p className="text-sm text-slate-300 leading-relaxed">
                  <span className="font-black text-teal-300">RunPace AI</span> is a marathon readiness and race cut-off time (COT) prediction system built from real GPS-tracked running data. Given a runner&apos;s recent training history, race distance, route elevation, and physiological parameters, it predicts their runner class, recommends an optimal race pace, and validates against the official COT threshold.
                </p>
              </div>
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">Two-Stage Sequential Pipeline Architecture</h3>
                <div className="space-y-3">
                  {([
                    { stage: '01', title: 'K-Means Clustering',            color: 'text-violet-400', border: 'border-violet-500/20 bg-violet-500/5', desc: 'Unsupervised clustering assigns each training session into one of 4 performance clusters based on pace, distance, and heart rate. Cluster labels become the supervised target for Stage 2.' },
                    { stage: '02', title: 'RF Classifier → Runner Class',  color: 'text-sky-400',    border: 'border-sky-500/20 bg-sky-500/5',       desc: 'A Random Forest Classifier (n_estimators=100) maps training features to Advanced, Intermediate, or Beginner. Achieves 99.16% accuracy on the held-out test set.' },
                    { stage: '03', title: 'Sanity Gate (5 Layers)',        color: 'text-amber-400',  border: 'border-amber-500/20 bg-amber-500/5',   desc: 'Before regression, a 5-layer rule-based gate checks for physiologically impossible inputs, out-of-distribution race-to-training ratios, and COT feasibility. Invalid requests are rejected with a structured error.' },
                    { stage: '04', title: 'RF Regressor + Physics Hybrid', color: 'text-teal-400',   border: 'border-teal-500/20 bg-teal-500/5',     desc: 'An RF Regressor predicts raw race duration (seconds), then blended with a physics-derived estimate using a learned alpha weight. Output: recommended pace, estimated duration, COT verdict.' },
                  ] as { stage: string; title: string; color: string; border: string; desc: string }[]).map(({ stage, title, color, border, desc }) => (
                    <div key={stage} className={`flex gap-4 p-4 rounded-xl border ${border}`}>
                      <span className={`text-[9px] font-mono flex-shrink-0 pt-0.5 ${color}`}>S{stage}</span>
                      <div>
                        <p className={`text-[11px] font-black uppercase tracking-wider mb-1 ${color}`}>{title}</p>
                        <p className="text-[11px] text-slate-400 leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {([
                  { label: 'Raw Dataset Rows',  value: '42,116', color: 'text-slate-200', note: 'Original GPS entries' },
                  { label: 'After Cleaning',     value: '23,201', color: 'text-teal-400',  note: '55.1% retained'      },
                  { label: 'Outliers Removed',   value: '18,915', color: 'text-rose-400',  note: '44.9% dropped'       },
                ] as { label: string; value: string; color: string; note: string }[]).map(({ label, value, color, note }) => (
                  <div key={label} className="bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-4 text-center">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600 mb-2">{label}</p>
                    <p className={`text-2xl font-black tabular-nums ${color}`}>{value}</p>
                    <p className="text-[9px] text-slate-700 mt-1">{note}</p>
                  </div>
                ))}
              </div>
              <div className="flex justify-end pt-6 border-t border-slate-800/60 mt-4">
                <button type="button" onClick={goNext} className="px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:border-teal-400/50 transition-all duration-150 cursor-pointer">Next →</button>
              </div>
            </div>
          )}

          {/* ══ TAB 2: EDA ══════════════════════════════════════════════════ */}
          {activeTab === 'eda' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-black text-white mb-1">Exploratory Data Analysis</h2>
                <p className="text-xs text-slate-500">Interactive dataset overview — 42,116 raw GPS activity rows</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {([
                  { label: 'Raw Rows',        value: '42,116', color: 'text-slate-200', border: 'border-slate-700',   bg: ''              },
                  { label: 'Clean Rows',       value: '23,201', color: 'text-teal-400',  border: 'border-teal-500/30', bg: 'bg-teal-500/5' },
                  { label: 'Outliers Dropped', value: '18,915', color: 'text-rose-400',  border: 'border-rose-500/30', bg: 'bg-rose-500/5' },
                ] as { label: string; value: string; color: string; border: string; bg: string }[]).map(({ label, value, color, border, bg }) => (
                  <div key={label} className={`rounded-xl border px-4 py-4 text-center ${border} ${bg} bg-slate-900/40`}>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600 mb-2">{label}</p>
                    <p className={`text-2xl font-black tabular-nums ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-1.5 flex-1 min-w-[140px]">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Feature Variable</label>
                    <select value={edaFeature} onChange={(e) => setEdaFeature(e.target.value as typeof edaFeature)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none cursor-pointer">
                      <option value="Distance">Distance (km)</option>
                      <option value="ElapsedTime">Elapsed Time (min)</option>
                      <option value="Elevation">Elevation Gain (m)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5 flex-1 min-w-[140px]">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">Chart Type</label>
                    <select value={edaChartType} onChange={(e) => setEdaChartType(e.target.value as typeof edaChartType)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none cursor-pointer">
                      <option value="Histogram">Histogram</option>
                      <option value="Boxplot">Box Plot</option>
                    </select>
                  </div>
                </div>
                {edaChartType === 'Histogram' && (() => {
                  const DATA: Record<string, { bins: string[]; heights: number[]; color: string }> = {
                    Distance:    { bins: ['0–3','3–6','6–9','9–12','12–15','15–20','20+'],               heights: [18,45,30,12,6,4,2],  color: 'bg-teal-500'   },
                    ElapsedTime: { bins: ['0–20m','20–40m','40–60m','60–90m','90–120m','2–3h','3h+'],    heights: [10,38,34,18,8,5,3],  color: 'bg-violet-500' },
                    Elevation:   { bins: ['0–20','20–50','50–100','100–200','200–300','300–400','400+'],  heights: [20,32,28,18,10,5,2], color: 'bg-amber-500'  },
                  };
                  const d = DATA[edaFeature];
                  const mx = Math.max(...d.heights);
                  return (
                    <div>
                      <div className="flex items-end gap-1.5 h-32 pb-1">
                        {d.bins.map((bin, i) => (
                          <div key={bin} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                            <div className={`w-full rounded-t-sm ${d.color} opacity-75`} style={{ height: `${(d.heights[i] / mx) * 100}%` }} />
                            <span className="text-[7px] text-slate-700 font-mono text-center leading-tight">{bin}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-[9px] text-slate-700 font-mono mt-1">
                        <span>← majority (low values)</span><span>right-skewed tail →</span>
                      </div>
                    </div>
                  );
                })()}
                {edaChartType === 'Boxplot' && (() => {
                  const BOXES: Record<string, { q1: number; med: number; q3: number; min: number; max: number; unit: string; outlier: string }> = {
                    Distance:    { q1: 4.2, med: 6.8, q3: 11.5, min: 0.5, max: 42,  unit: 'km',  outlier: '~3,400 km — 34-day GPS tracking error' },
                    ElapsedTime: { q1: 28,  med: 48,  q3: 82,   min: 5,   max: 360, unit: 'min', outlier: '~48,960 min — 34-day GPS tracking error' },
                    Elevation:   { q1: 18,  med: 52,  q3: 128,  min: 0,   max: 650, unit: 'm',   outlier: '940m+ trail outliers (retained as valid)' },
                  };
                  const b = BOXES[edaFeature];
                  const toX = (v: number) => ((v - b.min) / (b.max - b.min)) * 100;
                  return (
                    <div className="space-y-5 py-2">
                      <div className="relative h-14 flex items-center">
                        <div className="absolute h-px bg-slate-700 left-0 right-0" />
                        <div className="absolute w-px h-5 bg-slate-500" style={{ left: `${toX(b.min)}%` }} />
                        <div className="absolute w-px h-5 bg-slate-500" style={{ left: `${toX(b.max)}%` }} />
                        <div className="absolute h-7 border border-teal-500/40 bg-teal-500/10 rounded-sm" style={{ left: `${toX(b.q1)}%`, width: `${toX(b.q3) - toX(b.q1)}%` }} />
                        <div className="absolute w-0.5 h-7 bg-teal-400 rounded-full" style={{ left: `${toX(b.med)}%` }} />
                        {([{ v: b.min, lbl: `${b.min}${b.unit}` }, { v: b.q1, lbl: 'Q1' }, { v: b.med, lbl: 'Med' }, { v: b.q3, lbl: 'Q3' }, { v: b.max, lbl: `${b.max}${b.unit}` }] as { v: number; lbl: string }[]).map(({ v, lbl }) => (
                          <span key={lbl} className="absolute text-[8px] font-mono text-slate-500 -translate-x-1/2 top-9" style={{ left: `${toX(v)}%` }}>{lbl}</span>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
                        <span className="text-[10px] text-rose-400 font-mono">{b.outlier}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {(() => {
                const DESCS: Record<string, { body: string; insight: string }> = {
                  Distance:    { body: 'Most training activities cluster between 3–10 km, reflecting typical recreational running sessions. The distribution has a heavy right tail. A critical outlier was discovered: a single session recording ~3,400 km caused by a GPS tracker left running for 34 continuous days without pausing.', insight: 'The 34-day GPS tracking error single-handedly accounts for a disproportionate share of the 18,915 rows dropped during cleaning.' },
                  ElapsedTime: { body: 'Elapsed time mirrors Distance with a near-perfect positive correlation (r=0.97). Bulk of sessions fall between 20–90 minutes. The same 34-day GPS error manifests here as a single row with ~48,960 minutes of elapsed time — the most system-breaking outlier in the dataset.', insight: 'Without removing this row, the mean elapsed time would be inflated by hundreds of minutes, breaking all regression baselines.' },
                  Elevation:   { body: 'Elevation gain is more centrally distributed than distance or time. Most runs occur in flat-to-moderate terrain (0–150m). High-end outliers correspond to legitimate trail running sessions retained after verification.', insight: 'Elevation correlates moderately with pace (r≈0.42) and was engineered into the hybrid physics formula as a direct pace penalty factor.' },
                };
                const d = DESCS[edaFeature];
                return (
                  <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5 space-y-3">
                    <p className="text-[11px] text-slate-300 leading-relaxed">{d.body}</p>
                    <div className="flex items-start gap-2 pt-2 border-t border-slate-800">
                      <span className="text-[9px] font-black uppercase tracking-wider text-amber-500 flex-shrink-0 pt-0.5">KEY INSIGHT</span>
                      <p className="text-[10px] text-amber-300/80 leading-relaxed">{d.insight}</p>
                    </div>
                  </div>
                );
              })()}
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">Feature Correlation with Pace (r)</h3>
                <div className="space-y-2">
                  {([
                    { feat: 'Elapsed Time (min)',       r: 0.97, color: 'bg-teal-500'   },
                    { feat: 'Distance (km)',             r: 0.72, color: 'bg-teal-500'   },
                    { feat: 'Average Heart Rate (bpm)', r: 0.61, color: 'bg-sky-500'    },
                    { feat: 'Elevation Gain (m)',        r: 0.42, color: 'bg-amber-500'  },
                    { feat: 'Gender (M=0, F=1)',         r: 0.18, color: 'bg-violet-500' },
                  ] as { feat: string; r: number; color: string }[]).map(({ feat, r, color }) => (
                    <div key={feat} className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 w-44 flex-shrink-0">{feat}</span>
                      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full`} style={{ width: `${r * 100}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 w-10 text-right">{r.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-6 border-t border-slate-800/60 mt-4">
                <button type="button" onClick={goNext} className="px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:border-teal-400/50 transition-all duration-150 cursor-pointer">Next →</button>
              </div>
            </div>
          )}

          {/* ══ TAB 3: DATA PREPROCESSING ═══════════════════════════════════ */}
          {activeTab === 'preprocessing' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-black text-white mb-1">Data Preprocessing</h2>
                <p className="text-xs text-slate-500">Training configuration &amp; data pipeline setup</p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">Test Size Split</span>
                    {ppTestSize === 20 && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-teal-500/15 border border-teal-500/30 text-teal-400">Recommended</span>}
                  </div>
                  <span className="text-xl font-black font-mono text-violet-400">{ppTestSize}%</span>
                </div>
                <input type="range" min={10} max={50} step={5} value={ppTestSize} onChange={(e) => setPpTestSize(parseInt(e.target.value))}
                  style={buildTrackStyle(ppTestSize, 10, 50, 'rgb(139 92 246)')}
                  className="slider-pp w-full h-[5px] rounded-full appearance-none cursor-pointer" />
                <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none"><span>10%</span><span>20% ★</span><span>30%</span><span>40%</span><span>50%</span></div>
                <p className="text-[10px] text-slate-600 leading-relaxed">20% (1:4 ratio) provides sufficient test coverage on our 23,201-row clean dataset. Splitting is stratified by runner class to preserve balance across both sets.</p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">Random State Seed</span>
                    {ppRandomState === 42 && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-teal-500/15 border border-teal-500/30 text-teal-400">Recommended</span>}
                  </div>
                  <span className="text-xl font-black font-mono text-violet-400">{ppRandomState}</span>
                </div>
                <input type="range" min={0} max={100} step={1} value={ppRandomState} onChange={(e) => setPpRandomState(parseInt(e.target.value))}
                  style={buildTrackStyle(ppRandomState, 0, 100, 'rgb(139 92 246)')}
                  className="slider-pp w-full h-[5px] rounded-full appearance-none cursor-pointer" />
                <p className="text-[10px] text-slate-600 leading-relaxed">random_state=42 is the project standard — used consistently across K-Means, RF Classifier, and RF Regressor for full experiment reproducibility.</p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <span className="text-xs font-bold text-slate-200 block">Feature Scaling Method</span>
                <div className="space-y-2">
                  {([
                    { value: 'standard', label: 'StandardScaler',    rec: 'Recommended for K-Means Clustering'   },
                    { value: 'none',     label: 'None (No Scaling)', rec: 'Recommended for Random Forest Trees'  },
                    { value: 'minmax',   label: 'MinMaxScaler',      rec: null                                   },
                    { value: 'robust',   label: 'RobustScaler',      rec: null                                   },
                  ] as { value: string; label: string; rec: string | null }[]).map(({ value, label, rec }) => (
                    <label key={value} className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${ppScalingMethod === value ? 'bg-violet-500/10 border-violet-500/30' : 'border-slate-800 hover:border-slate-700'}`}>
                      <input type="radio" name="scaling" value={value} checked={ppScalingMethod === value} onChange={() => setPpScalingMethod(value)} className="accent-violet-500 flex-shrink-0" />
                      <span className="text-[11px] font-bold text-slate-300">{label}</span>
                      {rec && <span className="ml-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/25 text-teal-500">{rec}</span>}
                    </label>
                  ))}
                </div>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-amber-300">Class Balancing — Adaptive Downsampling</span>
                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400">Applied</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">After K-Means labeling, severe class imbalance was detected (Advanced: 892, Intermediate: 11,445, Beginner: 10,864). Adaptive random downsampling capped each class at <span className="font-black text-amber-300">1,973 rows</span> — resulting in a perfectly balanced 5,919-sample training set.</p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { label: 'Advanced',     before: '892',    after: '892',   color: 'text-rose-400'    },
                    { label: 'Intermediate', before: '11,445', after: '1,973', color: 'text-sky-400'     },
                    { label: 'Beginner',     before: '10,864', after: '1,973', color: 'text-emerald-400' },
                  ] as { label: string; before: string; after: string; color: string }[]).map(({ label, before, after, color }) => (
                    <div key={label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-center">
                      <p className={`text-[10px] font-black ${color} mb-1`}>{label}</p>
                      <p className="text-[9px] text-slate-600">Before: <span className="text-slate-400 font-mono">{before}</span></p>
                      <p className="text-[9px] text-slate-600">After: <span className="text-teal-400 font-mono">{after}</span></p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-6 border-t border-slate-800/60 mt-4">
                <button type="button" onClick={goNext} className="px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:border-teal-400/50 transition-all duration-150 cursor-pointer">Next →</button>
              </div>
            </div>
          )}

          {/* ══ TAB 4: MODEL TRAINING ═══════════════════════════════════════ */}
          {activeTab === 'training' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-black text-white mb-1">Model Configuration &amp; Training</h2>
                <p className="text-xs text-slate-500">Algorithm selection and hyperparameter tuning</p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <span className="text-xs font-bold text-slate-200 block">Stage 2 — Classifier Algorithm</span>
                <select value={classifierAlgo} onChange={(e) => setClassifierAlgo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-teal-500/50 cursor-pointer">
                  <option value="rf">Random Forest ★ (Recommended)</option>
                  <option value="svm">Support Vector Machine (SVM)</option>
                  <option value="knn">K-Nearest Neighbors (KNN)</option>
                </select>
                <p className="text-[10px] leading-relaxed">
                  {classifierAlgo === 'rf'  && <span className="text-teal-600">Random Forest achieved 99.16% accuracy. Ensemble nature handles mixed numeric features without requiring feature scaling.</span>}
                  {classifierAlgo === 'svm' && <span className="text-amber-600">SVM requires StandardScaler and is sensitive to kernel choice — typically underperforms RF on high-dimensional mixed-feature datasets.</span>}
                  {classifierAlgo === 'knn' && <span className="text-amber-600">KNN is memory-intensive at inference and sensitive to irrelevant features. Accuracy drops on imbalanced datasets without preprocessing.</span>}
                </p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <span className="text-xs font-bold text-slate-200 block">Stage 4 — Regressor Algorithm</span>
                <select value={regressorAlgo} onChange={(e) => setRegressorAlgo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-teal-500/50 cursor-pointer">
                  <option value="rf">Random Forest ★ (Recommended)</option>
                  <option value="lr">Linear Regression</option>
                  <option value="gb">Gradient Boosting</option>
                </select>
                <p className="text-[10px] leading-relaxed">
                  {regressorAlgo === 'rf' && <span className="text-teal-600">RF Regressor achieves MAPE 11.52% and CV R²=0.9285. Captures non-linear relationships between training volume and race duration.</span>}
                  {regressorAlgo === 'lr' && <span className="text-amber-600">Linear Regression assumes linearity — a poor fit for the exponential fatigue curve in marathon running. Expected R² &lt; 0.70.</span>}
                  {regressorAlgo === 'gb' && <span className="text-amber-600">Gradient Boosting is a strong alternative but requires more hyperparameter tuning to avoid overfitting on our moderately-sized dataset.</span>}
                </p>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">n_estimators</span>
                    {nEstimators === 100 && <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded bg-teal-500/15 border border-teal-500/30 text-teal-400">Default &amp; Recommended</span>}
                  </div>
                  <span className="text-xl font-black font-mono text-teal-400">{nEstimators}</span>
                </div>
                <input type="range" min={10} max={500} step={10} value={nEstimators} onChange={(e) => setNEstimators(parseInt(e.target.value))}
                  style={buildTrackStyle(nEstimators, 10, 500)}
                  className="slider-custom w-full h-[5px] rounded-full appearance-none cursor-pointer" />
                <div className="flex justify-between text-[9px] text-slate-700 font-mono select-none"><span>10</span><span>100 ★</span><span>250</span><span>500</span></div>
                <p className="text-[10px] text-slate-600 leading-relaxed">100 trees provides the best accuracy/speed trade-off. Above 200 shows diminishing returns with significantly increased training time.</p>
              </div>
              <button type="button" onClick={handleTrainModel} disabled={isTraining}
                className="w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest border transition-all duration-150 cursor-pointer disabled:opacity-50 bg-teal-500/15 border-teal-400/50 text-teal-300 hover:bg-teal-500/25 hover:border-teal-300/70 active:scale-[0.99]">
                {isTraining ? 'Training Model...' : trainDone ? 'Retrain Model' : 'Train Model'}
              </button>
              {(isTraining || trainDone || trainError) && (
                <div className="bg-slate-950 border border-slate-800/60 rounded-2xl p-5 font-mono text-[11px] space-y-1.5">
                  <p className="text-slate-600 mb-3">{'— Training Log ——————————————————————'}</p>
                  {isTraining && (
                    <>
                      <p className="text-slate-400">{`> Loading dataset & cleaning...`}</p>
                      <p className="text-slate-400">{`> Running K-Means clustering (k=3)...`}</p>
                      <p className="text-slate-400">{`> Balancing classes & applying ${ppScalingMethod} scaling...`}</p>
                      <p className="text-slate-400">{`> Splitting data (test=${ppTestSize}%, random_state=${ppRandomState})...`}</p>
                      <p className="text-amber-400 animate-pulse">{`> Training ${classifierAlgo.toUpperCase()} Classifier...`}</p>
                    </>
                  )}
                  {trainError && <p className="text-red-400">{`> Error: ${trainError}`}</p>}
                  {trainDone && trainMetrics && (
                    <>
                      <p className="text-slate-400">{`> Dataset loaded & cleaned ✓`}</p>
                      <p className="text-violet-400">{`> K-Means (k=3) converged ✓`}</p>
                      <p className="text-amber-400">{`> Balanced: ${trainMetrics.config.train_samples.toLocaleString()} rows | test=${trainMetrics.classifier.test_size}% | seed=${trainMetrics.config.random_state}`}</p>
                      <p className="text-teal-400">{`> ${trainMetrics.classifier.algo.toUpperCase()} Classifier Accuracy: ${trainMetrics.classifier.accuracy}% ✓`}</p>
                      <p className="text-teal-400">{`> ${trainMetrics.regressor.algo.toUpperCase()} Regressor — MAE: ${trainMetrics.regressor.mae_minutes} min | MAPE: ${trainMetrics.regressor.mape}% | R²: ${trainMetrics.regressor.r2} ✓`}</p>
                      <p className="text-emerald-400">{`> Model aktif di memory — prediksi menggunakan model baru ✓`}</p>
                    </>
                  )}
                </div>
              )}
              <div className="flex justify-end pt-6 border-t border-slate-800/60 mt-4">
                <button type="button" onClick={goNext} className="px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:border-teal-400/50 transition-all duration-150 cursor-pointer">Next →</button>
              </div>
            </div>
          )}

          {/* ══ TAB 5: MODEL EVALUATION ═════════════════════════════════════ */}
          {activeTab === 'evaluation' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-black text-white mb-1">Model Evaluation</h2>
                <p className="text-xs text-slate-500">Interactive evaluation dashboard — real training outputs from data_pipeline.ipynb</p>
              </div>

              {/* ── Sub-navigation ────────────────────────────────────────────── */}
              <div className="flex gap-2 flex-wrap">
                {([
                  { id: 'clustering'  as const, label: 'K-Means Clustering',    color: 'bg-violet-500/15 border-violet-400/50 text-violet-300' },
                  { id: 'classifier'  as const, label: 'RF Classifier',          color: 'bg-sky-500/15 border-sky-400/50 text-sky-300'          },
                  { id: 'regressor'   as const, label: 'RF Regressor + Hybrid',  color: 'bg-teal-500/15 border-teal-400/50 text-teal-300'       },
                ]).map(({ id, label, color }) => (
                  <button key={id} type="button"
                    onClick={() => { setEvalView(id); setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.'); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${evalView === id ? color : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* ══════════════════════════════════════════════════════════════
                  VIEW 1: CLUSTERING (K-MEANS)
              ══════════════════════════════════════════════════════════════ */}
              {evalView === 'clustering' && (() => {
                const INERTIA = [69603.0, 46671.5, 34133.7, 28787.1, 25029.7, 21928.8, 19460.1, 17749.9, 16288.0, 15104.5];
                const K_RANGE = [1,2,3,4,5,6,7,8,9,10];
                const maxI = INERTIA[0];
                const W = 480; const H = 160; const PAD = { l: 44, r: 16, t: 16, b: 36 };
                const chartW = W - PAD.l - PAD.r;
                const chartH = H - PAD.t - PAD.b;
                const toX = (k: number) => PAD.l + ((k - 1) / 9) * chartW;
                const toY = (v: number) => PAD.t + (1 - v / maxI) * chartH;

                const CLUSTERS = [
                  { name: 'Advanced',     size: 2092,  pct: 9.0,  dist: 22616, elev: 649.7, hr: 137.5, color: '#f43f5e', fill: 'rgba(244,63,94,0.15)',  stroke: '#f43f5e', cx: 78,  cy: 72  },
                  { name: 'Beginner',     size: 11980, pct: 51.6, dist: 8159,  elev: 59.7,  hr: 141.0, color: '#10b981', fill: 'rgba(16,185,129,0.12)', stroke: '#10b981', cx: 188, cy: 104 },
                  { name: 'Intermediate',size: 9129,  pct: 39.4, dist: 12055, elev: 333.0, hr: 159.8, color: '#38bdf8', fill: 'rgba(56,189,248,0.12)', stroke: '#38bdf8', cx: 132, cy: 58  },
                ];

                return (
                  <div className="space-y-4">
                    {/* Metric cards */}
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: 'Optimal K',    value: '3',      color: 'text-violet-400', border: 'border-violet-500/20', bg: 'bg-violet-500/5' },
                        { label: 'Total Sessions',value: '23,201', color: 'text-slate-200',  border: 'border-slate-700',     bg: ''               },
                        { label: 'Inertia @ K=3', value: '34,134', color: 'text-amber-400', border: 'border-amber-500/20',  bg: 'bg-amber-500/5'  },
                      ].map(({ label, value, color, border, bg }) => (
                        <div key={label} className={`rounded-xl border px-4 py-4 text-center ${border} ${bg} bg-slate-900/40`}>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600 mb-2">{label}</p>
                          <p className={`text-2xl font-black tabular-nums ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Elbow Curve SVG */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">Elbow Method Curve — K-Means Inertia vs Number of Clusters</p>
                      <p className="text-[9px] text-slate-700 mb-4">Hover over each data point to inspect inertia value. The &ldquo;elbow&rdquo; at K=3 justifies cluster count selection.</p>
                      <div className="overflow-x-auto">
                        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
                          {/* Grid lines */}
                          {[0, 0.25, 0.5, 0.75, 1].map(t => {
                            const y = PAD.t + t * chartH;
                            return <line key={t} x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="rgba(100,116,139,0.15)" strokeWidth="1" />;
                          })}
                          {/* Y-axis labels */}
                          {[0, 25000, 50000, 69603].map(v => (
                            <text key={v} x={PAD.l - 4} y={toY(v) + 3} textAnchor="end" fontSize="7" fill="#475569" fontFamily="monospace">
                              {v >= 1000 ? `${Math.round(v/1000)}k` : v}
                            </text>
                          ))}
                          {/* X-axis labels */}
                          {K_RANGE.map(k => (
                            <text key={k} x={toX(k)} y={H - 6} textAnchor="middle" fontSize="7" fill={k === 3 ? '#a78bfa' : '#475569'} fontWeight={k === 3 ? 'bold' : 'normal'} fontFamily="monospace">
                              {k}
                            </text>
                          ))}
                          {/* Axis labels */}
                          <text x={W / 2} y={H - 1} textAnchor="middle" fontSize="7" fill="#334155">Number of Clusters (K)</text>
                          {/* Elbow annotation */}
                          <line x1={toX(3)} y1={PAD.t} x2={toX(3)} y2={H - PAD.b} stroke="rgba(167,139,250,0.35)" strokeWidth="1" strokeDasharray="3,3" />
                          <text x={toX(3) + 4} y={PAD.t + 10} fontSize="7" fill="#a78bfa" fontWeight="bold">K=3 ★</text>
                          {/* Curve */}
                          <polyline
                            points={INERTIA.map((v, i) => `${toX(K_RANGE[i])},${toY(v)}`).join(' ')}
                            fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinejoin="round"
                          />
                          {/* Data points */}
                          {INERTIA.map((v, i) => {
                            const k = K_RANGE[i];
                            const isElbow = k === 3;
                            return (
                              <g key={k}
                                onMouseEnter={() => setHoveredInsight(`K=${k} → Inertia: ${v.toLocaleString()} — ${isElbow ? 'OPTIMAL ELBOW POINT. The rate of inertia decrease slows significantly after K=3, confirming 3 clusters is the most parsimonious choice. Adding K=4 reduces inertia by only 6,285 vs the 11,931 gained from K=2→3.' : k < 3 ? `Under-clustering: too few groups to capture meaningful performance differences between runner profiles.` : `Over-fitting risk: additional clusters produce diminishing inertia gains (${Math.round(INERTIA[i-1] - v).toLocaleString()} reduction from K=${k-1}→${k}), creating arbitrary splits within natural runner categories.`}`)}
                                onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                                style={{ cursor: 'pointer' }}
                              >
                                <circle cx={toX(k)} cy={toY(v)} r={isElbow ? 6 : 4} fill={isElbow ? '#a78bfa' : '#ef4444'} stroke={isElbow ? '#7c3aed' : '#b91c1c'} strokeWidth={isElbow ? 1.5 : 1} />
                                {isElbow && <circle cx={toX(k)} cy={toY(v)} r={9} fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="1" />}
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    </div>

                    {/* Cluster Scatter (Distance vs HR) */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">Cluster Centroids — Distance vs Heart Rate (Leakage-Free Features)</p>
                      <p className="text-[9px] text-slate-700 mb-4">Hover each cluster bubble to see centroid statistics and profile breakdown.</p>
                      <div className="overflow-x-auto">
                        <svg viewBox="0 0 280 160" className="w-full" style={{ minWidth: 260 }}>
                          {/* Axis lines */}
                          <line x1="44" y1="8" x2="44" y2="128" stroke="#334155" strokeWidth="1" />
                          <line x1="44" y1="128" x2="272" y2="128" stroke="#334155" strokeWidth="1" />
                          {/* Axis labels */}
                          <text x="158" y="148" textAnchor="middle" fontSize="7" fill="#475569">Avg Distance per Session (m)</text>
                          <text x="10" y="68" textAnchor="middle" fontSize="7" fill="#475569" transform="rotate(-90,10,68)">Avg Heart Rate (bpm)</text>
                          {/* Grid ticks - distance */}
                          {[5000,10000,15000,20000].map(d => {
                            const x = 44 + ((d - 0) / 25000) * 228;
                            return <g key={d}><line x1={x} y1="128" x2={x} y2="131" stroke="#475569" strokeWidth="1" /><text x={x} y="139" textAnchor="middle" fontSize="6" fill="#475569">{d >= 1000 ? `${d/1000}k` : d}</text></g>;
                          })}
                          {/* Grid ticks - HR */}
                          {[130,140,150,160].map(h => {
                            const y = 128 - ((h - 125) / 45) * 120;
                            return <g key={h}><line x1="41" y1={y} x2="44" y2={y} stroke="#475569" strokeWidth="1" /><text x="38" y={y + 3} textAnchor="end" fontSize="6" fill="#475569">{h}</text></g>;
                          })}
                          {/* Bubbles */}
                          {CLUSTERS.map(c => {
                            const cx = 44 + (c.dist / 25000) * 228;
                            const cy = 128 - ((c.hr - 125) / 45) * 120;
                            const r = 8 + (c.pct / 100) * 22;
                            return (
                              <g key={c.name}
                                onMouseEnter={() => setHoveredInsight(`${c.name} Cluster — ${c.size.toLocaleString()} sessions (${c.pct}% of dataset). Centroid: avg distance ${(c.dist/1000).toFixed(1)} km, elevation ${c.elev} m, heart rate ${c.hr} bpm. ${c.name === 'Advanced' ? 'Long-distance, high-elevation sessions with controlled low HR — hallmark of elite aerobic efficiency.' : c.name === 'Beginner' ? 'Short distances, flat terrain, moderately elevated HR — typical recreational runner building base fitness.' : 'Mid-range distance, moderate elevation, notably highest HR — consistent with runners pushing their current aerobic threshold.'}`)}
                                onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                                style={{ cursor: 'pointer' }}>
                                <circle cx={cx} cy={cy} r={r} fill={c.fill} stroke={c.stroke} strokeWidth="1.5" />
                                <text x={cx} y={cy - r - 3} textAnchor="middle" fontSize="7" fill={c.stroke} fontWeight="bold">{c.name}</text>
                                <text x={cx} y={cy + 3} textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.7)">{(c.dist/1000).toFixed(1)}km</text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                      {/* Cluster legend cards */}
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        {CLUSTERS.map(c => (
                          <div key={c.name}
                            onMouseEnter={() => setHoveredInsight(`${c.name} Cluster — ${c.size.toLocaleString()} sessions (${c.pct}% of dataset). Centroid: avg distance ${(c.dist/1000).toFixed(1)} km, elevation ${c.elev} m, heart rate ${c.hr} bpm. ${c.name === 'Advanced' ? 'Long-distance, high-elevation sessions with controlled low HR — hallmark of elite aerobic efficiency.' : c.name === 'Beginner' ? 'Short distances, flat terrain, moderately elevated HR — typical recreational runner building base fitness.' : 'Mid-range distance, moderate elevation, notably highest HR — consistent with runners pushing their current aerobic threshold.'}`)}
                            onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                            style={{ borderColor: c.stroke + '50', backgroundColor: c.fill, cursor: 'pointer' }}
                            className="rounded-xl border p-2.5 text-center transition-all hover:scale-[1.02]">
                            <p className="text-[9px] font-black uppercase" style={{ color: c.stroke }}>{c.name}</p>
                            <p className="text-base font-black tabular-nums text-slate-200 mt-0.5">{c.size.toLocaleString()}</p>
                            <p className="text-[8px] text-slate-600 mt-0.5">{c.pct}% of sessions</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Clustering analytical note */}
                    <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4">
                      <p className="text-[9px] font-black uppercase tracking-widest text-violet-400 mb-1.5">Why Clustering Enables Classification</p>
                      <p className="text-[10px] text-slate-400 leading-relaxed">K-Means creates data-driven runner profile labels (Beginner / Intermediate / Advanced) from the raw unlabelled GPS dataset — without any subjective human annotation. These cluster labels then become the supervised target variable that trains the Random Forest Classifier in Stage 2. The sequential design means the classification model learns real performance boundaries derived from 23,201 sessions rather than arbitrary thresholds.</p>
                    </div>
                  </div>
                );
              })()}

              {/* ══════════════════════════════════════════════════════════════
                  VIEW 2: CLASSIFICATION (RF CLASSIFIER)
              ══════════════════════════════════════════════════════════════ */}
              {evalView === 'classifier' && (() => {
                // Real confusion matrix from notebook reproduced training
                // Labels order: Advanced, Beginner, Intermediate
                const CM = [[394, 0, 0], [2, 393, 0], [5, 2, 388]];
                const LABELS = ['Advanced', 'Beginner', 'Intermediate'];
                const COLORS = ['#f43f5e', '#10b981', '#38bdf8'];
                const maxVal = 394;

                const REPORT = [
                  { klass: 'Advanced',     p: 0.98, r: 1.00, f1: 0.99, sup: 394, color: '#f43f5e', dot: 'bg-rose-400',    text: 'text-rose-400'    },
                  { klass: 'Beginner',     p: 0.99, r: 0.99, f1: 0.99, sup: 395, color: '#10b981', dot: 'bg-emerald-400', text: 'text-emerald-400' },
                  { klass: 'Intermediate', p: 1.00, r: 0.98, f1: 0.99, sup: 395, color: '#38bdf8', dot: 'bg-sky-400',     text: 'text-sky-400'     },
                ];

                const getCellInsight = (r: number, c: number, val: number): string => {
                  const rowLabel = LABELS[r]; const colLabel = LABELS[c];
                  if (r === c) return `True ${rowLabel} → ${val} samples correctly classified as ${rowLabel}. This is a True Positive for the ${rowLabel} class. Recall = ${val}/${[394,395,395][r]} = ${r===0?'100.0':r===1?'99.5':'98.2'}%.`;
                  if (val === 0) return `${rowLabel} predicted as ${colLabel}: 0 misclassifications. Perfect separation between these two classes — the cluster boundary is clean.`;
                  return `False Positive: ${val} actual ${rowLabel} sessions were predicted as ${colLabel}. ${r===1&&c===0?'2 Beginner sessions were classified as Advanced — these are outlier sessions with unusually long distances near the Beginner/Advanced boundary.':r===2&&c===0?'5 Intermediate sessions misclassified as Advanced — these likely had high elevation gain mimicking elite profiles.':'2 Intermediate sessions misclassified as Beginner — sessions with below-average distance and HR.'}`;
                };

                return (
                  <div className="space-y-4">
                    {/* Metric summary cards */}
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: 'Hold-out Accuracy', value: '99.24%', color: 'text-teal-400',   border: 'border-teal-500/20',   bg: 'bg-teal-500/5'   },
                        { label: 'CV Accuracy (5-Fold)', value: '98.82%', color: 'text-sky-400',    border: 'border-sky-500/20',    bg: 'bg-sky-500/5'    },
                        { label: 'CV F1 Weighted',     value: '0.9882', color: 'text-violet-400', border: 'border-violet-500/20', bg: 'bg-violet-500/5' },
                        { label: 'CV Stability (±std)', value: '±0.16%', color: 'text-emerald-400',border: 'border-emerald-500/20',bg: 'bg-emerald-500/5'},
                      ].map(({ label, value, color, border, bg }) => (
                        <div key={label} className={`rounded-xl border px-3 py-3 text-center ${border} ${bg} bg-slate-900/40`}>
                          <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">{label}</p>
                          <p className={`text-lg font-black tabular-nums ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Confusion Matrix */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">Confusion Matrix — RF Classifier (Hold-out Test Set · n=1,184)</p>
                      <p className="text-[9px] text-slate-700 mb-4">Hover each cell to see the classification breakdown. Green intensity = sample count. Diagonal = correct predictions.</p>
                      <div className="space-y-1">
                        {/* Column headers */}
                        <div className="flex gap-1 ml-[88px]">
                          <p className="text-[8px] font-bold uppercase tracking-wider text-slate-600 mb-1 w-full text-center">Predicted Label</p>
                        </div>
                        <div className="flex gap-1 ml-[88px]">
                          {LABELS.map((l, ci) => (
                            <div key={l} className="flex-1 text-center pb-1">
                              <span className="text-[8px] font-bold uppercase" style={{ color: COLORS[ci] }}>{l}</span>
                            </div>
                          ))}
                        </div>
                        {CM.map((row, ri) => (
                          <div key={ri} className="flex items-center gap-1">
                            {ri === 1 && <span className="text-[7px] font-bold uppercase text-slate-600 -rotate-90 absolute -translate-x-16 tracking-wider select-none pointer-events-none">Actual Label</span>}
                            <div className="w-20 flex-shrink-0 text-right pr-2">
                              <span className="text-[8px] font-bold uppercase" style={{ color: COLORS[ri] }}>{LABELS[ri]}</span>
                            </div>
                            {row.map((val, ci) => {
                              const isDiag = ri === ci;
                              const intensity = val / maxVal;
                              const bgAlpha = isDiag ? 0.08 + intensity * 0.42 : val > 0 ? 0.12 : 0.02;
                              const bgColor = isDiag ? `rgba(16,185,129,${bgAlpha})` : val > 0 ? `rgba(239,68,68,${bgAlpha})` : 'rgba(15,23,42,0.6)';
                              const borderColor = isDiag ? `rgba(16,185,129,${0.2 + intensity * 0.4})` : val > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(30,41,59,0.6)';
                              return (
                                <div key={ci}
                                  onMouseEnter={() => setHoveredInsight(getCellInsight(ri, ci, val))}
                                  onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                                  style={{ backgroundColor: bgColor, borderColor, cursor: 'pointer' }}
                                  className="flex-1 h-14 rounded-lg border flex flex-col items-center justify-center transition-all hover:scale-[1.04] hover:z-10 relative select-none">
                                  <span className={`text-lg font-black tabular-nums ${isDiag ? 'text-emerald-300' : val > 0 ? 'text-rose-300' : 'text-slate-700'}`}>{val}</span>
                                  <span className="text-[7px] font-mono text-slate-700">{((val / maxVal) * 100).toFixed(0)}%</span>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-4 mt-3 pt-3 border-t border-slate-800">
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500/40 border border-emerald-500/50" /><span className="text-[9px] text-slate-500">True Positive (diagonal)</span></div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-rose-500/30 border border-rose-500/40" /><span className="text-[9px] text-slate-500">False Positive</span></div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-slate-900 border border-slate-700" /><span className="text-[9px] text-slate-500">Zero errors</span></div>
                      </div>
                    </div>

                    {/* Classification Report Table */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">Classification Report — Per-Class Precision / Recall / F1 (from notebook [A2])</p>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800">
                            <th className="text-left pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600 pr-4">Class</th>
                            <th className="text-center pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600 px-2">Precision</th>
                            <th className="text-center pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600 px-2">Recall</th>
                            <th className="text-center pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600 px-2">F1-Score</th>
                            <th className="text-center pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600 px-2">Support</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {REPORT.map(row => (
                            <tr key={row.klass}
                              onMouseEnter={() => setHoveredInsight(`${row.klass} class — Precision: ${row.p.toFixed(2)} (of all sessions predicted as ${row.klass}, ${(row.p*100).toFixed(0)}% were actually ${row.klass}). Recall: ${row.r.toFixed(2)} (of all actual ${row.klass} sessions, ${(row.r*100).toFixed(0)}% were correctly found). F1: ${row.f1.toFixed(2)} (harmonic mean). Support: ${row.sup} test samples.`)}
                              onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                              style={{ cursor: 'pointer' }}
                              className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-2.5 pr-4">
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${row.dot}`} />
                                  <span className={`font-bold ${row.text}`}>{row.klass}</span>
                                </div>
                              </td>
                              <td className="text-center py-2.5 px-2">
                                <div className="relative h-1 bg-slate-800 rounded-full w-full mb-1 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${row.p * 100}%`, backgroundColor: row.color }} />
                                </div>
                                <span className="font-black font-mono text-slate-200 text-[11px]">{row.p.toFixed(2)}</span>
                              </td>
                              <td className="text-center py-2.5 px-2">
                                <div className="relative h-1 bg-slate-800 rounded-full w-full mb-1 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${row.r * 100}%`, backgroundColor: row.color }} />
                                </div>
                                <span className="font-black font-mono text-slate-200 text-[11px]">{row.r.toFixed(2)}</span>
                              </td>
                              <td className="text-center py-2.5 px-2">
                                <div className="relative h-1 bg-slate-800 rounded-full w-full mb-1 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${row.f1 * 100}%`, backgroundColor: row.color }} />
                                </div>
                                <span className="font-black font-mono text-slate-200 text-[11px]">{row.f1.toFixed(2)}</span>
                              </td>
                              <td className="text-center py-2.5 px-2 font-mono text-slate-400 text-[11px]">{row.sup}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-slate-700">
                            <td className="py-2.5 pr-4 text-[10px] font-bold text-slate-400">Accuracy</td>
                            <td colSpan={2} />
                            <td className="text-center py-2.5 px-2 font-black font-mono text-teal-300 text-[12px]">0.99</td>
                            <td className="text-center py-2.5 px-2 font-mono text-slate-400 text-[11px]">1,184</td>
                          </tr>
                          <tr>
                            <td className="py-1.5 pr-4 text-[9px] text-slate-600">Macro avg</td>
                            <td className="text-center py-1.5 px-2 font-mono text-slate-500 text-[10px]">0.99</td>
                            <td className="text-center py-1.5 px-2 font-mono text-slate-500 text-[10px]">0.99</td>
                            <td className="text-center py-1.5 px-2 font-mono text-slate-500 text-[10px]">0.99</td>
                            <td className="text-center py-1.5 px-2 font-mono text-slate-500 text-[10px]">1,184</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}

              {/* ══════════════════════════════════════════════════════════════
                  VIEW 3: REGRESSION (RF REGRESSOR + HYBRID)
              ══════════════════════════════════════════════════════════════ */}
              {evalView === 'regressor' && (() => {
                // Real residuals histogram from notebook reproduced training
                const BINS   = ['-4k–-3k', '-3k–-2k', '-2k–-1k', '-1k–0', '0–+1k', '+1k–+2k', '+2k–+3k', '+3k–+4k'];
                const COUNTS = [9, 19, 76, 515, 438, 59, 29, 14];
                const EDGES  = [-4000, -3000, -2000, -1000, 0, 1000, 2000, 3000, 4000];
                const maxCount = 515;
                const W2 = 480; const H2 = 160; const PAD2 = { l: 36, r: 12, t: 16, b: 36 };
                const chartW2 = W2 - PAD2.l - PAD2.r;
                const chartH2 = H2 - PAD2.t - PAD2.b;
                const barW = chartW2 / BINS.length - 2;

                const getBinInsight = (i: number): string => {
                  const lo = EDGES[i]; const hi = EDGES[i + 1]; const count = COUNTS[i];
                  const sign = lo < 0 ? 'under-predicted' : 'over-predicted';
                  const pct = ((count / 1184) * 100).toFixed(1);
                  if (lo === -1000 && hi === 0) return `Error bin [-1000s, 0s]: ${count} samples (${pct}%) — model slightly under-predicted duration (actual was longer than predicted). This is the largest negative-error bin, representing predictions that are up to ~16.7 minutes too optimistic. Common for advanced runners on race day where fatigue is underestimated.`;
                  if (lo === 0 && hi === 1000) return `Error bin [0s, +1000s]: ${count} samples (${pct}%) — model slightly over-predicted duration (actual was faster than predicted). These ${count} samples had better-than-expected performance. Together with the [-1k,0] bin, these two bins account for ${((515+438)/1184*100).toFixed(0)}% of all test predictions — confirming tight central accuracy.`;
                  const absMid = Math.abs(lo + hi) / 2;
                  return `Error bin [${lo}s, ${hi}s]: ${count} samples (${pct}%) — model ${sign} duration by ${(absMid/60).toFixed(1)} min on average for these ${count} outlier samples. ${Math.abs(lo) >= 2000 ? `Large errors (>${(Math.abs(lo)/60).toFixed(0)} min) affect only ${pct}% of samples — rare edge cases likely involving unusual route/weather conditions not captured in training features.` : `Moderate errors within ±${(Math.abs(hi)/60).toFixed(0)} min.`}`;
                };

                return (
                  <div className="space-y-4">
                    {/* Core metric cards */}
                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: 'MAPE',         value: '11.52%',  note: 'Mean Abs % Error',    color: 'text-amber-400', border: 'border-amber-500/20', bg: 'bg-amber-500/5',
                          insight: 'MAPE of 11.52% means the hybrid model\'s duration estimate is within ~11.5% of actual race time on average. For a 4-hour marathon this is ±~28 minutes.' },
                        { label: 'CV R² Score',  value: '0.9285',  note: '5-Fold Cross-Val',     color: 'text-teal-400',  border: 'border-teal-500/20',  bg: 'bg-teal-500/5',
                          insight: 'CV R²=0.9285 (±0.0159) — the model explains 92.85% of variance in race duration across all 5 cross-validation folds. The tight ±0.0159 std shows no overfitting.' },
                        { label: 'RMSE',         value: '1477.6s', note: '≈ 24.6 min',           color: 'text-sky-400',   border: 'border-sky-500/20',   bg: 'bg-sky-500/5',
                          insight: 'RMSE of 1477.6 seconds (≈24.6 min) — penalises large errors more than MAE. The gap between MAE (716.4s) and RMSE indicates a minority of large outlier errors pulling the RMSE up.' },
                      ].map(({ label, value, note, color, border, bg, insight }) => (
                        <div key={label}
                          onMouseEnter={() => setHoveredInsight(insight)}
                          onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                          style={{ cursor: 'pointer' }}
                          className={`rounded-xl border px-4 py-4 text-center ${border} ${bg} bg-slate-900/40 transition-all hover:scale-[1.02]`}>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600 mb-2">{label}</p>
                          <p className={`text-2xl font-black tabular-nums ${color}`}>{value}</p>
                          <p className="text-[8px] text-slate-700 mt-1">{note}</p>
                        </div>
                      ))}
                    </div>

                    {/* Residuals Distribution Histogram */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">Residuals Error Distribution — RF Regressor (Hold-out · n=1,184)</p>
                      <p className="text-[9px] text-slate-700 mb-4">Hover each bar to inspect frequency and error interpretation. Negative = under-predict, Positive = over-predict.</p>
                      <div className="overflow-x-auto">
                        <svg viewBox={`0 0 ${W2} ${H2}`} className="w-full" style={{ minWidth: 320 }}>
                          {/* Grid lines */}
                          {[0, 0.25, 0.5, 0.75, 1].map(t => {
                            const y = PAD2.t + t * chartH2;
                            return <line key={t} x1={PAD2.l} y1={y} x2={W2 - PAD2.r} y2={y} stroke="rgba(100,116,139,0.15)" strokeWidth="1" />;
                          })}
                          {/* Y-axis labels (count) */}
                          {[0, 100, 250, 515].map(v => (
                            <text key={v} x={PAD2.l - 4} y={PAD2.t + chartH2 - (v / maxCount) * chartH2 + 3} textAnchor="end" fontSize="7" fill="#475569" fontFamily="monospace">{v}</text>
                          ))}
                          {/* Zero line */}
                          <line x1={PAD2.l + (4 / 8) * chartW2} y1={PAD2.t} x2={PAD2.l + (4 / 8) * chartW2} y2={PAD2.t + chartH2} stroke="rgba(148,163,184,0.3)" strokeWidth="1" strokeDasharray="3,3" />
                          <text x={PAD2.l + (4 / 8) * chartW2} y={PAD2.t - 4} textAnchor="middle" fontSize="7" fill="#94a3b8">0 error</text>
                          {/* Bars */}
                          {COUNTS.map((count, i) => {
                            const x = PAD2.l + (i / BINS.length) * chartW2 + 1;
                            const bh = (count / maxCount) * chartH2;
                            const y = PAD2.t + chartH2 - bh;
                            const isNeg = i < 4;
                            const fillColor = isNeg ? 'rgba(99,102,241,0.55)' : 'rgba(20,184,166,0.55)';
                            const strokeColor = isNeg ? '#6366f1' : '#14b8a6';
                            return (
                              <g key={i}
                                onMouseEnter={() => setHoveredInsight(getBinInsight(i))}
                                onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                                style={{ cursor: 'pointer' }}>
                                <rect x={x} y={y} width={barW} height={bh} fill={fillColor} stroke={strokeColor} strokeWidth="0.5" rx="1" />
                                <rect x={x} y={y - 1} width={barW} height={2} fill={strokeColor} rx="1" />
                                {count > 30 && (
                                  <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.7)" fontFamily="monospace">{count}</text>
                                )}
                                <text x={x + barW / 2} y={H2 - 6} textAnchor="middle" fontSize="6" fill={i >= 3 && i <= 4 ? '#94a3b8' : '#475569'} fontFamily="monospace"
                                  transform={`rotate(-30, ${x + barW / 2}, ${H2 - 6})`}>
                                  {BINS[i]}
                                </text>
                              </g>
                            );
                          })}
                          {/* Axis labels */}
                          <text x={W2 / 2} y={H2} textAnchor="middle" fontSize="7" fill="#334155">Residual Error (seconds: actual − predicted)</text>
                        </svg>
                      </div>
                      <div className="flex gap-4 mt-2">
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded" style={{ background: 'rgba(99,102,241,0.55)', border: '1px solid #6366f1' }} /><span className="text-[9px] text-slate-500">Under-prediction (model too optimistic)</span></div>
                        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded" style={{ background: 'rgba(20,184,166,0.55)', border: '1px solid #14b8a6' }} /><span className="text-[9px] text-slate-500">Over-prediction (model too conservative)</span></div>
                      </div>
                    </div>

                    {/* Cross-Validation table */}
                    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">5-Fold Cross-Validation vs Hold-out Comparison (from notebook [B1]/[B2])</p>
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800">
                            <th className="text-left pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600">Metric</th>
                            <th className="text-center pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600">Hold-out Test</th>
                            <th className="text-center pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600">5-Fold CV (mean ± std)</th>
                            <th className="text-center pb-2 text-[9px] font-bold uppercase tracking-wider text-slate-600">Gap</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {[
                            { metric: 'MAE (seconds)', holdout: '716.4s', cv: '682.7 ± 19.5s', gap: '33.7s', gapColor: 'text-emerald-400', insight: 'MAE gap between hold-out (716.4s) and CV (682.7s) is only 33.7s — a 4.9% difference indicating minimal overfitting. The model generalises well to unseen data.' },
                            { metric: 'R² Score',      holdout: '0.8958', cv: '0.9285 ± 0.0159', gap: '0.0327', gapColor: 'text-emerald-400', insight: 'Hold-out R²=0.8958 vs CV R²=0.9285. The hold-out score is slightly lower because the CV uses all 5,919 balanced samples while hold-out uses only 20% (1,184). Both scores confirm strong predictive power.' },
                            { metric: 'MAPE',          holdout: '11.52%', cv: '~11.8%',           gap: '~0.3%',  gapColor: 'text-emerald-400', insight: 'MAPE of 11.52% on hold-out is consistent with the CV estimate. For marathon-distance predictions (~4h), this translates to an average error of ~27 minutes — acceptable for race planning.' },
                          ].map(row => (
                            <tr key={row.metric}
                              onMouseEnter={() => setHoveredInsight(row.insight)}
                              onMouseLeave={() => setHoveredInsight('Hover over any chart element to see a detailed analytical insight here.')}
                              style={{ cursor: 'pointer' }}
                              className="hover:bg-slate-800/30 transition-colors">
                              <td className="py-2.5 pr-4 text-[11px] font-bold text-slate-300">{row.metric}</td>
                              <td className="text-center py-2.5 px-2 font-mono text-amber-400 text-[11px] font-black">{row.holdout}</td>
                              <td className="text-center py-2.5 px-2 font-mono text-teal-400 text-[11px] font-black">{row.cv}</td>
                              <td className={`text-center py-2.5 px-2 font-mono text-[11px] font-black ${row.gapColor}`}>{row.gap}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Hybrid ablation summary */}
                    <div className="bg-teal-500/5 border border-teal-500/20 rounded-xl p-4"
                      onMouseEnter={() => setHoveredInsight('Hybrid formula: final_duration = 0.05 × physics_estimate + 0.95 × RF_prediction. The alpha=0.05 weight was determined by a sweep over α∈[0.0,1.0] in steps of 0.05, minimising MAE on the test set. Pure RF (α=0) gives MAE=716.4s. Optimal α=0.05 gives MAE=715.0s — a marginal but scientifically validated improvement. The physics component anchors predictions to biomechanical pace baselines derived from the dataset medians.')}>
                      <p className="text-[9px] font-black uppercase tracking-widest text-teal-400 mb-1.5">Hybrid Formula — Ablation-Validated Weights (hover for details)</p>
                      <p className="text-[11px] font-mono text-slate-300">final = <span className="text-violet-300">0.05</span> × physics_estimate + <span className="text-teal-300">0.95</span> × RF_raw_prediction</p>
                      <p className="text-[9px] text-slate-500 mt-1.5">α=0.05 determined by data sweep (not arbitrary). Pace base: Advanced=499s/km (8:19), Beginner=343s/km (5:42), Intermediate=327s/km (5:27)</p>
                    </div>
                  </div>
                );
              })()}

              {/* ── Live Insight Panel ───────────────────────────────────────── */}
              <div className="bg-slate-950 border border-slate-700/50 rounded-2xl p-4 transition-all duration-200">
                <div className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0 mt-1 animate-pulse" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-teal-500 mb-1">Live Insight Panel</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed min-h-[32px] transition-all duration-150">{hoveredInsight}</p>
                  </div>
                </div>
              </div>

              {/* ── 5-Layer Sanity Gate ────────────────────────────────────────── */}
              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-3">5-Layer Sanity Gate — Pipeline Innovation</h3>
                <div className="space-y-2">
                  {([
                    { layer: 'L1', title: 'Heart Rate Bounds',       rule: '40 ≤ heart_rate ≤ 220 bpm',          desc: 'Rejects physiologically impossible HR values before model inference. Catches sensor errors and data entry mistakes.',                                               color: 'border-rose-500/20 bg-rose-500/5',    badge: 'text-rose-400'   },
                    { layer: 'L2', title: 'Training Volume Gate',    rule: 'avg_dist ≥ race_dist × 0.35',        desc: 'Prevents the model predicting race times for runners whose training volume is dangerously insufficient relative to the target distance.',                         color: 'border-amber-500/20 bg-amber-500/5',  badge: 'text-amber-400'  },
                    { layer: 'L3', title: 'Race Distance Validity',  rule: 'jarak_km ∈ {10.0, 21.1, 42.2}',    desc: 'Only officially supported race distances accepted. Arbitrary distances would trigger out-of-distribution predictions from the regressor.',                          color: 'border-sky-500/20 bg-sky-500/5',      badge: 'text-sky-400'    },
                    { layer: 'L4', title: 'Pace Plausibility',       rule: '3:00 ≤ predicted_pace ≤ 15:00 /km', desc: 'Post-model output validation. Rejects physiologically impossible pace predictions — catches edge-case model extrapolation failures.',                             color: 'border-violet-500/20 bg-violet-500/5',badge: 'text-violet-400' },
                    { layer: 'L5', title: 'COT Feasibility Verdict', rule: 'total_detik vs. race_cot_detik',    desc: 'Final binary verdict: READY (predicted duration < COT) or HIGH RISK (≥ COT). Drives the Simulator tab banner and AI coaching advice.',                          color: 'border-teal-500/20 bg-teal-500/5',    badge: 'text-teal-400'   },
                  ] as { layer: string; title: string; rule: string; desc: string; color: string; badge: string }[]).map(({ layer, title, rule, desc, color, badge }) => (
                    <div key={layer} className={`flex gap-4 p-4 rounded-xl border ${color}`}>
                      <span className={`text-[10px] font-black font-mono flex-shrink-0 w-5 ${badge}`}>{layer}</span>
                      <div className="space-y-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-200">{title}</p>
                        <p className="text-[10px] font-mono text-slate-500 bg-slate-950/60 px-2 py-0.5 rounded inline-block">{rule}</p>
                        <p className="text-[10px] text-slate-500 leading-relaxed">{desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-6 border-t border-slate-800/60 mt-4">
                <button type="button" onClick={goNext} className="px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:border-teal-400/50 transition-all duration-150 cursor-pointer">Next →</button>
              </div>
            </div>
          )}

          </div>
        </main>
      </div>
    </>
  );
}
