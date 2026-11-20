import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { incidentLogs, monitoredZones } from './schema.ts';

export async function listUserWorkspaceData(uid: string) {
  try {
    const [zones, incidents] = await Promise.all([
      db
        .select()
        .from(monitoredZones)
        .where(eq(monitoredZones.userUid, uid))
        .orderBy(monitoredZones.createdAt),
      db
        .select()
        .from(incidentLogs)
        .where(eq(incidentLogs.userUid, uid))
        .orderBy(desc(incidentLogs.createdAt))
        .limit(50),
    ]);
    return { zones, incidents };
  } catch (error) {
    console.error('Database query failed in listUserWorkspaceData:', error);
    throw new Error('Unable to load persisted security workspace data.', {
      cause: error,
    });
  }
}

export async function upsertMonitoredZone(
  uid: string,
  zone: {
    id: string;
    cameraCode: string;
    classroomName: string;
    bluetoothDeviceName: string;
    bluetoothAddress: string;
    sourceKind: string;
    hasVideo: boolean;
    hasVoice: boolean;
    voiceListeningEnabled: boolean;
    streamUrl?: string | null;
    studentCount: number;
    status: string;
  }
) {
  try {
    const result = await db
      .insert(monitoredZones)
      .values({
        id: zone.id,
        userUid: uid,
        cameraCode: zone.cameraCode,
        classroomName: zone.classroomName,
        bluetoothDeviceName: zone.bluetoothDeviceName,
        bluetoothAddress: zone.bluetoothAddress,
        sourceKind: zone.sourceKind,
        hasVideo: zone.hasVideo,
        hasVoice: zone.hasVoice,
        voiceListeningEnabled: zone.voiceListeningEnabled,
        streamUrl: zone.streamUrl ?? null,
        studentCount: zone.studentCount,
        status: zone.status,
      })
      .onConflictDoUpdate({
        target: monitoredZones.id,
        set: {
          classroomName: zone.classroomName,
          voiceListeningEnabled: zone.voiceListeningEnabled,
          studentCount: zone.studentCount,
          status: zone.status,
          updatedAt: new Date(),
        },
        where: eq(monitoredZones.userUid, uid),
      })
      .returning();

    return result[0] ?? null;
  } catch (error) {
    console.error('Database query failed in upsertMonitoredZone:', error);
    throw new Error('Unable to save monitored camera zone.', { cause: error });
  }
}

export async function deleteMonitoredZone(uid: string, zoneId: string) {
  try {
    await db
      .delete(monitoredZones)
      .where(and(eq(monitoredZones.id, zoneId), eq(monitoredZones.userUid, uid)));
  } catch (error) {
    console.error('Database query failed in deleteMonitoredZone:', error);
    throw new Error('Unable to delete monitored camera zone.', { cause: error });
  }
}

export async function upsertIncidentLog(
  uid: string,
  incident: {
    id: string;
    cameraId: string;
    cameraCode: string;
    classroomName: string;
    alertType?: string;
    severity: string;
    threatCategory?: string | null;
    modelUsed?: string | null;
    studentCount: number;
    measuredDb?: number | null;
    headline: string;
    voiceCue: string;
    details: string;
    teacherMessage?: string | null;
    teacherNotified?: boolean;
    acknowledged: boolean;
    timestamp: string;
  }
) {
  try {
    const result = await db
      .insert(incidentLogs)
      .values({
        id: incident.id,
        userUid: uid,
        cameraId: incident.cameraId,
        cameraCode: incident.cameraCode,
        classroomName: incident.classroomName,
        alertType: incident.alertType ?? 'ai-vision',
        severity: incident.severity,
        threatCategory: incident.threatCategory ?? null,
        modelUsed: incident.modelUsed ?? null,
        studentCount: incident.studentCount,
        measuredDb: incident.measuredDb ?? null,
        headline: incident.headline,
        voiceCue: incident.voiceCue,
        details: incident.details,
        teacherMessage: incident.teacherMessage ?? null,
        teacherNotified: Boolean(incident.teacherNotified),
        acknowledged: Boolean(incident.acknowledged),
        timestamp: incident.timestamp,
      })
      .onConflictDoUpdate({
        target: incidentLogs.id,
        set: {
          acknowledged: Boolean(incident.acknowledged),
          teacherNotified: Boolean(incident.teacherNotified),
          updatedAt: new Date(),
        },
        where: eq(incidentLogs.userUid, uid),
      })
      .returning();

    return result[0] ?? null;
  } catch (error) {
    console.error('Database query failed in upsertIncidentLog:', error);
    throw new Error('Unable to save incident log entry.', { cause: error });
  }
}

export async function updateIncidentStatus(
  uid: string,
  incidentId: string,
  updates: { acknowledged?: boolean; teacherNotified?: boolean }
) {
  try {
    const result = await db
      .update(incidentLogs)
      .set({
        ...(updates.acknowledged !== undefined ? { acknowledged: updates.acknowledged } : {}),
        ...(updates.teacherNotified !== undefined
          ? { teacherNotified: updates.teacherNotified }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(incidentLogs.id, incidentId), eq(incidentLogs.userUid, uid)))
      .returning();

    return result[0] ?? null;
  } catch (error) {
    console.error('Database query failed in updateIncidentStatus:', error);
    throw new Error('Unable to update incident status.', { cause: error });
  }
}

export async function acknowledgeAllUserIncidents(uid: string) {
  try {
    await db
      .update(incidentLogs)
      .set({ acknowledged: true, updatedAt: new Date() })
      .where(eq(incidentLogs.userUid, uid));
  } catch (error) {
    console.error('Database query failed in acknowledgeAllUserIncidents:', error);
    throw new Error('Unable to acknowledge incidents.', { cause: error });
  }
}

export async function clearAcknowledgedUserIncidents(uid: string) {
  try {
    await db
      .delete(incidentLogs)
      .where(and(eq(incidentLogs.userUid, uid), eq(incidentLogs.acknowledged, true)));
  } catch (error) {
    console.error('Database query failed in clearAcknowledgedUserIncidents:', error);
    throw new Error('Unable to clear acknowledged incidents.', { cause: error });
  }
}
