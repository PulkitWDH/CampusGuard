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
      className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-5"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBackToAll}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline mb-1 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to All {labels.zonePlural}</span>
          </button>
          <h2 className="text-lg font-bold text-slate-900 truncate">
            {camera.classroomName} · Dedicated Place
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {camera.cameraCode} · Independent AI &amp; isolated attendance
          </p>
        </div>
        <span
          className={`px-2.5 py-1 text-xs font-semibold rounded-md border shrink-0 ${
            camera.status === 'fighting'
              ? 'bg-red-50 border-red-200 text-red-700'
              : camera.status === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}
        >
          {camera.status === 'fighting'
            ? 'Critical Alert'
            : camera.status === 'warning'
              ? 'Warning'
              : 'Normal'}
        </span>
      </div>

      {/* Live Present vs Absent vs Custom Class Total for THIS camera only */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-3">
          <div className="text-[11px] font-medium text-emerald-800">Present</div>
          <div
            className="text-2xl font-bold font-mono tabular-nums text-emerald-950 mt-0.5"
            data-testid="dedicated-live-count"
          >
            {attendance.presentCount}
          </div>
          <div className="text-[11px] text-emerald-700 mt-0.5">Live count</div>
        </div>

        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-3">
          <div className="text-[11px] font-medium text-amber-800">Absent</div>
          <div
            className="text-2xl font-bold font-mono tabular-nums text-amber-950 mt-0.5"
            data-testid="dedicated-absent-count"
          >
            {expectedTotal !== null ? attendance.absentCount : '—'}
          </div>
          <div className="text-[11px] text-amber-800 mt-0.5">
            {expectedTotal !== null
              ? `${attendance.attendanceRatePercent}% present`
              : 'Set total'}
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-[11px] font-medium text-slate-600">Custom Total</div>
          <div
            className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5"
            data-testid="dedicated-expected-total"
          >
            {expectedTotal ?? '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Per class</div>
        </div>
      </div>

      {/* Scheduled Attendance Check (Teacher chooses time & custom total) */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <CalendarCheck2 className="w-4 h-4 text-blue-600" aria-hidden="true" />
            <span>Scheduled Attendance Check</span>
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
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
            }`}
          >
            {camera.attendanceCheckEnabled ? 'Auto Schedule On' : 'Auto Schedule Off'}
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
              className="block text-[11px] font-medium text-slate-700"
            >
              Custom Class Total
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
                className="w-full min-w-0 text-xs px-2.5 py-1.5 border border-slate-300 rounded-md bg-white text-slate-900"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer shrink-0"
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
              className="block text-[11px] font-medium text-slate-700"
            >
              Attendance Check Time
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={`dedicated-att-time-${camera.id}`}
                type="time"
                value={timeDraft}
                onChange={(e) => setTimeDraft(e.target.value)}
                className="w-full min-w-0 text-xs px-2 py-1.5 border border-slate-300 rounded-md bg-white text-slate-900"
              />
              <button
                type="submit"
                className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shrink-0"
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
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
          >
            Check Attendance Now
          </button>

          {camera.lastAttendanceRecord ? (
            <span className="text-[11px] text-slate-700 tabular-nums" data-testid="last-attendance-record">
              Last roll call: <strong>{camera.lastAttendanceRecord.presentCount} present</strong> ·{' '}
              <strong>{camera.lastAttendanceRecord.absentCount} absent</strong> (
              {new Date(camera.lastAttendanceRecord.checkedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
              )
            </span>
          ) : (
            <span className="text-[11px] text-slate-500">
              {camera.attendanceCheckEnabled && camera.attendanceCheckTime
                ? `Scheduled daily at ${camera.attendanceCheckTime}`
                : 'Enable schedule to run daily at chosen time'}
            </span>
          )}
        </div>
      </div>

      {/* Independent AI Settings */}
      <div className="space-y-3 border-t border-slate-100 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-800">
            This Camera&apos;s Individual AI
          </span>
          <button
            type="button"
            onClick={() =>
              onUpdateCameraSettings(camera.id, { autoAiEnabled: !isAutoAiOn })
            }
            className={`px-2.5 py-1 text-xs font-medium rounded-md border cursor-pointer ${
              isAutoAiOn
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {isAutoAiOn ? 'Instant AI On (Continuous)' : 'Instant AI Paused'}
          </button>
        </div>

        <div>
          <label
            htmlFor={`dedicated-ai-${camera.id}`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            AI Engine for {camera.cameraCode}
          </label>
          <select
            id={`dedicated-ai-${camera.id}`}
            value={activeAiModel}
            onChange={(e) =>
              onUpdateCameraSettings(camera.id, {
                aiModel: e.target.value as AiEngineModel,
              })
            }
            className="w-full text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800"
          >
            <option value="gemini-4-neon">Gemini 4 Neon</option>
            <option value="gemini-4-hydrogen">Gemini 4 Hydrogen</option>
            <option value="gpt-6-astra">GPT-6 Astra (High)</option>
            <option value="gpt-6-sol">GPT-6 Sol (Low)</option>
          </select>
        </div>

        {/* Optional Google Classroom link + Teacher Email for this class */}
        {courses.length > 0 ? (
          <div>
            <label
              htmlFor={`dedicated-course-${camera.id}`}
              className="block text-xs font-medium text-slate-700 mb-1 inline-flex items-center gap-1"
            >
              <BookOpen className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
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
              className="w-full text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-slate-800"
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
            className="block text-xs font-medium text-slate-700"
          >
            Class Teacher Alert Email (optional override)
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id={`dedicated-teacher-${camera.id}`}
              type="email"
              value={teacherDraft}
              onChange={(e) => setTeacherDraft(e.target.value)}
              placeholder={defaultTeacherEmail || 'teacher@school.edu'}
              className="flex-1 min-w-0 text-xs px-2.5 py-2 border border-slate-300 rounded-lg text-slate-900"
            />
            <button
              type="submit"
              className="px-2.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
            >
              Save
            </button>
          </div>
        </form>

        <div className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-slate-700">
            <Volume2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>Live zone sound</span>
          </span>
          <span
            className={`font-mono font-semibold tabular-nums ${
              camera.audioLevel > SOUND_ALERT_THRESHOLD_DB
                ? 'text-red-700'
                : 'text-slate-900'
            }`}
          >
            {camera.audioLevel.toFixed(1)} dB
          </span>
        </div>
      </div>

      {/* Other classes live comparison so teacher sees total & live of every class */}
      {otherCameras.length > 0 ? (
        <div className="border-t border-slate-100 pt-3.5 space-y-2">
          <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>Other Classes — Live &amp; Total ({otherCameras.length})</span>
          </h3>
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {otherCameras.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  onClick={() => onSelectCameraPlace(other.id)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {other.classroomName}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {other.cameraCode} · {other.audioLevel.toFixed(1)} dB
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-mono font-semibold text-slate-900 tabular-nums">
                      {other.studentCount} live
                      {typeof other.expectedTotalCount === 'number' &&
                      other.expectedTotalCount > 0
                        ? ` / ${other.expectedTotalCount}`
                        : ''}
                    </div>
                    <div className="text-[11px] text-blue-600 font-medium">Open place</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Alerts strictly for this camera */}
      <div className="border-t border-slate-100 pt-3.5 space-y-2">
        <h3 className="text-xs font-semibold text-slate-700">
          Alerts in {camera.classroomName} ({cameraAlerts.length})
        </h3>
        {cameraAlerts.length === 0 ? (
          <p className="text-xs text-slate-500">
            No active or recent alerts in {camera.classroomName}.
          </p>
        ) : (
          <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {cameraAlerts.slice(0, 6).map((alert) => (
              <li
                key={alert.id}
                className="border border-slate-200 rounded-lg p-2.5 bg-slate-50 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    {alert.severity === 'critical' ? (
                      <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                    )}
                    <span>{alert.headline}</span>
                  </div>
                  {alert.acknowledged ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-label="Acknowledged" />
                  ) : null}
                </div>
                <p className="text-[11px] text-slate-600">{alert.voiceCue}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onNotifyTeacher(alert)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 hover:underline cursor-pointer"
                  >
                    <Mail className="w-3 h-3" aria-hidden="true" />
                    <span>{alert.teacherNotified ? 'Resend to Teacher' : 'Notify Teacher'}</span>
                  </button>
                  {!alert.acknowledged ? (
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
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
