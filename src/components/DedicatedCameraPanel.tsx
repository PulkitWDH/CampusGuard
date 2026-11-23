import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  Mail,
  ShieldAlert,
  Users,
  Volume2,
} from 'lucide-react';
import type {
  AiEngineModel,
  ClassroomCamera,
  FacilityMode,
  IncidentAlert,
  WorkspaceCourse,
} from '../types';
import {
  SOUND_ALERT_THRESHOLD_DB,
  computeClassAttendance,
  formatFacilityLabels,
} from '../utils/monitoringLogic';

interface DedicatedCameraPanelProps {
  camera: ClassroomCamera;
  allCameras: ClassroomCamera[];
  facilityMode: FacilityMode;
  defaultAiModel: AiEngineModel;
  defaultTeacherEmail: string;
  courses: WorkspaceCourse[];
  cameraAlerts: IncidentAlert[];
  onBackToAll: () => void;
  onSelectCameraPlace: (cameraId: string) => void;
  onUpdateCameraSettings: (
    cameraId: string,
    patch: Partial<
      Pick<
        ClassroomCamera,
        | 'aiModel'
        | 'autoAiEnabled'
        | 'expectedTotalCount'
        | 'attendanceCheckTime'
        | 'attendanceCheckEnabled'
        | 'linkedCourseId'
        | 'linkedCourseName'
        | 'teacherEmail'
      >
    >
  ) => void;
  onRunAttendanceCheck: (cameraId: string) => void;
  onAcknowledgeAlert: (alertId: string) => void;
  onNotifyTeacher: (alert: IncidentAlert) => void;
}

