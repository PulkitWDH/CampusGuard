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
      className={`animate-alert-slide-in rounded-lg border p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 ${
        isBullying
          ? 'bg-orange-950/55 border-orange-500/70 text-orange-50'
          : isCritical
            ? 'animate-alert-critical-pulse bg-red-950/60 border-red-500/80 text-red-50'
            : 'bg-amber-950/50 border-amber-500/60 text-amber-50'
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span
          className={`mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0 ${
            isBullying
              ? 'bg-orange-600 text-white'
              : isCritical
                ? 'bg-red-600 text-white'
                : 'bg-amber-600 text-white'
          }`}
        >
          <ShieldAlert className="w-4 h-4" aria-hidden="true" />
        </span>

        {alert.evidenceSnapshotUrl ? (
          <img
            src={alert.evidenceSnapshotUrl}
            alt={`Captured frame from ${alert.classroomName}`}
            className="hidden sm:block w-24 h-14 object-cover rounded border border-white/15 shrink-0"
          />
        ) : null}

        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`text-[10px] font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded ${
                isBullying
                  ? 'bg-orange-600 text-white'
                  : isCritical
                    ? 'bg-red-600 text-white'
                    : badge.tone === 'attendance'
                      ? 'bg-zinc-700 text-white'
                      : 'bg-amber-600 text-white'
              }`}
            >
              {badge.label}
            </span>
            <p className="text-sm font-semibold text-white">
              {alert.headline.replace(/^[A-Z /]+ALERT:\s*/i, '')}
            </p>
            {typeof alert.threatScore === 'number' && isCritical ? (
              <span className="text-[11px] font-mono font-semibold text-red-200 tabular-nums">
                Risk {alert.threatScore}/100
              </span>
            ) : null}
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">
            <span className="font-mono tabular-nums text-zinc-100">{alert.cameraCode}</span>
            <span aria-hidden="true" className="mx-1.5 text-zinc-500">·</span>
            <span className="tabular-nums text-zinc-100">{alert.studentCount} present</span>
            <span aria-hidden="true" className="mx-1.5 text-zinc-500">·</span>
            <span>{alert.voiceCue}</span>
            {alert.details ? (
              <>
                <span aria-hidden="true" className="mx-1.5 text-zinc-500">·</span>
                <span>{alert.details}</span>
              </>
            ) : null}
          </p>

          {alert.recommendedAction ? (
            <p className="text-xs font-medium text-zinc-200">
              Response: {alert.recommendedAction}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => onInspectCamera(alert.cameraId)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md text-white transition-colors whitespace-nowrap cursor-pointer ${
            isBullying ? 'bg-orange-600 hover:bg-orange-500' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          Inspect Camera
        </button>
        <button
          type="button"
          onClick={() => onNotifyTeacher(alert)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#101114]/90 border border-zinc-700 text-zinc-100 hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer"
        >
          <Mail className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{alert.teacherNotified ? 'Teacher Notified' : 'Notify Teacher'}</span>
        </button>
        <button
          type="button"
          onClick={() => onAcknowledge(alert.id)}
          aria-label={`Acknowledge alert for ${alert.classroomName}`}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/15 bg-black/30 text-zinc-200 hover:bg-black/50 transition-colors whitespace-nowrap cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Acknowledge</span>
        </button>
      </div>
    </div>
  );
}
