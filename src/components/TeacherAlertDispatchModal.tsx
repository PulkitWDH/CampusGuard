import { useEffect, useState } from 'react';
import { Mail, MessageSquareWarning, Send, X } from 'lucide-react';
import type { IncidentAlert, WorkspaceCourse } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';

interface TeacherAlertDispatchModalProps {
  alert: IncidentAlert | null;
  defaultTeacherEmail: string;
  courses: WorkspaceCourse[];
  linkedCourseId: string;
  hasAccessToken: boolean;
  onGoogleSignIn: () => Promise<void>;
  onConfirmSendGmail: (params: {
    alertId: string;
    to: string;
    subject: string;
    body: string;
  }) => Promise<void>;
  onConfirmPostClassroom: (params: {
    alertId: string;
    courseId: string;
    text: string;
  }) => Promise<void>;
  onClose: () => void;
}

export function TeacherAlertDispatchModal({
  alert,
  defaultTeacherEmail,
  courses,
  linkedCourseId,
  hasAccessToken,
  onGoogleSignIn,
  onConfirmSendGmail,
  onConfirmPostClassroom,
  onClose,
}: TeacherAlertDispatchModalProps) {
  const [recipientEmail, setRecipientEmail] = useState(defaultTeacherEmail);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState(linkedCourseId);
  const [channel, setChannel] = useState<'gmail' | 'classroom'>('gmail');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!alert) return;
    setRecipientEmail(defaultTeacherEmail);
    setSubject(
      alert.teacherMessageSubject ||
        `[CampusGuard Alert] ${alert.headline}`
    );
    setBody(
      alert.teacherMessageBody ||
        [
          'Hello Teacher,',
          '',
          `Safety alert triggered in ${alert.classroomName} (${alert.cameraCode}).`,
          `Summary: ${alert.headline}`,
          `Voice/Audio cue: ${alert.voiceCue}`,
          `Estimated count: ${alert.studentCount}`,
          `Details: ${alert.details}`,
          `Time: ${alert.timestamp}`,
        ].join('\n')
    );
    setSelectedCourseId(linkedCourseId || courses[0]?.id || '');
    setError(null);
  }, [alert, courses, defaultTeacherEmail, linkedCourseId]);

  if (!alert) return null;

  const handleConfirm = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (channel === 'gmail') {
        if (!recipientEmail.trim()) {
          throw new Error('Please enter the teacher email address before sending.');
        }
        await onConfirmSendGmail({
          alertId: alert.id,
          to: recipientEmail.trim(),
          subject: subject.trim(),
          body: body.trim(),
        });
      } else {
        if (!selectedCourseId) {
          throw new Error('Select a Google Classroom course first.');
        }
        await onConfirmPostClassroom({
          alertId: alert.id,
          courseId: selectedCourseId,
          text: `${subject}\n\n${body}`,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send alert to teacher.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-dispatch-title"
      className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-300 rounded-xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquareWarning className="w-5 h-5 text-red-600 shrink-0" aria-hidden="true" />
            <h2 id="teacher-dispatch-title" className="text-base font-semibold text-slate-900 truncate">
              Confirm Teacher Alert Dispatch
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dispatch confirmation"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-900">
            <p className="font-semibold">{alert.headline}</p>
            <p className="mt-0.5 text-red-700">
              Review the exact message below before sending externally via Gmail or Google Classroom.
            </p>
          </div>

          {!hasAccessToken ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-700">
                Sign in with Google to authorize sending alerts via Gmail or posting to Google Classroom.
              </div>
              <GoogleSignInButton compact onClick={() => void onGoogleSignIn()} />
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setChannel('gmail')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                channel === 'gmail'
                  ? 'bg-blue-600/20 border-blue-500 text-blue-700'
                  : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Mail className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Send Email via Gmail</span>
            </button>
            <button
              type="button"
              onClick={() => setChannel('classroom')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                channel === 'classroom'
                  ? 'bg-blue-600/20 border-blue-500 text-blue-700'
                  : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Post to Google Classroom</span>
            </button>
          </div>

          {channel === 'gmail' ? (
            <div>
              <label htmlFor="teacher-email-input" className="block text-xs font-medium text-slate-700 mb-1">
                Teacher Recipient Email
              </label>
              <input
                id="teacher-email-input"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="teacher@school.edu"
                className="w-full text-sm px-3 py-2 border border-slate-300 bg-slate-50 rounded-lg text-slate-900 placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-blue-500"
              />
            </div>
          ) : (
            <div>
              <label htmlFor="classroom-course-select" className="block text-xs font-medium text-slate-700 mb-1">
                Google Classroom Course
              </label>
              <select
                id="classroom-course-select"
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                {courses.length === 0 ? (
                  <option value="">No active Classroom courses loaded</option>
                ) : (
                  courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.section ? ` (${c.section})` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="alert-subject-input" className="block text-xs font-medium text-slate-700 mb-1">
              Alert Subject
            </label>
            <input
              id="alert-subject-input"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-slate-300 bg-slate-50 rounded-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-500"
            />
          </div>

          <div>
            <label htmlFor="alert-body-textarea" className="block text-xs font-medium text-slate-700 mb-1">
              Alert Message to Teacher
            </label>
            <textarea
              id="alert-body-textarea"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-slate-300 bg-slate-50 rounded-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-500"
            />
          </div>

          {error ? (
            <p role="alert" className="text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-lg p-2.5">
              {error}
            </p>
          ) : null}
        </div>

        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !hasAccessToken}
            onClick={() => {
              void handleConfirm();
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {submitting
                ? 'Sending...'
                : channel === 'gmail'
                  ? 'Confirm & Send Gmail Alert'
                  : 'Confirm & Post Announcement'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
