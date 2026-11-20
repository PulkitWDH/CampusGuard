import type { WorkspaceCourse, WorkspaceGmailMessage, WorkspaceTeacher } from '../types';
import { parseSafeJsonText } from '../utils/monitoringLogic';

async function readApiJson<T>(res: Response, fallbackLabel: string): Promise<T> {
  const text = await res.text();
  const parsed = parseSafeJsonText<T>(text);
  if (!parsed.ok) {
    throw new Error(`${fallbackLabel} returned an unexpected non-JSON response (HTTP ${res.status}).`);
  }
  return parsed.data;
}

export async function fetchClassroomCourses(accessToken: string): Promise<WorkspaceCourse[]> {
  const res = await fetch(
    'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=20',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const data = await readApiJson<{
    courses?: WorkspaceCourse[];
    error?: { message?: string };
  }>(res, 'Google Classroom API');
  if (!res.ok) {
    throw new Error(data.error?.message || `Google Classroom API error (${res.status})`);
  }
  return data.courses ?? [];
}

export async function fetchCourseRosterInfo(
  accessToken: string,
  courseId: string
): Promise<{ teachers: WorkspaceTeacher[]; studentCount: number }> {
  const [teachersRes, studentsRes] = await Promise.all([
    fetch(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/teachers`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
    fetch(
      `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/students?pageSize=100`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    ),
  ]);

  const teachersJson = await readApiJson<{
    teachers?: Array<{
      userId: string;
      profile?: { name?: { fullName?: string }; emailAddress?: string };
    }>;
  }>(teachersRes, 'Google Classroom teachers API');
  const studentsJson = await readApiJson<{
    students?: Array<unknown>;
  }>(studentsRes, 'Google Classroom students API');

  const teachers: WorkspaceTeacher[] = (teachersJson.teachers ?? []).map((t) => ({
    userId: t.userId,
    name: t.profile?.name?.fullName || 'Teacher',
    email: t.profile?.emailAddress,
  }));

  return {
    teachers,
    studentCount: (studentsJson.students ?? []).length,
  };
}

export async function postClassroomAnnouncement(
  accessToken: string,
  courseId: string,
  text: string
): Promise<{ id: string; alternateLink?: string }> {
  const res = await fetch(
    `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/announcements`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        state: 'PUBLISHED',
      }),
    }
  );
  const data = await readApiJson<{
    id?: string;
    alternateLink?: string;
    error?: { message?: string };
  }>(res, 'Google Classroom announcement API');
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `Unable to post Classroom announcement (${res.status})`);
  }
  return { id: data.id, alternateLink: data.alternateLink };
}

function getHeaderValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  targetName: string
): string {
  const match = headers?.find((h) => h.name?.toLowerCase() === targetName.toLowerCase());
  return match?.value || '';
}

export async function fetchRecentGmailMessages(
  accessToken: string,
  maxResults = 6
): Promise<WorkspaceGmailMessage[]> {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const listData = await readApiJson<{
    messages?: Array<{ id: string; threadId: string }>;
    error?: { message?: string };
  }>(listRes, 'Gmail API');
  if (!listRes.ok) {
    throw new Error(listData.error?.message || `Gmail API error (${listRes.status})`);
  }

  const ids = (listData.messages ?? []).slice(0, maxResults);
  if (ids.length === 0) return [];

  const details = await Promise.all(
    ids.map(async (item) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!msgRes.ok) return null;
      const msgJson = await readApiJson<{
        id: string;
        threadId: string;
        snippet?: string;
        payload?: { headers?: Array<{ name?: string; value?: string }> };
      }>(msgRes, 'Gmail message API');
      return {
        id: msgJson.id,
        threadId: msgJson.threadId,
        subject: getHeaderValue(msgJson.payload?.headers, 'Subject') || '(No subject)',
        from: getHeaderValue(msgJson.payload?.headers, 'From') || 'Unknown sender',
        date: getHeaderValue(msgJson.payload?.headers, 'Date') || '',
        snippet: msgJson.snippet || '',
      } satisfies WorkspaceGmailMessage;
    })
  );

  return details.filter((m): m is WorkspaceGmailMessage => m !== null);
}

function encodeBase64UrlUtf8(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendTeacherGmailAlert(
  accessToken: string,
  params: { to: string; subject: string; body: string }
): Promise<{ id: string }> {
  const cleanTo = params.to.trim();
  if (!cleanTo) {
    throw new Error('Teacher email address is required.');
  }

  const rfc2822 = [
    `To: ${cleanTo}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    params.body,
  ].join('\r\n');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodeBase64UrlUtf8(rfc2822),
    }),
  });

  const data = await readApiJson<{ id?: string; error?: { message?: string } }>(
    res,
    'Gmail send API'
  );
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message || `Failed to send Gmail alert (${res.status})`);
  }
  return { id: data.id };
}

