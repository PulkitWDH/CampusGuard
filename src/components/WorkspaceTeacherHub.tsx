import { useState } from 'react';
import { BookOpen, CheckCircle2, Mail, Mic, RefreshCw, Users, Volume2 } from 'lucide-react';
import type {
  ClassroomCamera,
  IncidentAlert,
  WorkspaceCourse,
  WorkspaceGmailMessage,
  WorkspaceTeacher,
} from '../types';
import { openRawMediaStream } from '../utils/mediaCapture';
import {
  DEFAULT_DB_CALIBRATION_OFFSET,
  SOUND_ALERT_THRESHOLD_DB,
  computeCalibratedOffsetFromDbfs,
  computeSplDecibels,
} from '../utils/monitoringLogic';
import { GoogleSignInButton } from './GoogleSignInButton';

interface WorkspaceTeacherHubProps {
  userEmail: string | null;
  userName: string | null;
  hasAccessToken: boolean;
  isSigningIn: boolean;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  defaultTeacherEmail: string;
  onSaveTeacherEmail: (email: string) => void;
  courses: WorkspaceCourse[];
  linkedCourseId: string;
  onSelectCourse: (course: WorkspaceCourse) => void;
  courseTeachers: WorkspaceTeacher[];
  courseStudentCount: number | null;
  gmailMessages: WorkspaceGmailMessage[];
  loadingWorkspace: boolean;
  workspaceError: string | null;
  onRefreshWorkspace: () => Promise<void>;
  cameras: ClassroomCamera[];
  soundAlerts: IncidentAlert[];
  dbCalibrationOffset: number;
  onChangeDbCalibrationOffset: (offset: number) => void;
  onOpenDispatchModal: (alert: IncidentAlert) => void;
}

