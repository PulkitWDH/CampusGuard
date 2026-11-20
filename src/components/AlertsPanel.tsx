import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Download, Eye, Mail, ShieldAlert, Trash2 } from 'lucide-react';
import type { ClassroomCamera, FacilityMode, IncidentAlert } from '../types';
import { filterIncidentAlerts, formatAlertCategoryBadge, formatFacilityLabels } from '../utils/monitoringLogic';

interface AlertsPanelProps {
  alerts: IncidentAlert[];
  cameras: ClassroomCamera[];
  facilityMode: FacilityMode;
  onAcknowledgeAlert: (alertId: string) => void;
  onAcknowledgeAll: () => void;
  onClearAcknowledged: () => void;
  onFocusCamera: (cameraId: string) => void;
  onNotifyTeacher: (alert: IncidentAlert) => void;
}

export function AlertsPanel({
  alerts,
  cameras,
  facilityMode,
  onAcknowledgeAlert,
  onAcknowledgeAll,
  onClearAcknowledged,
  onFocusCamera,
  onNotifyTeacher,
}: AlertsPanelProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'critical' | 'bullying' | 'beating'>('all');
  const [cameraFilter, setCameraFilter] = useState<string>('all');

  const labels = formatFacilityLabels(facilityMode);
  const visibleAlerts = filterIncidentAlerts(alerts, filterMode, cameraFilter);

  const handleExportAuditLog = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      facilityMode,
      totalAlerts: visibleAlerts.length,
      alerts: visibleAlerts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `security-incident-audit-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-label="Fight and safety notifications" className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Incident &amp; Threat Notifications
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time alerts triggered by AI video and voice recognition across connected {labels.zonePlural.toLowerCase()}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('unread')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === 'unread'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Unread
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('critical')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === 'critical'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Critical
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('beating')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === 'beating'
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Beating
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('bullying')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === 'bullying'
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bullying
            </button>
          </div>

          <select
            aria-label="Filter alerts by zone"
            value={cameraFilter}
            onChange={(e) => setCameraFilter(e.target.value)}
            className="text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700"
          >
            <option value="all">All {labels.zonePlural}</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.classroomName}
              </option>
            ))}
          </select>

          {visibleAlerts.length > 0 ? (
            <button
              type="button"
              onClick={handleExportAuditLog}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export Log</span>
            </button>
          ) : null}

          {alerts.some((a) => !a.acknowledged) ? (
            <button
              type="button"
              onClick={onAcknowledgeAll}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              Mark all read
            </button>
          ) : null}

          {alerts.some((a) => a.acknowledged) ? (
            <button
              type="button"
              onClick={onClearAcknowledged}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear read</span>
            </button>
          ) : null}
        </div>
      </div>

      {visibleAlerts.length === 0 ? (
        <div className="p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-800">No incident notifications matching filter</p>
          <p className="text-xs text-slate-500 mt-1">
            When AI detects fighting, beating, bullying, robbery/weapons, breaches, or panic shouting in any camera, an alert pops up on screen immediately.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200" data-testid="alerts-list">
          {visibleAlerts.map((alert) => {
            const isUnreadCritical = !alert.acknowledged && alert.severity === 'critical';
            const badge = formatAlertCategoryBadge(alert);
            const isBullying = badge.tone === 'bullying';
            return (
            <li
              key={alert.id}
              className={`px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-alert-slide-in ${
                alert.acknowledged
                  ? 'bg-white'
                  : isBullying
                    ? 'bg-orange-50/75 border-l-4 border-l-orange-500'
                    : isUnreadCritical
                      ? 'bg-red-50/70 border-l-4 border-l-red-600'
                      : 'bg-amber-50/50 border-l-4 border-l-amber-500'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="relative mt-0.5 shrink-0">
                  {isUnreadCritical ? (
                    <span
                      aria-hidden="true"
                      className="animate-alert-beacon absolute -inset-1 rounded-full bg-red-500/35"
                    />
                  ) : null}
                  {alert.severity === 'critical' ? (
                    <ShieldAlert className="relative w-4 h-4 text-red-600" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="relative w-4 h-4 text-amber-600" aria-hidden="true" />
                  )}
                </div>

                {alert.evidenceSnapshotUrl ? (
                  <img
                    src={alert.evidenceSnapshotUrl}
                    alt={`Snapshot for ${alert.classroomName}`}
                    className="hidden sm:block w-20 h-12 object-cover rounded-md border border-slate-300 shrink-0"
                  />
                ) : null}

                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    <span
                      className={`text-[10px] font-extrabold tracking-wider uppercase px-1.5 py-0.5 rounded ${
                        isBullying
                          ? 'bg-orange-600 text-white'
                          : alert.severity === 'critical'
                            ? 'bg-red-600 text-white'
                            : badge.tone === 'attendance'
                              ? 'bg-blue-600 text-white'
                              : 'bg-amber-500 text-white'
                      }`}
                    >
                      {badge.label}
                    </span>
                    <span>{alert.headline}</span>
                    {typeof alert.threatScore === 'number' && alert.severity === 'critical' ? (
                      <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 tabular-nums">
                        Threat {alert.threatScore}/100
                      </span>
                    ) : null}
                    <span className="text-xs font-normal text-slate-500 font-mono tabular-nums">
                      {new Date(alert.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    <span className="font-mono tabular-nums">{alert.cameraCode}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="tabular-nums">
                      {alert.studentCount} {alert.studentCount === 1 ? labels.personSingular : labels.personPlural} present
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>Voice: {alert.voiceCue}</span>
                    {alert.modelUsed ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono">{alert.modelUsed}</span>
                      </>
                    ) : null}
                  </p>
                  {alert.detectedBehaviors && alert.detectedBehaviors.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {alert.detectedBehaviors.slice(0, 4).map((b, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {alert.details ? (
                    <p className="text-xs text-slate-500 mt-0.5">{alert.details}</p>
                  ) : null}
                  {alert.recommendedAction ? (
                    <p className="text-xs font-medium text-slate-800 mt-0.5">
                      Action: {alert.recommendedAction}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onNotifyTeacher(alert)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{alert.teacherNotified ? 'Teacher Sent' : 'Notify Teacher'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onFocusCamera(alert.cameraId)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>View Feed</span>
                </button>
                {!alert.acknowledged ? (
                  <button
                    type="button"
                    onClick={() => onAcknowledgeAlert(alert.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Acknowledge</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-400 px-2">Acknowledged</span>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
