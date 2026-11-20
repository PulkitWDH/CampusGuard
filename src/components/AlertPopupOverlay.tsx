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
      className="fixed top-[68px] right-4 left-4 sm:left-auto z-[70] w-auto sm:w-[410px] max-w-[calc(100vw-2rem)] flex flex-col gap-2.5 pointer-events-none"
    >
      {popups.length > 1 ? (
        <div className="pointer-events-auto flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-900/95 text-white text-xs shadow-lg border border-slate-700 backdrop-blur-md">
          <span className="font-semibold tabular-nums">
            {popups.length} active screen alerts
          </span>
          <button
            type="button"
            onClick={onDismissAllPopups}
            className="text-slate-300 hover:text-white font-medium underline cursor-pointer"
          >
            Dismiss all popups
          </button>
        </div>
      ) : null}

      {visiblePopups.map((alert) => {
        const badge = formatAlertCategoryBadge(alert);
        const isCritical = alert.severity === 'critical';
        const isBullying = badge.tone === 'bullying';
        const isAttendance = badge.tone === 'attendance';

        const cardStyle = isBullying
          ? 'bg-white border-2 border-orange-500 shadow-2xl ring-2 ring-orange-200'
          : isCritical
            ? 'animate-alert-critical-pulse bg-white border-2 border-red-600 shadow-2xl ring-2 ring-red-200'
            : isAttendance
              ? 'bg-white border-2 border-blue-500 shadow-xl ring-1 ring-blue-100'
              : 'bg-white border-2 border-amber-400 shadow-xl ring-1 ring-amber-100';

        const headerBg = isBullying
          ? 'bg-orange-600 text-white'
          : isCritical
            ? 'bg-red-600 text-white'
            : isAttendance
              ? 'bg-blue-600 text-white'
              : 'bg-amber-500 text-white';

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
                <div className="relative flex items-center justify-center shrink-0">
                  {isCritical ? (
                    <span
                      aria-hidden="true"
                      className="animate-alert-beacon absolute -inset-1 rounded-full bg-white/40"
                    />
                  ) : null}
                  <IconComponent className="relative w-4 h-4 shrink-0" aria-hidden="true" />
                </div>
                <span className="text-[11px] font-extrabold tracking-wider uppercase whitespace-nowrap">
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
                className="p-0.5 rounded hover:bg-white/20 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-3.5 space-y-2.5 text-slate-900">
              <div className="flex items-start gap-3">
                {alert.evidenceSnapshotUrl ? (
                  <img
                    src={alert.evidenceSnapshotUrl}
                    alt={`Live capture from ${alert.classroomName}`}
                    className="w-20 h-14 object-cover rounded-lg border border-slate-200 shrink-0"
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-bold leading-snug text-slate-950">
                    {cleanHeadline}
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-semibold tabular-nums">{alert.studentCount} present</span>
                    <span aria-hidden="true"> · </span>
                    <span>{alert.voiceCue}</span>
                  </p>
                  {alert.details ? (
                    <p className="text-xs text-slate-700 line-clamp-2">{alert.details}</p>
                  ) : null}
                </div>
              </div>

              {alert.detectedBehaviors && alert.detectedBehaviors.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {alert.detectedBehaviors.slice(0, 3).map((cue, idx) => (
                    <span
                      key={idx}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                        isBullying
                          ? 'bg-orange-50 border-orange-200 text-orange-900'
                          : isCritical
                            ? 'bg-red-50 border-red-200 text-red-900'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      {cue}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    onInspectCamera(alert.cameraId);
                    onDismissPopup(alert.id);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors cursor-pointer whitespace-nowrap ${
                    isBullying
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : isCritical
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Inspect Camera</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNotifyTeacher(alert)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{alert.teacherNotified ? 'Notified' : 'Notify Teacher'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onAcknowledge(alert.id)}
                  className="ml-auto inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
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