export function WorkspaceTeacherHub({
  userEmail,
  userName,
  hasAccessToken,
  isSigningIn,
  onGoogleSignIn,
  onSignOut,
  defaultTeacherEmail,
  onSaveTeacherEmail,
  courses,
  linkedCourseId,
  onSelectCourse,
  courseTeachers,
  courseStudentCount,
  gmailMessages,
  loadingWorkspace,
  workspaceError,
  onRefreshWorkspace,
  cameras,
  soundAlerts,
  dbCalibrationOffset,
  onChangeDbCalibrationOffset,
  onOpenDispatchModal,
}: WorkspaceTeacherHubProps) {
  const [emailDraft, setEmailDraft] = useState(defaultTeacherEmail);
  const [savedNotice, setSavedNotice] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationStatus, setCalibrationStatus] = useState<string | null>(null);
  const [liveCalibrationDb, setLiveCalibrationDb] = useState<number | null>(null);

  const handleAutoCalibrateMic = async () => {
    setCalibrationStatus(null);
    setIsCalibrating(true);
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    try {
      stream = await openRawMediaStream({ includeVideo: false });
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Browser AudioContext is unavailable for calibration.');
      }
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);

      const dbfsSamples: number[] = [];
      await new Promise<void>((resolve) => {
        let count = 0;
        const timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buffer);
          let sumSq = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            sumSq += buffer[i] * buffer[i];
          }
          const rms = Math.sqrt(sumSq / buffer.length);
          if (rms > 1e-6) {
            dbfsSamples.push(20 * Math.log10(rms));
          }
          setLiveCalibrationDb(computeSplDecibels(buffer, dbCalibrationOffset));
          count += 1;
          if (count >= 15) {
            window.clearInterval(timer);
            resolve();
          }
        }, 100);
      });

      if (dbfsSamples.length === 0) {
        setCalibrationStatus('No microphone signal detected. Speak or check mic mute switch.');
      } else {
        const avgDbfs = dbfsSamples.reduce((a, b) => a + b, 0) / dbfsSamples.length;
        const nextOffset = computeCalibratedOffsetFromDbfs(avgDbfs, 42);
        onChangeDbCalibrationOffset(nextOffset);
        setCalibrationStatus(
          `Calibrated room noise floor to ~42 dB SPL (raw ${avgDbfs.toFixed(1)} dBFS -> offset +${nextOffset} dB).`
        );
      }
    } catch (err) {
      setCalibrationStatus(
        err instanceof Error
          ? err.message
          : 'Unable to access microphone for auto-calibration.'
      );
    } finally {
      if (audioCtx) {
        void audioCtx.close().catch(() => {});
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setIsCalibrating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">
            Teacher Alerts · Classroom &amp; Gmail
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatically alerts the assigned teacher whenever sustained sound exceeds{' '}
            <span className="font-mono font-semibold text-red-400 tabular-nums">
              {SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB
            </span>{' '}
            for &gt;3s or real-time AI detects a critical threat.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasAccessToken && userEmail ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void onRefreshWorkspace();
                }}
                disabled={loadingWorkspace}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-[#182130] text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingWorkspace ? 'animate-spin' : ''}`} aria-hidden="true" />
                <span>Sync Classroom &amp; Gmail</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void onSignOut();
                }}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-[#111722] text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Sign out ({userName || userEmail})
              </button>
            </>
          ) : (
            <GoogleSignInButton
              compact
              loading={isSigningIn}
              onClick={() => {
                void onGoogleSignIn();
              }}
            />
          )}
        </div>
      </div>

      {workspaceError ? (
        <div role="alert" className="bg-amber-950/60 border border-amber-700/70 text-amber-100 rounded-xl px-4 py-3 text-xs">
          {workspaceError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Acoustic 90.1 dB (>3s) Teacher Rule Card */}
        <section className="bg-[#111722] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-100">
                90.1 dB (&gt;3s) Teacher Sound Alert Rule
              </h2>
            </div>
            <span className="font-mono text-[11px] font-semibold text-red-300 bg-red-950/70 border border-red-800/70 rounded px-2 py-0.5 tabular-nums">
              &gt; {SOUND_ALERT_THRESHOLD_DB.toFixed(1)} dB · 3s
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Every live zone microphone is continuously measured in decibels. If any monitored feed stays above{' '}
            <strong className="text-slate-200">90.1 dB for more than 3 seconds</strong>, an urgent alert pops up on screen and prepares a teacher message with one-click Gmail or Google Classroom dispatch.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSaveTeacherEmail(emailDraft.trim());
              setSavedNotice(true);
              setTimeout(() => setSavedNotice(false), 2500);
            }}
            className="space-y-2"
          >
            <label htmlFor="default-teacher-email" className="block text-xs font-medium text-slate-300">
              Teacher Alert Recipient Email
            </label>
            <div className="flex items-center gap-2">
              <input
                id="default-teacher-email"
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="teacher@school.edu"
                className="flex-1 min-w-0 text-sm px-3 py-2 border border-slate-700 bg-[#0D121B] rounded-lg text-slate-100 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-blue-500"
              />
              <button
                type="submit"
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 cursor-pointer shrink-0"
              >
                Save Email
              </button>
            </div>
            {savedNotice ? (
              <p className="text-xs text-emerald-400 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Teacher email updated.</span>
              </p>
            ) : null}
          </form>

          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="hub-db-offset" className="text-xs font-medium text-slate-300">
                Mic dB Sensitivity Offset (default +{DEFAULT_DB_CALIBRATION_OFFSET} dB)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-semibold text-slate-100 tabular-nums" data-testid="hub-db-offset-value">
                  +{dbCalibrationOffset} dB
                </span>
                {dbCalibrationOffset !== DEFAULT_DB_CALIBRATION_OFFSET ? (
                  <button
                    type="button"
                    onClick={() => onChangeDbCalibrationOffset(DEFAULT_DB_CALIBRATION_OFFSET)}
                    className="text-xs text-blue-400 hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
            <input
              id="hub-db-offset"
              type="range"
              min={85}
              max={120}
              step={1}
              value={dbCalibrationOffset}
              onChange={(e) => onChangeDbCalibrationOffset(Number(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  void handleAutoCalibrateMic();
                }}
                disabled={isCalibrating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-[#182130] text-slate-200 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                <span>
                  {isCalibrating
                    ? `Sampling mic (${liveCalibrationDb?.toFixed(1) ?? '--'} dB)...`
                    : 'Auto-Calibrate Room Mic (~42 dB)'}
                </span>
              </button>
              <span className="text-[11px] text-slate-400">
                Keep room quiet for 1.5s while calibrating
              </span>
            </div>
            {calibrationStatus ? (
              <p role="status" className="text-xs text-slate-200 bg-[#0D121B] border border-slate-800 rounded-md px-2.5 py-1.5">
                {calibrationStatus}
              </p>
            ) : null}
          </div>

          <div className="border-t border-slate-800 pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Live Zone Sound Levels ({cameras.length} active)
            </h3>
            {cameras.length === 0 ? (
              <p className="text-xs text-slate-500">Connect a camera microphone to monitor dB levels.</p>
            ) : (
              <ul className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden bg-[#0D121B]">
                {cameras.map((cam) => {
                  const exceeded = cam.audioLevel > SOUND_ALERT_THRESHOLD_DB;
                  return (
                    <li
                      key={cam.id}
                      className="flex items-center justify-between text-xs py-2 px-3"
                    >
                      <span className="font-medium text-slate-200 truncate">{cam.classroomName}</span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          exceeded ? 'text-red-400' : 'text-slate-300'
                        }`}
                      >
                        {cam.audioLevel.toFixed(1)} dB
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Google Classroom Card */}
        <section className="bg-[#111722] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-100">
                Google Classroom Link
              </h2>
            </div>
            {courseStudentCount !== null ? (
              <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-slate-300 bg-[#0D121B] border border-slate-800 rounded px-2 py-0.5 tabular-nums">
                <Users className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <span>{courseStudentCount} enrolled</span>
              </span>
            ) : null}
          </div>

          {!hasAccessToken ? (
            <div className="border border-dashed border-slate-700 bg-[#0D121B] rounded-lg p-6 text-center space-y-3">
              <p className="text-xs text-slate-400">
                Sign in with Google to load your Google Classroom classes, teachers, and student rosters.
              </p>
              <div className="flex justify-center">
                <GoogleSignInButton
                  compact
                  loading={isSigningIn}
                  onClick={() => {
                    void onGoogleSignIn();
                  }}
                />
              </div>
            </div>
          ) : courses.length === 0 ? (
            <p className="text-xs text-slate-400">
              No active Google Classroom courses returned for this account. Click Sync Classroom &amp; Gmail to refresh.
            </p>
          ) : (
            <div className="space-y-3">
              <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden max-h-52 overflow-y-auto bg-[#0D121B]">
                {courses.map((course) => {
                  const isLinked = course.id === linkedCourseId;
                  return (
                    <li key={course.id}>
                      <button
                        type="button"
                        onClick={() => onSelectCourse(course)}
                        className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          isLinked ? 'bg-blue-600/20 text-blue-200' : 'hover:bg-slate-800/70 text-slate-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{course.name}</div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {[course.section, course.room].filter(Boolean).join(' · ') || 'Google Classroom'}
                          </div>
                        </div>
                        <span className="text-xs font-medium shrink-0 text-blue-400">
                          {isLinked ? 'Linked' : 'Select'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {courseTeachers.length > 0 ? (
                <div className="bg-[#0D121B] border border-slate-800 rounded-lg p-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Course Teachers (click to set alert email)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {courseTeachers.map((t) => (
                      <button
                        key={t.userId}
                        type="button"
                        disabled={!t.email}
                        onClick={() => {
                          if (t.email) {
                            setEmailDraft(t.email);
                            onSaveTeacherEmail(t.email);
                          }
                        }}
                        className="text-xs px-2.5 py-1 rounded border border-slate-700 bg-[#182130] text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                      >
                        {t.name}{t.email ? ` (${t.email})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {/* Sound Threshold Alerts Ready for Teacher */}
      <section className="bg-[#111722] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Recent &gt; 90.1 dB (3s) Teacher Alert Messages
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Review triggered sustained decibel alerts and dispatch them to the teacher via Gmail or Classroom.
            </p>
          </div>
        </div>

        {soundAlerts.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No sustained sound alerts above 90.1 dB (&gt;3s) recorded yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {soundAlerts.slice(0, 8).map((alert) => (
              <li key={alert.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-100">{alert.headline}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{alert.voiceCue}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenDispatchModal(alert)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 cursor-pointer shrink-0"
                >
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{alert.teacherNotified ? 'Resend to Teacher' : 'Send to Teacher'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Gmail Safety Feed */}
      <section className="bg-[#111722] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center gap-2">
          <Mail className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-100">Gmail Messages</h2>
        </div>

        {!hasAccessToken ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Sign in with Google to view recent Gmail threads and dispatch teacher alerts.
          </div>
        ) : gmailMessages.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No recent Gmail messages loaded. Click Sync Classroom &amp; Gmail above to fetch.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {gmailMessages.map((msg) => (
              <li key={msg.id} className="px-5 py-3 space-y-0.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-100 truncate">{msg.subject}</span>
                  <span className="text-xs font-mono text-slate-500 shrink-0">{msg.date}</span>
                </div>
                <div className="text-xs text-slate-400 truncate">From: {msg.from}</div>
                {msg.snippet ? (
                  <p className="text-xs text-slate-500 line-clamp-1">{msg.snippet}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
