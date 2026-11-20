import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string | null
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName: displayName ?? null,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName: displayName ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to sync user profile. Please try again later.', {
      cause: error,
    });
  }
}

export async function updateUserPreferences(
  uid: string,
  prefs: {
    defaultTeacherEmail?: string | null;
    linkedCourseId?: string | null;
    linkedCourseName?: string | null;
    facilityMode?: 'all' | 'bank' | 'school';
  }
) {
  try {
    const result = await db
      .update(users)
      .set({
        ...(prefs.defaultTeacherEmail !== undefined
          ? { defaultTeacherEmail: prefs.defaultTeacherEmail }
          : {}),
        ...(prefs.linkedCourseId !== undefined
          ? { linkedCourseId: prefs.linkedCourseId }
          : {}),
        ...(prefs.linkedCourseName !== undefined
          ? { linkedCourseName: prefs.linkedCourseName }
          : {}),
        ...(prefs.facilityMode !== undefined
          ? { facilityMode: prefs.facilityMode }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.uid, uid))
      .returning();

    return result[0] ?? null;
  } catch (error) {
    console.error('Database query failed in updateUserPreferences:', error);
    throw new Error('Failed to update operator preferences.', {
      cause: error,
    });
  }
}
