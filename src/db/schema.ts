import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  defaultTeacherEmail: text('default_teacher_email'),
  linkedCourseId: text('linked_course_id'),
  linkedCourseName: text('linked_course_name'),
  facilityMode: text('facility_mode').notNull().default('all'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const monitoredZones = pgTable('monitored_zones', {
  id: text('id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  cameraCode: text('camera_code').notNull(),
  classroomName: text('classroom_name').notNull(),
  bluetoothDeviceName: text('bluetooth_device_name').notNull(),
  bluetoothAddress: text('bluetooth_address').notNull(),
  sourceKind: text('source_kind').notNull(),
  hasVideo: boolean('has_video').notNull().default(true),
  hasVoice: boolean('has_voice').notNull().default(true),
  voiceListeningEnabled: boolean('voice_listening_enabled').notNull().default(true),
  streamUrl: text('stream_url'),
  studentCount: integer('student_count').notNull().default(0),
  status: text('status').notNull().default('normal'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const incidentLogs = pgTable('incident_logs', {
  id: text('id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid, { onDelete: 'cascade' })
    .notNull(),
  cameraId: text('camera_id').notNull(),
  cameraCode: text('camera_code').notNull(),
  classroomName: text('classroom_name').notNull(),
  alertType: text('alert_type').notNull().default('ai-vision'),
  severity: text('severity').notNull(),
  threatCategory: text('threat_category'),
  modelUsed: text('model_used'),
  studentCount: integer('student_count').notNull().default(0),
  measuredDb: real('measured_db'),
  headline: text('headline').notNull(),
  voiceCue: text('voice_cue').notNull(),
  details: text('details').notNull(),
  teacherMessage: text('teacher_message'),
  teacherNotified: boolean('teacher_notified').notNull().default(false),
  acknowledged: boolean('acknowledged').notNull().default(false),
  timestamp: text('timestamp').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  zones: many(monitoredZones),
  incidents: many(incidentLogs),
}));

export const monitoredZonesRelations = relations(monitoredZones, ({ one }) => ({
  owner: one(users, {
    fields: [monitoredZones.userUid],
    references: [users.uid],
  }),
}));

export const incidentLogsRelations = relations(incidentLogs, ({ one }) => ({
  owner: one(users, {
    fields: [incidentLogs.userUid],
    references: [users.uid],
  }),
}));
