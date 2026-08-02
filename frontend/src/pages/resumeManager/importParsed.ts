// PDF 解析结果 → 简历管理的 ResumeData 映射
// 后端 LLM 按契约返回要点数组,这里统一转 TipTap 风格的 <ul><li><p> HTML
import { blankResumeState } from "@/resume/config/initialResumeData";
import { DEFAULT_TEMPLATES } from "@/resume/config";
import { generateUUID } from "@/resume/utils/uuid";
import type { ResumeData } from "@/resume/types/resume";

export interface ParsedBasic {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  birthDate?: string;
  employementStatus?: string;
}

export interface ParsedEducation {
  school?: string;
  major?: string;
  degree?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
  description?: string[];
}

export interface ParsedExperience {
  company?: string;
  position?: string;
  date?: string;
  details?: string[];
}

export interface ParsedProject {
  name?: string;
  role?: string;
  date?: string;
  description?: string[];
}

export interface ParsedResumePayload {
  basic?: ParsedBasic;
  education?: ParsedEducation[];
  experience?: ParsedExperience[];
  projects?: ParsedProject[];
  skills?: string[];
  selfEvaluation?: string[];
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const bulletsToHtml = (items?: string[]) => {
  const cleaned = (items || []).map((s) => s.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return `<p>${escapeHtml(cleaned[0])}</p>`;
  return `<ul>${cleaned
    .map((item) => `<li><p>${escapeHtml(item)}</p></li>`)
    .join("")}</ul>`;
};

export function buildResumeFromParsed(
  parsed: ParsedResumePayload,
  fallbackTitle: string
): ResumeData {
  const skeleton = structuredClone(blankResumeState);
  const basic = parsed.basic || {};
  const now = new Date().toISOString();

  return {
    ...skeleton,
    id: generateUUID(),
    templateId: DEFAULT_TEMPLATES[0].id,
    createdAt: now,
    updatedAt: now,
    title: basic.name ? `${basic.name}的简历` : fallbackTitle,
    basic: {
      ...skeleton.basic,
      name: basic.name || "",
      title: basic.title || "",
      email: basic.email || "",
      phone: basic.phone || "",
      location: basic.location || "",
      birthDate: basic.birthDate || "",
      employementStatus: basic.employementStatus || "",
    },
    education: (parsed.education || []).map((item) => ({
      id: generateUUID(),
      school: item.school || "",
      major: item.major || "",
      degree: item.degree || "",
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      gpa: item.gpa || "",
      description: bulletsToHtml(item.description),
      visible: true,
    })),
    experience: (parsed.experience || []).map((item) => ({
      id: generateUUID(),
      company: item.company || "",
      position: item.position || "",
      date: item.date || "",
      details: bulletsToHtml(item.details),
      visible: true,
    })),
    projects: (parsed.projects || []).map((item) => ({
      id: generateUUID(),
      name: item.name || "",
      role: item.role || "",
      date: item.date || "",
      description: bulletsToHtml(item.description),
      visible: true,
    })),
    skillContent: bulletsToHtml(parsed.skills),
    selfEvaluationContent: bulletsToHtml(parsed.selfEvaluation),
  };
}
