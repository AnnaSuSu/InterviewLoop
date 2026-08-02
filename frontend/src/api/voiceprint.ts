import { API_BASE, authFetch, type ApiResponse } from "./client";

export async function getVoiceprintStatus(): Promise<
  ApiResponse<"/api/voiceprint/status", "get">
> {
  const res = await authFetch(`${API_BASE}/voiceprint/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface VoiceprintCredentials {
  secret_id: string;
  secret_key: string;
  app_id?: string;
}

export async function putVoiceprintCredentials({
  secret_id,
  secret_key,
  app_id = "",
}: VoiceprintCredentials): Promise<
  ApiResponse<"/api/voiceprint/credentials", "put">
> {
  const res = await authFetch(`${API_BASE}/voiceprint/credentials`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_id, secret_key, app_id }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function enrollVoiceprint(
  wavBlob: Blob
): Promise<ApiResponse<"/api/voiceprint/enroll", "post">> {
  const form = new FormData();
  form.append("file", wavBlob, "voiceprint.wav");
  const res = await authFetch(`${API_BASE}/voiceprint/enroll`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteVoiceprintEnrollment(): Promise<
  ApiResponse<"/api/voiceprint/enroll", "delete">
> {
  const res = await authFetch(`${API_BASE}/voiceprint/enroll`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
