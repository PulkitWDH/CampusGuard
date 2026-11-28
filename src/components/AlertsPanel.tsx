import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Download, Eye, Mail, ShieldAlert, Trash2, Volume2 } from 'lucide-react';
import type { ClassroomCamera, FacilityMode, IncidentAlert, OperationMode } from '../types';
import {
  classifyDisasterPhase,
  filterIncidentAlerts,
  formatAlertCategoryBadge,
  formatFacilityLabels,
} from '../utils/monitoringLogic';

interface AlertsPanelProps {
  alerts: IncidentAlert[];
  cameras: ClassroomCamera[];
  facilityMode: FacilityMode;
  operationMode?: OperationMode;
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
  operationMode = 'school',
  onAcknowledgeAlert,
  onAcknowledgeAll,
  onClearAcknowledged,
  onFocusCamera,
  onNotifyTeacher,
}: AlertsPanelProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'critical' | 'bullying' | 'beating'>('all');
  const [cameraFilter, setCameraFilter] = useState<string>('all');
  const isDisaster = operationMode === 'disaster';

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
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {isDisaster
              ? '3-Phase Disaster Management & Rescue Incident Log'
              : 'Incident & Threat Audit Log'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isDisaster
              ? 'Zero-delay Edge AI alerts grouped across Phase 1 (Stampede & Hazard Zones), Phase 2 (Fallen Victims & Acoustic Collapse), and Phase 3 (Missing Person Re-ID).'
              : `Real-time fighting, beating, bullying, weapon, and acoustic alerts across connected ${labels.zonePlural.toLowerCase()}.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-50 border border-slate-200 rounded-md">
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
                    : 'bg-slate-900 text-white';
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterMode(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                    active ? activeCls : 'text-slate-500 hover:text-slate-900'
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
            className="text-xs bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 text-slate-800"
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
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-white cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export</span>
            </button>
          ) : null}

          {alerts.some((a) => !a.acknowledged) ? (
            <button
              type="button"
              onClick={onAcknowledgeAll}
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-white cursor-pointer whitespace-nowrap"
            >
              Mark all read
            </button>
          ) : null}

          {alerts.some((a) => a.acknowledged) ? (
            <button
              type="button"
              onClick={onClearAcknowledged}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer whitespace-nowrap"
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
          <p className="text-sm font-medium text-slate-800">No incident notifications matching filter</p>
          <p className="text-xs text-slate-500 mt-1 max-w-lg mx-auto">
            Active visual and acoustic monitoring is armed. Any detected fighting, beating, bullying, weapon, or loud distress triggers an immediate screen popup and logs here.
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
                className={`px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                  alert.acknowledged
                    ? 'bg-transparent hover:bg-slate-50'
                    : isBullying
                      ? 'bg-orange-50/70 hover:bg-orange-100/70'
                      : isUnreadCritical
                        ? 'bg-red-50/70 hover:bg-red-100/70'
                        : 'bg-amber-50/70 hover:bg-amber-100/70'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 shrink-0">
                    {alert.severity === 'critical' ? (
                      <ShieldAlert
                        className={`w-4 h-4 ${isBullying ? 'text-orange-700' : 'text-red-600'}`}
                        aria-hidden="true"
                      />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-700" aria-hidden="true" />
                    )}
                  </div>

                  {alert.evidenceSnapshotUrl ? (
                    <img
                      src={alert.evidenceSnapshotUrl}
                      alt={`Snapshot for ${alert.classroomName}`}
                      className="hidden sm:block w-20 h-12 object-cover rounded border border-slate-200 shrink-0"
                    />
                  ) : null}

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                      {isDisaster ? (() => {
                        const phaseMeta = classifyDisasterPhase(alert);
                        const phaseCls =
                          phaseMeta.phase === 1
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : phaseMeta.phase === 2
                              ? 'bg-red-100 text-red-900 border border-red-300'
                              : 'bg-blue-100 text-blue-900 border border-blue-300';
                        return (
                          <span
                            data-testid={`alert-disaster-phase-${phaseMeta.phase}`}
                            className={`text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded ${phaseCls}`}
                          >
                            {phaseMeta.shortTag}
                          </span>
                        );
                      })() : null}
                      <span
                        className={`text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded ${
                          isBullying
                            ? 'bg-orange-600 text-white'
                            : alert.severity === 'critical'
                              ? 'bg-red-600 text-white'
                              : badge.tone === 'attendance'
                                ? 'bg-slate-200 text-white'
                                : 'bg-amber-600 text-white'
                        }`}
                      >
                        {badge.label}
                      </span>
                      <span>{alert.headline}</span>
                      {typeof alert.threatScore === 'number' && alert.severity === 'critical' ? (
                        <span className="text-[11px] font-mono text-red-700 tabular-nums">
                          {alert.threatScore}/100
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

                    <p className="text-xs text-slate-500">
                      <span className="font-mono text-slate-700 tabular-nums">{alert.cameraCode}</span>
                      <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
                      <span className="tabular-nums">
                        {alert.studentCount} {alert.studentCount === 1 ? labels.personSingular : labels.personPlural}
                      </span>
                      <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
                      <span>{alert.voiceCue}</span>
                      {alert.modelUsed ? (
                        <>
                          <span aria-hidden="true" className="mx-1.5 text-slate-500">·</span>
                          <span className="font-mono text-slate-500">{alert.modelUsed}</span>
                        </>
                      ) : null}
                    </p>

                    {alert.details ? (
                      <p className="text-xs text-slate-500">{alert.details}</p>
                    ) : null}
                    {alert.recommendedAction ? (
                      <p className="text-xs font-medium text-slate-700">
                        Action: {alert.recommendedAction}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNotifyTeacher(alert)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border cursor-pointer whitespace-nowrap ${
                      isDisaster
                        ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                        : 'border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200'
                    }`}
                  >
                    {isDisaster ? (
                      <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {alert.teacherNotified
                        ? isDisaster
                          ? 'PA Sent'
                          : 'Notified'
                        : isDisaster
                          ? 'PA Broadcast'
                          : 'Notify'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onFocusCamera(alert.cameraId)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>View</span>
                  </button>
                  {!alert.acknowledged ? (
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Acknowledge</span>
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500 px-2">Acknowledged</span>
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
