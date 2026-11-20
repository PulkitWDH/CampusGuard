import { Mail, ShieldAlert, X } from 'lucide-react';
import type { IncidentAlert } from '../types';
import { formatAlertCategoryBadge } from '../utils/monitoringLogic';

interface NotificationBannerProps {
  alert: IncidentAlert | null;
  onInspectCamera: (cameraId: string) => void;
  onNotifyTeacher: (alert: IncidentAlert) => void;
  onAcknowledge: (alertId: string) => void;
}

export function NotificationBanner({
  alert,
  onInspectCamera,
  onNotifyTeacher,
  onAcknowledge,
}: NotificationBannerProps) {
  if (!alert) return null;

  const isCritical = alert.severity === 'critical';
  const badge = formatAlertCategoryBadge(alert);
  const isBullying = badge.tone === 'bullying';

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="active-fight-banner"
      className={`animate-alert-slide-in rounded-xl border-2 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
        isBullying
          ? 'bg-orange-50 border-orange-400 text-orange-950'
          : isCritical
            ? 'animate-alert-critical-pulse bg-red-50 border-red-400 text-red-950'
            : 'bg-amber-50 border-amber-300 text-amber-950'
      }`}
    >
      <div className="flex items-start gap-3.5 min-w-0">
        <div className="relative mt-0.5 shrink-0 flex items-center justify-center w-8 h-8">
          {isCritical ? (
            <span
              aria-hidden="true"
              className={`animate-alert-beacon absolute inset-0 rounded-full ${
                isBullying ? 'bg-orange-500/40' : 'bg-red-500/40'
              }`}
            />
          ) : null}
          <span
            className={`relative inline-flex items-center justify-center w-8 h-8 rounded-full ${
              isBullying ? 'bg-orange-600 text-white' : isCritical ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'
            }`}
          >
            <ShieldAlert className="w-4 h-4" aria-hidden="true" />
          </span>
        </div>

        {alert.evidenceSnapshotUrl ? (
          <img
            src={alert.evidenceSnapshotUrl}
            alt={`Captured frame from ${alert.classroomName}`}
            className="hidden sm:block w-24 h-14 object-cover rounded-lg border border-red-300 shrink-0"
          />
        ) : null}

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded ${
                isBullying
                  ? 'bg-orange-600 text-white'
                  : isCritical
                    ? 'bg-red-700 text-white'
                    : badge.tone === 'attendance'
                      ? 'bg-blue-600 text-white'
                      : 'bg-amber-600 text-white'
              }`}
            >
              {badge.label}
            </span>
            <p className="text-sm font-bold">{alert.headline}</p>
            {typeof alert.threatScore === 'number' && isCritical ? (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-red-600 text-white tabular-nums">
                Threat {alert.threatScore}/100
              </span>
            ) : null}
          </div>

          <p className="text-xs sm:text-sm text-slate-800">
            <span className="tabular-nums font-semibold">{alert.studentCount} present</span>
            <span aria-hidden="true"> · </span>
            <span>Voice cue: {alert.voiceCue}</span>
            {alert.details ? (
              <>
                <span aria-hidden="true"> · </span>
                <span>{alert.details}</span>
              </>
            ) : null}
          </p>

          {alert.detectedBehaviors && alert.detectedBehaviors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {alert.detectedBehaviors.slice(0, 4).map((cue, idx) => (
                <span
                  key={idx}
                  className="text-[11px] font-medium px-2 py-0.5 rounded border border-red-200 bg-white/85 text-red-900"
                >
                  {cue}
                </span>
              ))}
            </div>
          ) : null}

          {alert.recommendedAction ? (
            <p className="text-xs font-medium text-red-900">
              Action: {alert.recommendedAction}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onNotifyTeacher(alert)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Mail className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{alert.teacherNotified ? 'Teacher Notified' : 'Send Teacher Alert'}</span>
        </button>
        <button
          type="button"
          onClick={() => onInspectCamera(alert.cameraId)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors whitespace-nowrap cursor-pointer"
        >
          Inspect Camera
        </button>
        <button
          type="button"
          onClick={() => onAcknowledge(alert.id)}
          aria-label={`Acknowledge alert for ${alert.classroomName}`}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Acknowledge</span>
        </button>
      </div>
    </div>
  );
}
