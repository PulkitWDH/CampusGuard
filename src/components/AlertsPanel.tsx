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
    <section
      aria-label="Fight and safety notifications"
      className="bg-[#101114] border border-zinc-800/90 rounded-lg overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-zinc-800/90 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">
            Incident &amp; Threat Audit Log
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Real-time fighting, beating, bullying, weapon, and acoustic alerts across connected {labels.zonePlural.toLowerCase()}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-[#09090B] border border-zinc-800 rounded-md">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'unread', label: 'Unread' },
                { id: 'critical', label: 'Critical' },
                { id: 'beating', label: 'Beating' },
                { id: 'bullying', label: 'Bullying' },
              ] as const
            ).map((tab) => {
              const active = filterMode === tab.id;
              const activeCls =
                tab.id === 'beating'
                  ? 'bg-red-600 text-white'
                  : tab.id === 'bullying'
                    ? 'bg-orange-600 text-white'
                    : 'bg-zinc-800 text-white';
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterMode(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                    active ? activeCls : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <select
            aria-label="Filter alerts by zone"
            value={cameraFilter}
            onChange={(e) => setCameraFilter(e.target.value)}
            className="text-xs bg-[#09090B] border border-zinc-800 rounded-md px-2.5 py-1.5 text-zinc-200"
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
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export</span>
            </button>
          ) : null}

          {alerts.some((a) => !a.acknowledged) ? (
            <button
              type="button"
              onClick={onAcknowledgeAll}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white cursor-pointer whitespace-nowrap"
            >
              Mark all read
            </button>
          ) : null}

          {alerts.some((a) => a.acknowledged) ? (
            <button
              type="button"
              onClick={onClearAcknowledged}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear read</span>
            </button>
          ) : null}
        </div>
      </div>

      {visibleAlerts.length === 0 ? (
        <div className="p-8 text-center">
          <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-medium text-zinc-200">No incident notifications matching filter</p>
          <p className="text-xs text-zinc-400 mt-1 max-w-lg mx-auto">
            Active visual and acoustic monitoring is armed. Any detected fighting, beating, bullying, weapon, or loud distress triggers an immediate screen popup and logs here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800/90" data-testid="alerts-list">
          {visibleAlerts.map((alert) => {
            const isUnreadCritical = !alert.acknowledged && alert.severity === 'critical';
            const badge = formatAlertCategoryBadge(alert);
            const isBullying = badge.tone === 'bullying';
            return (
              <li
                key={alert.id}
                className={`px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                  alert.acknowledged
                    ? 'bg-transparent hover:bg-zinc-800/30'
                    : isBullying
                      ? 'bg-orange-950/25 hover:bg-orange-950/35'
                      : isUnreadCritical
                        ? 'bg-red-950/25 hover:bg-red-950/35'
                        : 'bg-amber-950/20 hover:bg-amber-950/30'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {alert.severity === 'critical' ? (
                      <ShieldAlert
                        className={`w-4 h-4 ${isBullying ? 'text-orange-400' : 'text-red-400'}`}
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    )}
                  </div>

                  {alert.evidenceSnapshotUrl ? (
                    <img
                      src={alert.evidenceSnapshotUrl}
                      alt={`Snapshot for ${alert.classroomName}`}
                      className="hidden sm:block w-20 h-12 object-cover rounded border border-zinc-800 shrink-0"
                    />
                  ) : null}

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-100">
                      <span
                        className={`text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded ${
                          isBullying
                            ? 'bg-orange-600 text-white'
                            : alert.severity === 'critical'
                              ? 'bg-red-600 text-white'
                              : badge.tone === 'attendance'
                                ? 'bg-zinc-700 text-white'
                                : 'bg-amber-600 text-white'
                        }`}
                      >
                        {badge.label}
                      </span>
                      <span>{alert.headline}</span>
                      {typeof alert.threatScore === 'number' && alert.severity === 'critical' ? (
                        <span className="text-[11px] font-mono text-red-300 tabular-nums">
                          {alert.threatScore}/100
                        </span>
                      ) : null}
                      <span className="text-xs font-normal text-zinc-500 font-mono tabular-nums">
                        {new Date(alert.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-400">
                      <span className="font-mono text-zinc-300 tabular-nums">{alert.cameraCode}</span>
                      <span aria-hidden="true" className="mx-1.5 text-zinc-600">·</span>
                      <span className="tabular-nums">
                        {alert.studentCount} {alert.studentCount === 1 ? labels.personSingular : labels.personPlural}
                      </span>
                      <span aria-hidden="true" className="mx-1.5 text-zinc-600">·</span>
                      <span>{alert.voiceCue}</span>
                      {alert.modelUsed ? (
                        <>
                          <span aria-hidden="true" className="mx-1.5 text-zinc-600">·</span>
                          <span className="font-mono text-zinc-500">{alert.modelUsed}</span>
                        </>
                      ) : null}
                    </p>

                    {alert.details ? (
                      <p className="text-xs text-zinc-400">{alert.details}</p>
                    ) : null}
                    {alert.recommendedAction ? (
                      <p className="text-xs font-medium text-zinc-300">
                        Action: {alert.recommendedAction}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNotifyTeacher(alert)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-800 bg-[#16181D] text-zinc-200 hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
                  >
                    <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{alert.teacherNotified ? 'Notified' : 'Notify'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onFocusCamera(alert.cameraId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-zinc-800 bg-[#16181D] text-zinc-200 hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>View</span>
                  </button>
                  {!alert.acknowledged ? (
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Acknowledge</span>
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-500 px-2">Acknowledged</span>
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
