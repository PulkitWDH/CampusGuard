import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { getOrCreateUser, updateUserPreferences } from './src/db/users.ts';
import {
  acknowledgeAllUserIncidents,
  clearAcknowledgedUserIncidents,
  deleteMonitoredZone,
  listUserWorkspaceData,
  updateIncidentStatus,
  upsertIncidentLog,
  upsertMonitoredZone,
} from './src/db/repository.ts';
import { filterVerifiedPersonDetections } from './src/utils/monitoringLogic.ts';
import {
  buildWindowsLauncherEntries,
  buildZipArchive,
  isSafeZipProjectPath,
  type ZipInputEntry,
} from './src/utils/zipBuilder.ts';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 3000);

type AiEngineModel = 'gemini-4-neon' | 'gemini-4-hydrogen' | 'gpt-6-astra' | 'gpt-6-sol';
type FacilityMode = 'all' | 'bank' | 'school';
type ThreatCategory =
  | 'none'
  | 'fight'
  | 'beating'
  | 'bullying'
  | 'robbery_or_weapon'
  | 'intrusion'
  | 'disturbance';

interface AnalyzeClassroomRequest {
  classroomName?: string;
  facilityMode?: FacilityMode;
  imageBase64?: string;
  previousFrameBase64?: string;
  imageMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  voiceTranscript?: string;
  audioLevel?: number;
  audioSpikeDetected?: boolean;
  aiModel?: AiEngineModel;
}

interface DetectedPersonBox {
  label: string;
  box_2d: [number, number, number, number];
  confidence: number;
}

interface ParsedAnalysisResult {
  studentCount: number;
  detectedPeople: DetectedPersonBox[];
  isFighting: boolean;
  severity: 'none' | 'warning' | 'critical';
  threatCategory: ThreatCategory;
  threatScore: number;
  detectedBehaviors: string[];
  recommendedAction: string;
  voiceAnalysis: string;
  fightReason: string;
  summary: string;
  confidence: number;
  analyzedAt: string;
  modelUsed: AiEngineModel;
  fallbackNote?: string;
}

function hasValidGeminiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function hasValidOpenAiKey(): boolean {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key !== 'MY_OPENAI_API_KEY');
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add a valid key in Settings > Secrets to run Gemini analysis.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildSafetyPrompt(
  zoneName: string,
  facilityMode: FacilityMode,
  voiceTranscript: string,
  audioLevel: number | null,
  audioSpikeDetected: boolean,
  hasPreviousFrame: boolean
): string {
  const roleHeader =
    facilityMode === 'bank'
      ? `You are a mission-critical bank & financial vault CCTV vision and audio safety analyst monitoring "${zoneName}".`
      : facilityMode === 'school'
        ? `You are a school campus CCTV vision and voice-recognition analyst monitoring "${zoneName}".`
        : `You are a high-security CCTV vision and audio safety analyst monitoring "${zoneName}" (suitable for banks, schools, offices, and public facilities).`;

  const countInstruction =
    facilityMode === 'school'
      ? '1. GROUNDED PERSON LOCALIZATION (STRICT & OCCLUSION-AWARE): Locate EVERY living human actively visible in the SINGLE CURRENT LIVE FRAME — INCLUDING anyone whose face/head is intentionally or partially covered by a racket, book, hand, bag, mask, hat, hood, or furniture (identify them by shoulders, torso, arms, hands, clothing, and posture, and label them e.g. "Person (face covered by racket)"). ONE whole person = ONE single tight bounding box [ymin, xmin, ymax, xmax] (0-1000 scale). NEVER split one person into two boxes. NEVER count hanging coats/clothes on hooks, empty chairs, desks, pillows, curtains, shadows, posters, or reflections. If no real human is visible, return detectedPeople: [] and studentCount: 0.'
      : '1. GROUNDED PERSON LOCALIZATION (STRICT & OCCLUSION-AWARE): Locate EVERY living human actively visible in the SINGLE CURRENT LIVE FRAME — INCLUDING anyone whose face/head is covered or obscured by a racket, object, mask, helmet, hood, book, bag, or hands (identify them by shoulders, torso, arms, legs, and posture, label them e.g. "Person (face concealed)", and note intentional face concealment in detectedBehaviors). ONE whole person = ONE single tight bounding box [ymin, xmin, ymax, xmax] (0-1000 scale). NEVER split one person into two boxes. NEVER count hanging coats/bags on walls, empty chairs, furniture, pillows, curtains, reflections, posters, or shadows. If no real human is visible, return detectedPeople: [] and studentCount: 0.';

  const threatInstruction =
    facilityMode === 'bank'
      ? '2. Determine isFighting (boolean): true if ANY physical fighting, beating/assault, bullying/intimidation, grappling, robbery/holdup posture (hands raised in duress, forced kneeling, vault/teller threat), visible weapon (firearm, knife, blunt object), person knocked to the ground, or forced intrusion/breach is visible OR severe distress/robbery/beating shouting ("hands up", "robbery", "stop beating", "help", screaming, glass breaking, alarm) is present.'
      : facilityMode === 'school'
        ? '2. Determine isFighting (boolean): true if physical fighting, beating (repeated striking, kicking, slapping, stomping, or hitting a defenseless/cornered student), bullying (cornering, surrounding, shoving, tripping, snatching belongings, mocking/intimidation), grappling, hair-pulling, or someone pinned/knocked down is visible OR severe fight/beating/bullying distress shouting ("stop beating me", "stop hitting", "stop bullying", "leave me alone", "help", screaming) is detected in audio/voice.'
        : '2. Determine isFighting (boolean): true if physical fighting, beating (striking, kicking, stomping, whipping, one-sided physical assault), bullying (cornering, shoving, surrounding, intimidating, grabbing belongings), grappling, person knocked down, robbery/holdup posture, visible weapon threat, or forced intrusion is visible OR severe distress/beating/bullying shouting ("stop beating", "stop bullying", "leave me alone", "help", "hands up", "robbery", screaming, alarm) is detected in audio/voice.';

  const lines = [
    roleHeader,
    'Inspect the SINGLE CURRENT LIVE FRAME and any supplied audio/voice transcript carefully. Never fabricate threats or people.',
    countInstruction,
    threatInstruction,
    '3. Set studentCount strictly equal to detectedPeople.length. Label each person clearly by location and note if their face is covered (e.g. "Person (at desk)", "Person (face covered by racket)").',
    '4. Set threatCategory to one of: "none" (calm/orderly), "beating" (one-sided beating, repeated striking/kicking/slapping/stomping a victim), "bullying" (intimidation, cornering/surrounding a victim, shoving, tripping, taking belongings, verbal harassment), "fight" (mutual physical altercation/grappling), "robbery_or_weapon" (holdup, weapon, armed threat, teller intimidation), "intrusion" (forced entry/breach/tampering), or "disturbance" (loud shouting/panic without confirmed physical contact or bullying).',
    '5. Set severity to "critical" if threatCategory is "beating", "bullying", "fight", "robbery_or_weapon", or "intrusion" (or isFighting is true); "warning" if threatCategory is "disturbance"; or "none" if calm and orderly.',
    '6. Set threatScore (0 to 100 integer): 0-20 for calm, 45-70 for verbal disturbance, 78-90 for bullying/fight, 90-100 for beating/weapon/robbery/intrusion.',
    '7. Set detectedBehaviors to a short array of specific visual/acoustic cues observed (e.g. ["Repeated striking / beating", "Student cornered by group", "Face concealed by held object"] or [] if calm).',
    '8. Set recommendedAction to a concrete 1-sentence instruction for the teacher or security team (e.g. "Intervene immediately, stop the beating, and summon medical/security support." or "No action needed; zone is calm.").',
    '9. Summarize voice/audio recognition state concisely in voiceAnalysis, factual summary in summary, and reason for alert in fightReason (empty string if calm).',
    '10. Provide overall confidence from 0 to 100.',
  ];

  if (voiceTranscript) {
    lines.push(`Voice recognition transcript from zone microphone: "${voiceTranscript}"`);
  }
  if (audioLevel !== null) {
    lines.push(`Measured zone sound level: ${audioLevel.toFixed(1)} dB SPL (teacher sustained sound alert threshold 90.1 dB > 3s).`);
  }
  if (audioSpikeDetected) {
    lines.push('ALERT CONTEXT: A sudden loud audio spike was just detected by the zone microphone.');
  }
  return lines.join('\n');
}

function safeParseJson<T>(rawText: string): T {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned) as T;
}

function normalizeModelOutput(
  parsed: {
    studentCount?: number;
    detectedPeople?: Array<{ label?: string; box_2d?: number[]; confidence?: number }>;
    isFighting?: boolean;
    severity?: string;
    threatCategory?: string;
    threatScore?: number;
    detectedBehaviors?: string[];
    recommendedAction?: string;
    voiceAnalysis?: string;
    fightReason?: string;
    summary?: string;
    confidence?: number;
  },
  modelUsed: AiEngineModel,
  hasImage: boolean
): ParsedAnalysisResult {
  const validCategories: ThreatCategory[] = [
    'none',
    'fight',
    'beating',
    'bullying',
    'robbery_or_weapon',
    'intrusion',
    'disturbance',
  ];
  const threatCategory: ThreatCategory = validCategories.includes(
    parsed.threatCategory as ThreatCategory
  )
    ? (parsed.threatCategory as ThreatCategory)
    : parsed.isFighting
      ? 'fight'
      : parsed.severity === 'warning'
        ? 'disturbance'
        : 'none';

  const criticalThreat =
    Boolean(parsed.isFighting) ||
    parsed.severity === 'critical' ||
    threatCategory === 'fight' ||
    threatCategory === 'beating' ||
    threatCategory === 'bullying' ||
    threatCategory === 'robbery_or_weapon' ||
    threatCategory === 'intrusion';

  const normalizedSeverity: ParsedAnalysisResult['severity'] = criticalThreat
    ? 'critical'
    : parsed.severity === 'warning' || threatCategory === 'disturbance'
      ? 'warning'
      : 'none';

  const defaultScore = criticalThreat ? 88 : normalizedSeverity === 'warning' ? 55 : 8;
  const threatScore =
    typeof parsed.threatScore === 'number' && Number.isFinite(parsed.threatScore)
      ? Math.min(100, Math.max(0, Math.round(parsed.threatScore)))
      : defaultScore;

  const detectedBehaviors = Array.isArray(parsed.detectedBehaviors)
    ? parsed.detectedBehaviors.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
    : [];

  // Strictly ground headcount to high-confidence deduplicated human bounding boxes on the CURRENT frame
  const verifiedPeople = hasImage
    ? filterVerifiedPersonDetections(parsed.detectedPeople, 78)
    : [];
  const groundedCount = hasImage ? verifiedPeople.length : 0;

  return {
    studentCount: groundedCount,
    detectedPeople: verifiedPeople,
    isFighting: criticalThreat,
    severity: normalizedSeverity,
    threatCategory,
    threatScore,
    detectedBehaviors,
    recommendedAction:
      parsed.recommendedAction?.trim() ||
      (criticalThreat
        ? 'Dispatch supervising staff or security immediately.'
        : normalizedSeverity === 'warning'
          ? 'Verify noise/disturbance on live feed.'
          : 'No action needed; zone is calm.'),
    voiceAnalysis: parsed.voiceAnalysis || 'Ambient zone audio monitored.',
    fightReason: parsed.fightReason || '',
    summary:
      hasImage && groundedCount === 0 && !criticalThreat
        ? 'No people detected in the current live frame (empty room).'
        : parsed.summary || 'Zone feed analyzed.',
    confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 85))),
    analyzedAt: new Date().toISOString(),
    modelUsed,
  };
}

class ProviderApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function formatAiProviderError(err: unknown): { statusCode: number; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err || 'Failed to analyze camera feed.');
  const errObj = err as { status?: number; statusCode?: number; code?: number } | null;
  let statusCode = Number(errObj?.statusCode || errObj?.status || 0);
  let extractedMessage = rawMsg;

  const jsonStart = rawMsg.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(rawMsg.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string; type?: string };
      };
      if (parsed?.error) {
        if (!statusCode && typeof parsed.error.code === 'number') {
          statusCode = parsed.error.code;
        }
        if (parsed.error.message) {
          extractedMessage = parsed.error.message;
        }
      }
    } catch {
      // keep original message when substring is not valid JSON
    }
  }

  const lower = `${rawMsg} ${extractedMessage}`.toLowerCase();
  if (
    statusCode === 429 ||
    lower.includes('resource_exhausted') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('insufficient_quota') ||
    lower.includes('rate limit')
  ) {
    return {
      statusCode: 429,
      message:
        'AI vision quota limit reached (HTTP 429). Wait briefly or connect a billing-enabled API key in Settings > Secrets.',
    };
  }

  if (
    statusCode === 401 ||
    statusCode === 403 ||
    lower.includes('invalid_api_key') ||
    lower.includes('api_key_invalid') ||
    lower.includes('unauthorized') ||
    lower.includes('permission_denied')
  ) {
    return {
      statusCode: statusCode === 403 ? 403 : 401,
      message:
        'AI API key is unauthorized or requires a paid tier for this model. Update your key in Settings > Secrets.',
    };
  }

  const cleanLine = extractedMessage.split('\n')[0].trim().slice(0, 260);
  return {
    statusCode: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
    message: cleanLine || 'Failed to analyze camera feed.',
  };
}

