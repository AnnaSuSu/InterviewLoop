import { authFetch, type ApiResponse } from "./client";

const API_BASE = "/api/data";

// 管理员下载整站全量备份归档
export async function exportData(): Promise<{ filename: string; size: number }> {
  const res = await authFetch(`${API_BASE}/export`);
  if (!res.ok) throw new Error(await res.text());

  const blob = await res.blob();
  let filename = "techspar-backup.tar.gz";
  const disposition = res.headers.get("content-disposition");
  if (disposition) {
    const m = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
    if (m) filename = decodeURIComponent(m[1]);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return { filename, size: blob.size };
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
