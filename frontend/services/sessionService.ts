import { resolveBackendUrl } from './openaiService';
import type { SessionEngagementAnalysis } from '../types';

export type SessionVideoRole = 'presenter' | 'audience';

interface UploadResponse {
  status: string;
  analysisQueued: boolean;
}

interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export const uploadSessionVideo = async (
  sessionId: string,
  role: SessionVideoRole,
  videoBlob: Blob,
  startMs: number,
  durationMs: number
): Promise<UploadResponse> => {
  const formData = new FormData();
  const filename = `${role}-${Date.now()}.webm`;

  formData.append('video', videoBlob, filename);
  formData.append('role', role);
  formData.append('start_ms', String(startMs));
  formData.append('duration_ms', String(durationMs));

  const response = await fetch(resolveBackendUrl(`/sessions/${sessionId}/videos`), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Video upload failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as UploadResponse;
};

export const fetchSessionAnalysis = async (
  sessionId: string
): Promise<SessionEngagementAnalysis> => {
  const response = await fetch(resolveBackendUrl(`/sessions/${sessionId}/analysis`));

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Analysis fetch failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as SessionEngagementAnalysis;
};

export const pollSessionAnalysis = async (
  sessionId: string,
  { intervalMs = 4000, timeoutMs = 180000 }: PollOptions = {}
): Promise<SessionEngagementAnalysis> => {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fetchSessionAnalysis(sessionId);
    } catch (error) {
      const elapsed = Date.now() - start;
      if (elapsed >= timeoutMs) {
        throw new Error(
          error instanceof Error
            ? error.message
            : 'Timed out waiting for engagement analysis.'
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};