async function analyzeWithOpenAi(
  model: 'gpt-6-astra' | 'gpt-6-sol',
  reasoningEffort: 'high' | 'low',
  prompt: string,
  imageBase64?: string,
  previousFrameBase64?: string,
  imageMimeType?: string
): Promise<ParsedAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const displayName = model === 'gpt-6-astra' ? 'GPT-6 Astra' : 'GPT-6 Sol';
  if (!apiKey || apiKey === 'MY_OPENAI_API_KEY') {
    throw new Error(
      `OPENAI_API_KEY is not configured. Add OPENAI_API_KEY (or linked ChatGPT Pro API credits) in Settings > Secrets to run ${displayName}, or switch AI Engine to Gemini 4 Hydrogen.`
    );
  }

  const contentParts: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: prompt }];

  const mime = imageMimeType || 'image/jpeg';
  // Always send ONLY the single current live frame so the model can never double-count people across two frames
  if (imageBase64) {
    const cleaned = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    contentParts.push({
      type: 'text',
      text: 'CURRENT LIVE FRAME (COUNT AND BOX ONLY UNMISTAKABLE LIVING HUMANS VISIBLE RIGHT NOW):',
    });
    contentParts.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${cleaned}` },
    });
  }

  const controller = new AbortController();
  const timeoutMs = model === 'gpt-6-astra' ? 45000 : 25000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        reasoning_effort: reasoningEffort,
        messages: [
          {
            role: 'user',
            content: contentParts,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'classroom_safety_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                studentCount: { type: 'integer' },
                detectedPeople: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      label: { type: 'string' },
                      box_2d: {
                        type: 'array',
                        items: { type: 'integer' },
                      },
                      confidence: { type: 'integer' },
                    },
                    required: ['label', 'box_2d', 'confidence'],
                  },
                },
                isFighting: { type: 'boolean' },
                severity: { type: 'string', enum: ['none', 'warning', 'critical'] },
                threatCategory: {
                  type: 'string',
                  enum: ['none', 'fight', 'beating', 'bullying', 'robbery_or_weapon', 'intrusion', 'disturbance'],
                },
                threatScore: { type: 'integer' },
                detectedBehaviors: { type: 'array', items: { type: 'string' } },
                recommendedAction: { type: 'string' },
                voiceAnalysis: { type: 'string' },
                fightReason: { type: 'string' },
                summary: { type: 'string' },
                confidence: { type: 'number' },
              },
              required: [
                'studentCount',
                'detectedPeople',
                'isFighting',
                'severity',
                'threatCategory',
                'threatScore',
                'detectedBehaviors',
                'recommendedAction',
                'voiceAnalysis',
                'fightReason',
                'summary',
                'confidence',
              ],
            },
          },
        },
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${displayName} request timed out after ${timeoutMs / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errText = await response.text();
    const formatted = formatAiProviderError({
      statusCode: response.status,
      message: `${displayName} API error (${response.status}): ${errText}`,
    });
    throw new ProviderApiError(formatted.statusCode, formatted.message);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = data.choices?.[0]?.message?.content ?? '{}';
  return normalizeModelOutput(safeParseJson(rawContent), model, Boolean(imageBase64));
}

async function analyzeWithGemini(
  model: 'gemini-4-neon' | 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite',
  promptText: string,
  body: AnalyzeClassroomRequest
): Promise<ParsedAnalysisResult> {
  const ai = getGeminiClient();

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [];

  // Always send ONLY the single current live frame so the model can never double-count people across two frames
  if (body.imageBase64) {
    const cleanedBase64 = body.imageBase64.replace(/^data:image\/\w+;base64,/, '');
    parts.push({
      text: 'CURRENT LIVE FRAME (COUNT AND BOX ONLY UNMISTAKABLE LIVING HUMANS VISIBLE RIGHT NOW):',
    });
    parts.push({
      inlineData: {
        mimeType: body.imageMimeType || 'image/jpeg',
        data: cleanedBase64,
      },
    });
  }

  if (body.audioBase64) {
    const cleanedAudio = body.audioBase64.replace(/^data:audio\/[\w-]+;base64,/, '');
    parts.push({
      inlineData: {
        mimeType: body.audioMimeType || 'audio/webm',
        data: cleanedAudio,
      },
    });
  }

  parts.push({ text: promptText });

  const response = await ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          studentCount: {
            type: Type.INTEGER,
            description: 'Exact count of verified visible people in CURRENT LIVE FRAME (0 if room is empty).',
          },
          detectedPeople: {
            type: Type.ARRAY,
            description:
              'Empty array [] if no real person is visible in CURRENT LIVE FRAME. Otherwise one tight box per visible person.',
            items: {
              type: Type.OBJECT,
              properties: {
                label: {
                  type: Type.STRING,
                  description: 'Short label describing person and position (e.g. "Person 1 (at desk)").',
                },
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: 'Tight bounding box [ymin, xmin, ymax, xmax] normalized 0 to 1000.',
                },
                confidence: {
                  type: Type.INTEGER,
                  description: 'Detection certainty from 0 to 100.',
                },
              },
              required: ['label', 'box_2d', 'confidence'],
            },
          },
          isFighting: {
            type: Type.BOOLEAN,
            description:
              'True if physical fighting, beating, bullying/intimidation, assault, robbery/weapon threat, or forced intrusion is detected.',
          },
          severity: {
            type: Type.STRING,
            description: 'One of: none, warning, critical',
          },
          threatCategory: {
            type: Type.STRING,
            description: 'One of: none, fight, beating, bullying, robbery_or_weapon, intrusion, disturbance',
          },
          threatScore: {
            type: Type.INTEGER,
            description: 'Threat intensity score from 0 to 100.',
          },
          detectedBehaviors: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'List of observed risky behaviors or vocal cues.',
          },
          recommendedAction: {
            type: Type.STRING,
            description: 'Immediate recommended security or teacher response.',
          },
          voiceAnalysis: {
            type: Type.STRING,
            description: 'Concise analysis of zone voice and audio cues.',
          },
          fightReason: {
            type: Type.STRING,
            description: 'Reason for alert, or empty string if calm.',
          },
          summary: {
            type: Type.STRING,
            description: 'Brief summary of zone state and exact headcount.',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence score between 0 and 100.',
          },
        },
        required: [
          'studentCount',
          'detectedPeople',
          'isFighting',
          'severity',
          'threatCategory',
          'threatScore',
          'detectedBehaviors',
          'recommendedAction',
          'voiceAnalysis',
          'fightReason',
          'summary',
          'confidence',
        ],
      },
    },
  });

  const rawText = response.text ?? '{}';
  const reportedModel: AiEngineModel =
    model === 'gemini-3.1-flash-lite' ? 'gemini-4-hydrogen' : model;
  return normalizeModelOutput(safeParseJson(rawText), reportedModel, Boolean(body.imageBase64));
}

function classifyDiscoveredName(id: string, name: string, uuids: string[] = []) {
  const normalized = name.toLowerCase();
  return {
    id: `bt-${id}`,
    name,
    macAddress: id,
    serviceUuids: uuids,
    declaredCapabilities: {
      video: /cctv|cam|camera|dome|ipc|hikvision|axis|uniview|dahua|reolink|eufy|arlo|vision|tapo|wyze|ring|blink|ezviz|amcrest|lorex|bosch|hanwha|verkada|meraki|esp32|imou|v380|annke|swann|foscam|unifi|surveillance|nvr|dvr|ptz/i.test(
        normalized
      ),
      voice: /voice|mic|audio|av|talk|intercom|2way|two-way|hands-free|hfp|cctv|cam/i.test(
        normalized
      ),
    },
    sourceTransport: 'host-bluetooth' as const,
    discoveredAt: new Date().toISOString(),
  };
}

function hasLinuxBluetoothSysfs(): boolean {
  try {
    const entries = fs.readdirSync('/sys/class/bluetooth');
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function scanHostBluetoothDevices() {
  const platform = process.platform;

  if (platform === 'linux') {
    const hasSysfsAdapter = hasLinuxBluetoothSysfs();
    try {
      await execFileAsync('which', ['bluetoothctl'], { timeout: 2000 });
      if (!hasSysfsAdapter) {
        return {
          adapterAvailable: false,
          platform,
          devices: [],
          message:
            'This remote cloud server container has no physical Bluetooth radio. Use browser Web Bluetooth ("Pair Bluetooth Picker") in a standalone Chrome/Edge tab, or deploy this server on your local bank/school NVR computer.',
        };
      }
      try {
        await execFileAsync('bluetoothctl', ['--timeout', '3', 'scan', 'on'], { timeout: 4500 });
      } catch {
        // Scan may fail if permissions are limited; still inspect known devices
      }
      const { stdout } = await execFileAsync('bluetoothctl', ['devices'], { timeout: 3000 });
      const lines = stdout.split('\n').filter((l) => l.startsWith('Device '));
      const devices = lines.map((line) => {
        const parts = line.split(' ');
        const mac = parts[1] || 'UNKNOWN';
        const name = parts.slice(2).join(' ').trim() || mac;
        return classifyDiscoveredName(mac, name);
      });
      return {
        adapterAvailable: true,
        platform,
        devices,
        message:
          devices.length > 0
            ? `Found ${devices.length} Bluetooth device(s) on local Linux Bluetooth adapter.`
            : 'Local Linux Bluetooth adapter scanned: 0 nearby devices responded.',
      };
    } catch {
      return {
        adapterAvailable: false,
        platform,
        devices: [],
        message:
          'Cloud server has no local Bluetooth adapter. To scan your nearby devices, open the app in a standalone Chrome/Edge tab and use Web Bluetooth or Hardware Cameras & Mics.',
      };
    }
  }

  if (platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        'system_profiler',
        ['SPBluetoothDataType', '-json'],
        { timeout: 5000 }
      );
      const json = JSON.parse(stdout) as {
        SPBluetoothDataType?: Array<Record<string, unknown>>;
      };
      const entries: Array<{ id: string; name: string }> = [];
      for (const block of json.SPBluetoothDataType || []) {
        const connected = (block.device_connected || []) as Array<
          Record<string, { device_address?: string }>
        >;
        const notConnected = (block.device_not_connected || []) as Array<
          Record<string, { device_address?: string }>
        >;
        for (const group of [...connected, ...notConnected]) {
          for (const [devName, info] of Object.entries(group)) {
            entries.push({
              id: info?.device_address || devName,
              name: devName,
            });
          }
        }
      }
      const devices = entries.map((e) => classifyDiscoveredName(e.id, e.name));
      return {
        adapterAvailable: true,
        platform,
        devices,
        message: `Scanned macOS Bluetooth registry (${devices.length} devices found).`,
      };
    } catch {
      return {
        adapterAvailable: false,
        platform,
        devices: [],
        message: 'Unable to query macOS Bluetooth hardware.',
      };
    }
  }

  if (platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-PnpDevice -Class Bluetooth | Select-Object FriendlyName,InstanceId | ConvertTo-Json',
        ],
        { timeout: 5000 }
      );
      const parsed = JSON.parse(stdout || '[]');
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const devices = rows
        .filter((r) => r && r.FriendlyName)
        .map((r) =>
          classifyDiscoveredName(String(r.InstanceId || r.FriendlyName), String(r.FriendlyName))
        );
      return {
        adapterAvailable: true,
        platform,
        devices,
        message: `Scanned Windows Bluetooth devices (${devices.length} found).`,
      };
    } catch {
      return {
        adapterAvailable: false,
        platform,
        devices: [],
        message: 'Unable to query Windows Bluetooth devices.',
      };
    }
  }

  return {
    adapterAvailable: false,
    platform,
    devices: [],
    message: `Host Bluetooth scanning is not supported on platform "${platform}".`,
  };
}

async function extractFirstMjpegFrame(
  body: ReadableStream<Uint8Array>,
  controller: AbortController
): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const maxBytes = 4 * 1024 * 1024;

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(Buffer.from(value));
      totalBytes += value.byteLength;

      const combined = Buffer.concat(chunks);
      const startIdx = combined.indexOf(Buffer.from([0xff, 0xd8]));
      if (startIdx !== -1) {
        const endIdx = combined.indexOf(Buffer.from([0xff, 0xd9]), startIdx + 2);
        if (endIdx !== -1) {
          controller.abort();
          return combined.subarray(startIdx, endIdx + 2);
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
  }
  throw new Error('Could not extract a complete JPEG frame from MJPEG stream.');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/favicon.ico', (_req, res) => {
    const pngIcon = path.resolve(process.cwd(), 'public', 'pwa-192x192.png');
    const svgIcon = path.resolve(process.cwd(), 'public', 'icon.svg');
    if (fs.existsSync(pngIcon)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(pngIcon);
      return;
    }
    if (fs.existsSync(svgIcon)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(svgIcon);
      return;
    }
    res.status(204).end();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/ai/capabilities', (_req, res) => {
    const openaiConfigured = hasValidOpenAiKey();
    const geminiConfigured = hasValidGeminiKey();
    res.json({
      openaiConfigured,
      geminiConfigured,
      defaultModel: geminiConfigured ? 'gemini-4-hydrogen' : openaiConfigured ? 'gpt-6-astra' : 'gemini-4-hydrogen',
      serverPlatform: process.platform,
      hasLocalBluetoothHardware:
        process.platform === 'linux' ? hasLinuxBluetoothSysfs() : process.platform === 'darwin' || process.platform === 'win32',
    });
  });

  app.get('/api/bluetooth/scan', async (_req, res) => {
    const result = await scanHostBluetoothDevices();
    res.json(result);
  });

  const isBlockedMetadataHost = (hostname: string): boolean => {
    const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
    return (
      h === 'localhost' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      h.startsWith('127.') ||
      h.startsWith('169.254.') ||
      h === 'metadata.google.internal' ||
      h === 'metadata' ||
      h === '100.100.100.200' ||
      h === 'fd00:ec2::254'
    );
  };

  const fetchCameraSnapshotBuffer = async (
    rawUrl: string,
    timeoutMs = 7000
  ): Promise<{ buffer: Buffer; contentType: string; latencyMs: number }> => {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      const err = new Error('Only HTTP/HTTPS snapshot or MJPEG URLs are supported.') as Error & {
        status?: number;
      };
      err.status = 400;
      throw err;
    }
    if (isBlockedMetadataHost(parsed.hostname)) {
      const err = new Error('Restricted loopback or metadata address is not allowed.') as Error & {
        status?: number;
      };
      err.status = 400;
      throw err;
    }

    const headers: Record<string, string> = {};
    if (parsed.username || parsed.password) {
      const creds = Buffer.from(
        `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`
      ).toString('base64');
      headers.Authorization = `Basic ${creds}`;
      parsed.username = '';
      parsed.password = '';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const upstream = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers,
      });

      if (!upstream.ok) {
        clearTimeout(timeout);
        const err = new Error(`Camera feed returned HTTP ${upstream.status}`) as Error & {
          status?: number;
        };
        err.status = upstream.status;
        throw err;
      }

      const contentType = (upstream.headers.get('content-type') || 'image/jpeg').toLowerCase();

      if (contentType.includes('multipart/x-mixed-replace') && upstream.body) {
        const frameBuf = await extractFirstMjpegFrame(upstream.body, controller);
        clearTimeout(timeout);
        return {
          buffer: frameBuf,
          contentType: 'image/jpeg',
          latencyMs: Math.max(1, Date.now() - started),
        };
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      clearTimeout(timeout);
      return {
        buffer: buf,
        contentType,
        latencyMs: Math.max(1, Date.now() - started),
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  };

  app.get('/api/snapshot-proxy', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing url query parameter.' });
      return;
    }

    try {
      new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid camera stream URL.' });
      return;
    }

    try {
      const { buffer, contentType } = await fetchCameraSnapshotBuffer(rawUrl, 8000);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buffer);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? 'Camera snapshot request timed out.'
          : err instanceof Error
            ? err.message
            : 'Unable to reach camera snapshot URL.';
      res.status(status && status >= 400 && status < 600 ? status : 502).json({ error: message });
    }
  });

  app.post('/api/wifi-camera/test', async (req, res) => {
    const body = (req.body || {}) as { url?: string; probeCommonPaths?: boolean };
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ reachable: false, error: 'Missing Wi-Fi camera URL.' });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      res.status(400).json({ reachable: false, error: 'Invalid Wi-Fi camera URL.' });
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({
        reachable: false,
        error: 'Only HTTP/HTTPS Wi-Fi snapshot or MJPEG streams are supported.',
      });
      return;
    }

    if (isBlockedMetadataHost(parsed.hostname)) {
      res.status(400).json({ reachable: false, error: 'Restricted host address.' });
      return;
    }

    const candidates: string[] = [rawUrl];
    if (body.probeCommonPaths && (parsed.pathname === '/' || !parsed.pathname)) {
      const commonPaths = [
        '/shot.jpg',
        '/capture',
        '/snapshot.jpg',
        '/video',
        '/cgi-bin/snapshot.cgi?channel=1',
        '/ISAPI/Streaming/channels/101/picture',
      ];
      for (const pathSuffix of commonPaths) {
        const clone = new URL(parsed.toString());
        const qIdx = pathSuffix.indexOf('?');
        clone.pathname = qIdx >= 0 ? pathSuffix.slice(0, qIdx) : pathSuffix;
        if (qIdx >= 0) clone.search = pathSuffix.slice(qIdx);
        candidates.push(clone.toString());
      }
    }

    let lastError = 'Unable to reach Wi-Fi camera.';
    for (const candidateUrl of candidates) {
      try {
        const { buffer, contentType, latencyMs } = await fetchCameraSnapshotBuffer(
          candidateUrl,
          4500
        );
        if (!contentType.startsWith('image/') && buffer.length < 100) {
          lastError = `Endpoint responded with non-image content (${contentType}).`;
          continue;
        }
        const previewDataUrl =
          buffer.length > 0 && buffer.length <= 2_500_000
            ? `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`
            : undefined;
        res.json({
          reachable: true,
          resolvedUrl: candidateUrl,
          contentType,
          bytes: buffer.length,
          latencyMs,
          previewDataUrl,
        });
        return;
      } catch (err) {
        lastError =
          err instanceof Error && err.name === 'AbortError'
            ? 'Connection timed out — check camera IP, port, Wi-Fi network, or enable Direct LAN Browser mode.'
            : err instanceof Error
              ? err.message
              : 'Unable to reach Wi-Fi camera.';
      }
    }

    res.status(502).json({
      reachable: false,
      error: lastError,
    });
  });

  app.post('/api/analyze-classroom', async (req, res) => {
    try {
      const body = (req.body || {}) as AnalyzeClassroomRequest;
      const classroomName = (body.classroomName || 'Zone').trim();
      const facilityMode: FacilityMode =
        body.facilityMode === 'bank'
          ? 'bank'
          : body.facilityMode === 'school'
            ? 'school'
            : 'all';
      const voiceTranscript = (body.voiceTranscript || '').trim();
      const audioLevel = typeof body.audioLevel === 'number' ? body.audioLevel : null;
      const audioSpikeDetected = Boolean(body.audioSpikeDetected);
      const requestedModel: AiEngineModel =
        body.aiModel === 'gemini-4-neon'
          ? 'gemini-4-neon'
          : body.aiModel === 'gemini-4-hydrogen'
            ? 'gemini-4-hydrogen'
            : body.aiModel === 'gpt-6-sol'
              ? 'gpt-6-sol'
              : body.aiModel === 'gpt-6-astra'
                ? 'gpt-6-astra'
                : 'gemini-4-hydrogen';

      if (!body.imageBase64 && !body.audioBase64 && !voiceTranscript) {
        res.status(400).json({
          error:
            'No live video frame or audio/voice sample is available on this camera. Ensure the camera feed is live before scanning.',
        });
        return;
      }

      const promptText = buildSafetyPrompt(
        classroomName,
        facilityMode,
        voiceTranscript,
        audioLevel,
        audioSpikeDetected,
        Boolean(body.previousFrameBase64 && body.imageBase64)
      );

      // Build ordered live failover chain: requested model first, then free-tier Gemini models if quota/429 hits
      type CandidateCloudModel = AiEngineModel | 'gemini-3.1-flash-lite';
      const modelChain: CandidateCloudModel[] = [requestedModel];
      if (hasValidGeminiKey()) {
        if (!modelChain.includes('gemini-4-hydrogen')) modelChain.push('gemini-4-hydrogen');
        if (!modelChain.includes('gemini-3.1-flash-lite')) modelChain.push('gemini-3.1-flash-lite');
        if (!modelChain.includes('gemini-4-neon')) modelChain.push('gemini-4-neon');
      }

      let lastErr: unknown = null;
      let primaryFailureStatus: number | null = null;

      for (let i = 0; i < modelChain.length; i += 1) {
        const candidateModel = modelChain[i];
        try {
          let result: ParsedAnalysisResult;
          if (candidateModel === 'gpt-6-astra' || candidateModel === 'gpt-6-sol') {
            const effort = candidateModel === 'gpt-6-astra' ? 'high' : 'low';
            result = await analyzeWithOpenAi(
              candidateModel,
              effort,
              promptText,
              body.imageBase64,
              body.previousFrameBase64,
              body.imageMimeType
            );
          } else {
            result = await analyzeWithGemini(candidateModel, promptText, body);
          }

          if (i > 0) {
            result.fallbackNote = `${requestedModel} returned ${primaryFailureStatus || 'an error'} — switched live to ${candidateModel}.`;
          }
          res.json(result);
          return;
        } catch (candidateErr) {
          lastErr = candidateErr;
          const formatted = formatAiProviderError(candidateErr);
          if (i === 0) {
            primaryFailureStatus = formatted.statusCode;
          }
          const isRecoverableFailover =
            formatted.statusCode === 429 ||
            formatted.statusCode === 401 ||
            formatted.statusCode === 403 ||
            formatted.statusCode === 404 ||
            formatted.statusCode >= 500;
          if (!isRecoverableFailover || i === modelChain.length - 1) {
            throw candidateErr;
          }
        }
      }

      throw lastErr || new Error('Failed to analyze camera feed.');
    } catch (err) {
      const { statusCode, message } = formatAiProviderError(err);
      if (statusCode === 429) {
        // Gracefully hand off to unlimited on-device Edge AI with HTTP 200 so browsers don't log noisy 429 network errors
        res.status(200).json({
          quotaExhausted: true,
          fallbackToEdge: true,
          error: message,
        });
        return;
      }
      console.error(`[analyze-classroom error ${statusCode}]`, message);
      res.status(statusCode).json({ error: message });
    }
  });

  app.get('/api/workspace-state', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || `${uid}@users.local`;
      const profile = await getOrCreateUser(uid, email, req.user!.name ?? null);
      const data = await listUserWorkspaceData(uid);
      res.json({ profile, ...data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to load workspace state.';
      res.status(500).json({ error: msg });
    }
  });

  app.put('/api/user/preferences', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || `${uid}@users.local`;
      await getOrCreateUser(uid, email, req.user!.name ?? null);
      const body = (req.body || {}) as {
        defaultTeacherEmail?: string | null;
        linkedCourseId?: string | null;
        linkedCourseName?: string | null;
        facilityMode?: 'all' | 'bank' | 'school';
      };
      const updated = await updateUserPreferences(uid, body);
      res.json({ profile: updated });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to save preferences.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/zones', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || `${uid}@users.local`;
      await getOrCreateUser(uid, email, req.user!.name ?? null);
      const zone = req.body;
      if (!zone?.id || !zone?.classroomName) {
        res.status(400).json({ error: 'Missing zone id or classroomName.' });
        return;
      }
      const saved = await upsertMonitoredZone(uid, zone);
      res.json({ zone: saved });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to save camera zone.';
      res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/zones/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      await deleteMonitoredZone(uid, req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to delete camera zone.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/incidents', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const email = req.user!.email || `${uid}@users.local`;
      await getOrCreateUser(uid, email, req.user!.name ?? null);
      const incident = req.body;
      if (!incident?.id || !incident?.headline) {
        res.status(400).json({ error: 'Missing incident id or headline.' });
        return;
      }
      const saved = await upsertIncidentLog(uid, incident);
      res.json({ incident: saved });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to save incident log.';
      res.status(500).json({ error: msg });
    }
  });

  app.patch('/api/incidents/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const body = (req.body || {}) as {
        acknowledged?: boolean;
        teacherNotified?: boolean;
      };
      const updated = await updateIncidentStatus(uid, req.params.id, body);
      res.json({ incident: updated });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to update incident.';
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/incidents/acknowledge-all', requireAuth, async (req: AuthRequest, res) => {
    try {
      await acknowledgeAllUserIncidents(req.user!.uid);
      res.json({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to acknowledge incidents.';
      res.status(500).json({ error: msg });
    }
  });

  app.delete('/api/incidents/acknowledged', requireAuth, async (req: AuthRequest, res) => {
    try {
      await clearAcknowledgedUserIncidents(req.user!.uid);
      res.json({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to clear incidents.';
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/download-app-zip', (req, res) => {
    try {
      const rootDir = process.cwd();
      const rawOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim() : '';
      let hostedUrl = '';
      if (rawOrigin) {
        try {
          const parsedOrigin = new URL(rawOrigin);
          if (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') {
            hostedUrl = parsedOrigin.origin;
          }
        } catch {
          hostedUrl = '';
        }
      }
      if (!hostedUrl) {
        const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
          .split(',')[0]
          .trim();
        const host = String(req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`)
          .split(',')[0]
          .trim();
        hostedUrl = `${forwardedProto}://${host}`;
      }

      const entries: ZipInputEntry[] = [...buildWindowsLauncherEntries(hostedUrl)];
      const MAX_SINGLE_FILE_BYTES = 5 * 1024 * 1024;

      const walk = (absDir: string, relPrefix: string) => {
        const dirItems = fs.readdirSync(absDir, { withFileTypes: true });
        for (const item of dirItems) {
          const relPath = relPrefix ? `${relPrefix}/${item.name}` : item.name;
          if (item.isDirectory()) {
            // Prune ignored directories early for fast ZIP packaging
            if (!isSafeZipProjectPath(`${relPath}/probe.txt`)) {
              continue;
            }
            walk(path.join(absDir, item.name), relPath);
          } else if (item.isFile()) {
            if (!isSafeZipProjectPath(relPath)) continue;
            const fullPath = path.join(absDir, item.name);
            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_SINGLE_FILE_BYTES) continue;
            entries.push({
              path: relPath,
              data: new Uint8Array(fs.readFileSync(fullPath)),
            });
          }
        }
      };

      walk(rootDir, '');
      const zipBytes = buildZipArchive(entries);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="CampusGuard-Windows-App-and-Website.zip"'
      );
      res.setHeader('Content-Length', String(zipBytes.byteLength));
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(zipBytes));
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unable to build Windows & Web ZIP package.';
      res.status(500).json({ error: msg });
    }
  });

  // Guarantee /api/* routes NEVER fall through to HTML <!doctype html> SPA fallback
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Guarantee Express body-parser / middleware errors on /api/* ALWAYS return JSON, never HTML
  app.use(
    (
      err: { status?: number; statusCode?: number; type?: string; message?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.path.startsWith('/api/')) {
        const status = Number(err?.status || err?.statusCode || 500);
        const message =
          err?.type === 'entity.too.large'
            ? 'Camera frame payload exceeded size limit (HTTP 413).'
            : err?.message || 'Internal server error.';
        res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
        return;
      }
      next(err);
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CampusGuard CCTV server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