export function DedicatedCameraPanel({
  camera,
  allCameras,
  facilityMode,
  defaultAiModel,
  defaultTeacherEmail,
  courses,
  cameraAlerts,
  onBackToAll,
  onSelectCameraPlace,
  onUpdateCameraSettings,
  onRunAttendanceCheck,
  onAcknowledgeAlert,
  onNotifyTeacher,
}: DedicatedCameraPanelProps) {
  const labels = formatFacilityLabels(facilityMode);
  const [totalDraft, setTotalDraft] = useState(
    typeof camera.expectedTotalCount === 'number' && camera.expectedTotalCount > 0
      ? String(camera.expectedTotalCount)
      : ''
  );
  const [timeDraft, setTimeDraft] = useState(camera.attendanceCheckTime || '09:00');
  const [teacherDraft, setTeacherDraft] = useState(camera.teacherEmail || '');

  const activeAiModel = camera.aiModel || defaultAiModel;
  const isAutoAiOn = camera.autoAiEnabled !== false;
  const attendance = computeClassAttendance(camera.studentCount, camera.expectedTotalCount);
  const expectedTotal = attendance.customTotal > 0 ? attendance.customTotal : null;
  const otherCameras = allCameras.filter((c) => c.id !== camera.id);

  return (
    <aside
      data-testid="dedicated-camera-panel"
      className="w-full xl:w-[360px] shrink-0 bg-[#0B0C0F] border-t xl:border-t-0 xl:border-l border-zinc-800/90 p-4 space-y-4 overflow-y-auto xl:max-h-[calc(100vh-52px)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-zinc-800/90 pb-3.5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBackToAll}
            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-100 mb-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Wall</span>
          </button>
          <h2 className="text-sm font-semibold text-zinc-100 truncate">
            {camera.classroomName}
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">
            {camera.cameraCode} · Zone Inspector
          </p>
        </div>
        <span
          className={`text-[11px] font-mono font-semibold shrink-0 ${
            camera.status === 'fighting'
              ? 'text-red-400'
              : camera.status === 'warning'
                ? 'text-amber-400'
                : 'text-emerald-400'
          }`}
        >
          {camera.status === 'fighting'
            ? 'IN ALARM'
            : camera.status === 'warning'
              ? 'WARNING'
              : 'NOMINAL'}
        </span>
      </div>

      {/* Live Acoustic Metrics (Mic-Only) vs Occupancy / Attendance Row (Video) */}
      {camera.sourceKind === 'microphone-only' || !camera.hasVideo ? (
        <div className="grid grid-cols-3 border border-zinc-800 rounded-lg divide-x divide-zinc-800 bg-[#101114]">
          <div className="p-3">
            <div className="text-[11px] font-medium text-zinc-400">Live dB</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-0.5 ${
                camera.audioLevel > SOUND_ALERT_THRESHOLD_DB ? 'text-red-400' : 'text-emerald-400'
              }`}
              data-testid="dedicated-live-count"
            >
              {camera.audioLevel.toFixed(1)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">SPL meter</div>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-medium text-zinc-400">Threshold</div>
            <div className="text-xl font-bold font-mono tabular-nums text-zinc-100 mt-0.5">
              {SOUND_ALERT_THRESHOLD_DB.toFixed(1)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">3s trigger</div>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-medium text-zinc-400">Mode</div>
            <div className="text-sm font-semibold font-mono text-zinc-100 mt-1.5">
              MIC ONLY
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">No video</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 border border-zinc-800 rounded-lg divide-x divide-zinc-800 bg-[#101114]">
          <div className="p-3">
            <div className="text-[11px] font-medium text-zinc-400">Present</div>
            <div
              className="text-xl font-bold font-mono tabular-nums text-emerald-400 mt-0.5"
              data-testid="dedicated-live-count"
            >
              {attendance.presentCount}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Live count</div>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-medium text-zinc-400">Absent</div>
            <div
              className="text-xl font-bold font-mono tabular-nums text-amber-400 mt-0.5"
              data-testid="dedicated-absent-count"
            >
              {expectedTotal !== null ? attendance.absentCount : '—'}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {expectedTotal !== null
                ? `${attendance.attendanceRatePercent}% present`
                : 'Set total'}
            </div>
          </div>

          <div className="p-3">
            <div className="text-[11px] font-medium text-zinc-400">Class Total</div>
            <div
              className="text-xl font-bold font-mono tabular-nums text-zinc-100 mt-0.5"
              data-testid="dedicated-expected-total"
            >
              {expectedTotal ?? '—'}
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Configured</div>
          </div>
        </div>
      )}

      {/* Scheduled Attendance Check */}
      <div className="border-t border-zinc-800/90 pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <CalendarCheck2 className="w-4 h-4 text-zinc-400" aria-hidden="true" />
            <span>Scheduled Roll Call</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(camera.attendanceCheckEnabled)}
            onClick={() =>
              onUpdateCameraSettings(camera.id, {
                attendanceCheckTime: timeDraft,
                attendanceCheckEnabled: !camera.attendanceCheckEnabled,
              })
            }
            className={`px-2 py-0.5 text-[11px] font-medium rounded border cursor-pointer ${
              camera.attendanceCheckEnabled
                ? 'bg-zinc-100 text-zinc-950 border-zinc-100'
                : 'bg-[#09090B] text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            {camera.attendanceCheckEnabled ? 'Schedule On' : 'Schedule Off'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(totalDraft);
              onUpdateCameraSettings(camera.id, {
                expectedTotalCount:
                  Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined,
              });
            }}
            className="space-y-1"
          >
            <label
              htmlFor={`dedicated-total-${camera.id}`}
              className="block text-[11px] font-medium text-zinc-400"
            >
              Class Total
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={`dedicated-total-${camera.id}`}
                type="number"
                min={0}
                max={10000}
                value={totalDraft}
                onChange={(e) => setTotalDraft(e.target.value)}
                placeholder="e.g. 28"
                className="w-full min-w-0 text-xs px-2.5 py-1.5 border border-zinc-800 rounded-md bg-[#09090B] text-zinc-100"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer shrink-0"
              >
                Save
              </button>
            </div>
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onUpdateCameraSettings(camera.id, {
                attendanceCheckTime: timeDraft,
                attendanceCheckEnabled: true,
              });
            }}
            className="space-y-1"
          >
            <label
              htmlFor={`dedicated-att-time-${camera.id}`}
              className="block text-[11px] font-medium text-zinc-400"
            >
              Daily Check Time
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={`dedicated-att-time-${camera.id}`}
                type="time"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                className="w-full min-w-0 text-xs px-2.5 py-1.5 border border-zinc-800 rounded-md bg-[#09090B] text-zinc-100"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 cursor-pointer shrink-0"
              >
                Set
              </button>
            </div>
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => onRunAttendanceCheck(camera.id)}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer"
          >
            Run Roll Call Now
          </button>

          {camera.lastAttendanceRecord ? (
            <span className="text-[11px] text-zinc-300 font-mono tabular-nums" data-testid="last-attendance-record">
              {camera.lastAttendanceRecord.presentCount} present ·{' '}
              {camera.lastAttendanceRecord.absentCount} absent (
              {new Date(camera.lastAttendanceRecord.checkedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              )
            </span>
          ) : (
            <span className="text-[11px] text-zinc-500">
              {camera.attendanceCheckEnabled && camera.attendanceCheckTime
                ? `Daily at ${camera.attendanceCheckTime}`
                : 'Schedule inactive'}
            </span>
          )}
        </div>
      </div>

      {/* Zone AI & Routing */}
      <div className="space-y-3 border-t border-zinc-800/90 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-zinc-200">
            Zone Threat Engine
          </span>
          <button
            type="button"
            onClick={() =>
              onUpdateCameraSettings(camera.id, { autoAiEnabled: !isAutoAiOn })
            }
            className={`px-2.5 py-1 text-xs font-medium rounded-md border cursor-pointer ${
              isAutoAiOn
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60'
                : 'bg-[#09090B] text-zinc-400 border-zinc-800 hover:text-zinc-200'
            }`}
          >
            {isAutoAiOn ? 'Continuous Armed' : 'Paused'}
          </button>
        </div>

        <div>
          <label
            htmlFor={`dedicated-ai-${camera.id}`}
            className="block text-[11px] font-medium text-zinc-400 mb-1"
          >
            Cloud Verification Model ({camera.cameraCode})
          </label>
          <select
            id={`dedicated-ai-${camera.id}`}
            value={activeAiModel}
            onChange={(e) =>
              onUpdateCameraSettings(camera.id, {
                aiModel: e.target.value as AiEngineModel,
              })
            }
            className="w-full text-xs bg-[#09090B] border border-zinc-800 rounded-md px-2.5 py-2 text-zinc-100"
          >
            <option value="gemini-4-neon">Gemini 4 Neon</option>
            <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
            <option value="gpt-6-astra">GPT-6 Astra (High)</option>
            <option value="gpt-6-sol">GPT-6 Sol (Low)</option>
          </select>
        </div>

        {courses.length > 0 ? (
          <div>
            <label
              htmlFor={`dedicated-course-${camera.id}`}
              className="block text-[11px] font-medium text-zinc-400 mb-1 inline-flex items-center gap-1"
            >
              <BookOpen className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
              <span>Linked Google Classroom</span>
            </label>
            <select
              id={`dedicated-course-${camera.id}`}
              value={camera.linkedCourseId || ''}
              onChange={(e) => {
                const chosen = courses.find((c) => c.id === e.target.value);
                onUpdateCameraSettings(camera.id, {
                  linkedCourseId: chosen?.id,
                  linkedCourseName: chosen?.name,
                });
              }}
              className="w-full text-xs bg-[#09090B] border border-zinc-800 rounded-md px-2.5 py-2 text-zinc-100"
            >
              <option value="">Use default class / none</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.section ? ` (${c.section})` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onUpdateCameraSettings(camera.id, {
              teacherEmail: teacherDraft.trim() || undefined,
            });
          }}
          className="space-y-1"
        >
          <label
            htmlFor={`dedicated-teacher-${camera.id}`}
            className="block text-[11px] font-medium text-zinc-400"
          >
            Zone Teacher Alert Email
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id={`dedicated-teacher-${camera.id}`}
              type="email"
              value={teacherDraft}
              onChange={(e) => setTeacherDraft(e.target.value)}
              placeholder={defaultTeacherEmail || 'teacher@school.edu'}
              className="flex-1 min-w-0 text-xs px-2.5 py-2 border border-zinc-800 rounded-md bg-[#09090B] text-zinc-100"
            />
            <button
              type="submit"
              className="px-2.5 py-2 text-xs font-medium rounded-md border border-zinc-800 bg-[#16181D] text-zinc-200 hover:bg-zinc-800 cursor-pointer shrink-0"
            >
              Save
            </button>
          </div>
        </form>

        <div className="flex items-center justify-between text-xs border-t border-zinc-800/90 pt-2.5">
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <Volume2 className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
            <span>Live zone sound</span>
          </span>
          <span
            className={`font-mono font-semibold tabular-nums ${
              camera.audioLevel > SOUND_ALERT_THRESHOLD_DB
                ? 'text-red-400'
                : 'text-zinc-200'
            }`}
          >
            {camera.audioLevel.toFixed(1)} dB
          </span>
        </div>
      </div>

      {/* Other zones quick jump */}
      {otherCameras.length > 0 ? (
        <div className="border-t border-zinc-800/90 pt-4 space-y-2">
          <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
            <span>Other {labels.zonePlural} ({otherCameras.length})</span>
          </h3>
          <ul className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg overflow-hidden">
            {otherCameras.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  onClick={() => onSelectCameraPlace(other.id)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-200 truncate">
                      {other.classroomName}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                      {other.cameraCode} · {other.audioLevel.toFixed(1)} dB
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-mono font-semibold text-zinc-200 tabular-nums">
                      {other.studentCount}
                      {typeof other.expectedTotalCount === 'number' &&
                      other.expectedTotalCount > 0
                        ? `/${other.expectedTotalCount}`
                        : ''}
                    </div>
                    <div className="text-[10px] text-zinc-400 font-medium">Switch</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Zone-specific alerts */}
      <div className="border-t border-zinc-800/90 pt-4 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300">
          Zone Alerts ({cameraAlerts.length})
        </h3>
        {cameraAlerts.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No active or recent alerts in {camera.classroomName}.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg max-h-56 overflow-y-auto">
            {cameraAlerts.slice(0, 6).map((alert) => (
              <li key={alert.id} className="p-3 space-y-1.5 bg-[#101114]">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                    {alert.severity === 'critical' ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                    )}
                    <span>{alert.headline}</span>
                  </div>
                  {alert.acknowledged ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-label="Acknowledged" />
                  ) : null}
                </div>
                <p className="text-[11px] text-zinc-400">{alert.voiceCue}</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onNotifyTeacher(alert)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-200 hover:underline cursor-pointer"
                  >
                    <Mail className="w-3 h-3" aria-hidden="true" />
                    <span>{alert.teacherNotified ? 'Resend' : 'Notify Teacher'}</span>
                  </button>
                  {!alert.acknowledged ? (
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="text-[11px] font-medium text-zinc-400 hover:text-zinc-100 cursor-pointer"
                    >
                      Acknowledge
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
