import { authFetch, type ApiResponse } from "./client";

const API_BASE = "/api/data";

async function downloadExport(url: string, fallbackName: string): Promise<{ filename: string; size: number }> {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(await res.text());

  const blob = await res.blob();
  let filename = fallbackName;
  const disposition = res.headers.get("content-disposition");
  if (disposition) {
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
    if (m) filename = decodeURIComponent(m[1]);
  }

  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(downloadUrl);

  return { filename, size: blob.size };
}

// Every account can download its own portable backup. Secrets are opt-in.
export async function exportPersonalData(
  includeSensitive = false,
): Promise<{ filename: string; size: number }> {
  const query = includeSensitive ? "?include_sensitive=true" : "";
  return downloadExport(
    `${API_BASE}/export/personal${query}`,
    "techspar-personal-backup.tar.gz",
  );
}

// Administrators can additionally download a full-system backup.
export async function exportSystemData(): Promise<{ filename: string; size: number }> {
  return downloadExport(`${API_BASE}/export`, "techspar-system-backup.tar.gz");
}

interface ImportDataOptions {
  dbStrategy?: "skip" | "overwrite";
  overwriteFiles?: boolean;
}

// 上传单账户归档并合并到当前用户
export async function importData(
  file: File,
  { dbStrategy = "skip", overwriteFiles = false }: ImportDataOptions = {}
): Promise<ApiResponse<"/api/data/import", "post">> {
  const form = new FormData();
  form.append("file", file);
  form.append("db_strategy", dbStrategy);
  form.append("overwrite_files", overwriteFiles ? "true" : "false");

  const res = await authFetch(`${API_BASE}/import`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
