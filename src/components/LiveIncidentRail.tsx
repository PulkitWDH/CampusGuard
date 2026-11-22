import { useState } from 'react';
import { Check, CheckCircle2, Eye, Mail, ShieldAlert } from 'lucide-react';
import type { FacilityMode, IncidentAlert } from '../types';
import {
  filterIncidentAlerts,
  formatAlertCategoryBadge,
  formatFacilityLabels,
} from '../utils/monitoringLogic';

interface LiveIncidentRailProps {
  alerts: IncidentAlert[];
  facilityMode: FacilityMode;
  onAcknowledgeAlert: (alertId: string) => void;
  onAcknowledgeAll: () => void;
  onFocusCamera: (cameraId: string) => void;
  onNotifyTeacher: (alert: IncidentAlert) => void;
  onViewAllIncidents: () => void;
}

export function LiveIncidentRail({
  alerts,
  facilityMode,
  onAcknowledgeAlert,
  onAcknowledgeAll,
  onFocusCamera,
  onNotifyTeacher,
  onViewAllIncidents,
}: LiveIncidentRailProps) {
  const [filterMode, setFilterMode] = useState<'all' | 'unread' | 'critical'>('all');
  const labels = formatFacilityLabels(facilityMode);
  const visible = filterIncidentAlerts(alerts, filterMode, 'all');
  const unreadCount = alerts.filter((a) => !a.acknowledged).length;

  return (
    <aside
      aria-label="Live incident stream"
      data-testid="live-incident-rail"
      className="w-full xl:w-[340px] shrink-0 bg-[#0B0C0F] border-t xl:border-t-0 xl:border-l border-zinc-800/90 flex flex-col"
    >
      <div className="px-4 py-3 border-b border-zinc-800/90 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xs font-semibold text-zinc-100 whitespace-nowrap">
            Live Incidents
          </h2>
          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
            {unreadCount} open
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={onAcknowledgeAll}
              className="text-[11px] text-zinc-400 hover:text-zinc-100 cursor-pointer whitespace-nowrap"
            >
              Clear all
            </button>
          ) : null}
          <button
            type="button"
            onClick={onViewAllIncidents}
            className="text-[11px] text-zinc-400 hover:text-zinc-100 cursor-pointer whitespace-nowrap"
          >
            Full log
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-4 py-2 border-b border-zinc-800/80 flex items-center gap-1">
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
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
              filterMode === tab.id
                ? 'bg-zinc-800 text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-200'
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
            <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" aria-hidden="true" />
            <p className="text-xs font-medium text-zinc-300">All zones nominal</p>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Verified multi-person fights, beatings, weapons, and distress cues appear here immediately.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/80" data-testid="rail-alerts-list">
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
                      ? 'opacity-65 hover:opacity-100'
                      : isBullying
                        ? 'bg-orange-950/20'
                        : isCritical
                          ? 'bg-red-950/25'
                          : 'bg-amber-950/15'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ShieldAlert
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isBullying
                            ? 'text-orange-400'
                            : isCritical
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span
                        className={`text-[11px] font-mono font-semibold truncate ${
                          isBullying
                            ? 'text-orange-300'
                            : isCritical
                              ? 'text-red-300'
                              : 'text-amber-300'
                        }`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0">
                      {new Date(alert.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-zinc-100 leading-snug">
                    {cleanHeadline}
                  </p>

                  {alert.evidenceSnapshotUrl ? (
                    <img
                      src={alert.evidenceSnapshotUrl}
                      alt={`Evidence from ${alert.classroomName}`}
                      className="w-full h-24 object-cover rounded border border-zinc-800"
                    />
                  ) : null}

                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    <span className="font-mono text-zinc-300">{alert.cameraCode}</span>
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
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                    >
                      <Eye className="w-3 h-3" aria-hidden="true" />
                      <span>Inspect</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onNotifyTeacher(alert)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-zinc-800 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                    >
                      <Mail className="w-3 h-3" aria-hidden="true" />
                      <span>{alert.teacherNotified ? 'Sent' : 'Notify'}</span>
                    </button>
                    {!alert.acknowledged ? (
                      <button
                        type="button"
                        onClick={() => onAcknowledgeAlert(alert.id)}
                        aria-label={`Acknowledge ${alert.classroomName}`}
                        className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded bg-zinc-100 text-zinc-950 hover:bg-white cursor-pointer"
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
