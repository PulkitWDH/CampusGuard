import { AlertTriangle, Check, ClipboardCheck, Eye, Mail, ShieldAlert, Volume2, X } from 'lucide-react';
import type { IncidentAlert } from '../types';
import { formatAlertCategoryBadge } from '../utils/monitoringLogic';

interface AlertPopupOverlayProps {
  popups: IncidentAlert[];
  onDismissPopup: (alertId: string) => void;
  onDismissAllPopups: () => void;
  onInspectCamera: (cameraId: string) => void;
  onNotifyTeacher: (alert: IncidentAlert) => void;
  onAcknowledge: (alertId: string) => void;
}

export function AlertPopupOverlay({
  popups,
  onDismissPopup,
  onDismissAllPopups,
  onInspectCamera,
  onNotifyTeacher,
  onAcknowledge,
}: AlertPopupOverlayProps) {
  if (popups.length === 0) return null;

  const visiblePopups = popups.slice(0, 4);

  return (
    <div
      aria-label="Live on-screen alert popups"
      aria-live="assertive"
      data-testid="alert-popup-stack"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-[70] w-auto sm:w-[400px] max-w-[calc(100vw-2rem)] flex flex-col-reverse gap-2.5 pointer-events-none"
    >
      {popups.length > 1 ? (
        <div className="pointer-events-auto flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#101114]/95 text-zinc-200 text-xs shadow-xl border border-zinc-800 backdrop-blur-md">
          <span className="font-mono font-semibold tabular-nums">
            {popups.length} active alerts
          </span>
          <button
            type="button"
            onClick={onDismissAllPopups}
            className="text-zinc-400 hover:text-white font-medium underline cursor-pointer"
          >
            Dismiss all
          </button>
        </div>
      ) : null}

      {visiblePopups.map((alert) => {
        const badge = formatAlertCategoryBadge(alert);
        const isCritical = alert.severity === 'critical';
        const isBullying = badge.tone === 'bullying';
        const isAttendance = badge.tone === 'attendance';

        const cardStyle = isBullying
          ? 'bg-[#101114] border border-orange-500/90 shadow-2xl shadow-black/80'
          : isCritical
            ? 'animate-alert-critical-pulse bg-[#101114] border border-red-500/90 shadow-2xl shadow-black/80'
            : isAttendance
              ? 'bg-[#101114] border border-zinc-600 shadow-xl shadow-black/70'
              : 'bg-[#101114] border border-amber-500/80 shadow-xl shadow-black/70';

        const headerBg = isBullying
          ? 'bg-orange-600 text-white'
          : isCritical
            ? 'bg-red-600 text-white'
            : isAttendance
              ? 'bg-blue-600 text-white'
              : 'bg-amber-600 text-white';

        const IconComponent = isAttendance
          ? ClipboardCheck
          : alert.alertType === 'sound-threshold'
            ? Volume2
            : isCritical
              ? ShieldAlert
              : AlertTriangle;

        const cleanHeadline = alert.headline.replace(
          /^(?:CRITICAL|BEATING ALERT|BULLYING ALERT|FIGHT ALERT|Teacher Sound Alert):\s*/i,
          ''
        );

        return (
          <div
            key={alert.id}
            role="alertdialog"
            aria-label={alert.headline}
            data-testid={`alert-popup-${alert.threatCategory || alert.alertType || 'alert'}`}
            className={`pointer-events-auto animate-alert-pop-in rounded-xl overflow-hidden ${cardStyle}`}
          >
            <div className={`px-3.5 py-2 flex items-center justify-between gap-2 ${headerBg}`}>
              <div className="flex items-center gap-2 min-w-0">
                <IconComponent className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="text-[11px] font-mono font-bold tracking-wider uppercase whitespace-nowrap">
                  {badge.label}
                </span>
                {typeof alert.threatScore === 'number' && isCritical ? (
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/25 tabular-nums whitespace-nowrap">
                    {alert.threatScore}/100
                  </span>
                ) : null}
                <span className="text-[11px] font-mono opacity-90 truncate">
                  {alert.cameraCode}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDismissPopup(alert.id)}
                aria-label={`Dismiss popup for ${alert.classroomName}`}
                className="p-0.5 rounded hover:bg-black/20 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-3.5 space-y-2.5 text-slate-100">
              <div className="flex items-start gap-3">
                {alert.evidenceSnapshotUrl ? (
                  <img
                    src={alert.evidenceSnapshotUrl}
                    alt={`Live capture from ${alert.classroomName}`}
                    className="w-20 h-14 object-cover rounded-lg border border-slate-700 shrink-0"
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold leading-snug text-white">
                    {cleanHeadline}
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    <span className="font-mono tabular-nums text-slate-200">{alert.studentCount} present</span>
                    <span aria-hidden="true" className="mx-1.5 text-slate-600">·</span>
                    <span>{alert.voiceCue}</span>
                  </p>
                  {alert.details ? (
                    <p className="text-xs text-slate-300 line-clamp-2">{alert.details}</p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    onInspectCamera(alert.cameraId);
                    onDismissPopup(alert.id);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors cursor-pointer whitespace-nowrap ${
                    isBullying
                      ? 'bg-orange-600 hover:bg-orange-500'
                      : isCritical
                        ? 'bg-red-600 hover:bg-red-500'
                        : 'bg-blue-600 hover:bg-blue-500'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Inspect</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNotifyTeacher(alert)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{alert.teacherNotified ? 'Notified' : 'Notify'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onAcknowledge(alert.id)}
                  className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Acknowledge</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
