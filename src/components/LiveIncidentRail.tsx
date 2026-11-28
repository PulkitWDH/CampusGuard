import { useState } from 'react';
import { Check, CheckCircle2, Eye, Mail, ShieldAlert, Volume2 } from 'lucide-react';
import type { FacilityMode, IncidentAlert, OperationMode } from '../types';
import {
  filterIncidentAlerts,
  formatAlertCategoryBadge,
  formatFacilityLabels,
} from '../utils/monitoringLogic';

interface LiveIncidentRailProps {
  alerts: IncidentAlert[];
  facilityMode: FacilityMode;
  operationMode?: OperationMode;
  onAcknowledgeAlert: (alertId: string) => void;
  onAcknowledgeAll: () => void;
  onFocusCamera: (cameraId: string) => void;
  onNotifyTeacher: (alert: IncidentAlert) => void;
  onViewAllIncidents: () => void;
}

export function LiveIncidentRail({
  alerts,
  facilityMode,
  operationMode = 'school',
  onAcknowledgeAlert,
  onAcknowledgeAll,
  onFocusCamera,
  onNotifyTeacher,
  onViewAllIncidents,
}: LiveIncidentRailProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'critical'>('all');
  const isDisaster = operationMode === 'disaster';
  const labels = formatFacilityLabels(facilityMode);
  const visible = filterIncidentAlerts(alerts, filterMode, 'all');
  const unreadCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <aside
      aria-label="Live incident stream"
      data-testid="live-incident-rail"
      className="w-full xl:w-[320px] shrink-0 bg-white border-t xl:border-t-0 xl:border-l border-slate-200 flex flex-col"
    >
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold text-slate-900 whitespace-nowrap">
            Live Alerts
          </h2>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {unreadCount} open
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={onAcknowledgeAll}
              className="text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer whitespace-nowrap"
            >
              Clear all
            </button>
          ) : null}
          <button
            type="button"
            onClick={onViewAllIncidents}
            className="text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer whitespace-nowrap"
          >
            View log
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-4 py-2 border-b border-slate-200/80 flex items-center gap-1 bg-slate-50/50">
        {(
          [
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread' },
            { id: 'critical', label: 'Critical' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilterMode(tab.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              filterMode === tab.id
                ? 'bg-white text-slate-900 border border-slate-200 shadow-2xs'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Incident Stream */}
      <div className="flex-1 overflow-y-auto max-h-[520px] xl:max-h-[calc(100vh-145px)]">
        {visible.length === 0 ? (
          <div className="px-5 py-12 text-center space-y-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 mx-auto" aria-hidden="true" />
            <p className="text-xs font-medium text-slate-800">All clear</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              {isDisaster
                ? 'Stampede warnings, hazard breaches, evacuee Re-ID matches, and distress alerts appear here immediately.'
                : 'Verified fights, weapons, breaches, and distress alerts appear here immediately.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200" data-testid="rail-alerts-list">
            {visible.slice(0, 20).map((alert) => {
              const badge = formatAlertCategoryBadge(alert);
              const isCritical = alert.severity === 'critical';
              const isBullying = badge.tone === 'bullying';
              const cleanHeadline = alert.headline.replace(
                /^(?:CRITICAL|BEATING ALERT|BULLYING ALERT|FIGHT ALERT|Teacher Sound Alert):\s*/i,
                ''
              );
              return (
                <li
                  key={alert.id}
                  className={`p-3.5 space-y-2 transition-colors ${
                    alert.acknowledged
                      ? 'bg-white opacity-65 hover:opacity-100'
                      : isBullying
                        ? 'bg-orange-50/70'
                        : isCritical
                          ? 'bg-red-50/70'
                          : 'bg-amber-50/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ShieldAlert
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isBullying
                            ? 'text-orange-600'
                            : isCritical
                              ? 'text-red-600'
                              : 'text-amber-600'
                        }`}
                        aria-hidden="true"
                      />
                      <span
                        className={`text-[11px] font-mono font-semibold truncate ${
                          isBullying
                            ? 'text-orange-700'
                            : isCritical
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                      {new Date(alert.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-900 leading-snug">
                    {cleanHeadline}
                  </p>

                  {alert.evidenceSnapshotUrl ? (
                    <img
                      src={alert.evidenceSnapshotUrl}
                      alt={`Evidence from ${alert.classroomName}`}
                      className="w-full h-24 object-cover rounded-md border border-slate-200"
                    />
                  ) : null}

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    <span className="font-mono text-slate-700">{alert.cameraCode}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="tabular-nums">
                      {alert.studentCount}{' '}
                      {alert.studentCount === 1 ? labels.personSingular : labels.personPlural}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>{alert.voiceCue}</span>
                  </p>

                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => onFocusCamera(alert.cameraId)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Eye className="w-3 h-3" aria-hidden="true" />
                      <span>Inspect</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onNotifyTeacher(alert)}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border cursor-pointer ${
                        isDisaster
                          ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {isDisaster ? (
                        <Volume2 className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <Mail className="w-3 h-3" aria-hidden="true" />
                      )}
                      <span>
                        {alert.teacherNotified
                          ? isDisaster
                            ? 'PA Sent'
                            : 'Sent'
                          : isDisaster
                            ? 'PA Speak'
                            : 'Notify'}
                      </span>
                    </button>
                    {!alert.acknowledged ? (
                      <button
                        type="button"
                        onClick={() => onAcknowledgeAlert(alert.id)}
                        aria-label={`Acknowledge ${alert.classroomName}`}
                        className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <Check className="w-3 h-3" aria-hidden="true" />
                        <span>Ack</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
