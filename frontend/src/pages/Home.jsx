import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, ChevronRight, Sparkles, Target, Mic, TrendingUp, BriefcaseBusiness } from "lucide-react";
import { getProfile } from "../api/interview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const MODE_CARDS = [
  {
    mode: "resume",
    icon: FileText,
    gradient: "from-amber-500/20 via-orange-500/10 to-transparent",
    iconBg: "bg-amber-500/15 text-amber-400",
    borderActive: "border-amber-500/50",
    badgeVariant: "default",
    title: "简历模拟面试",
    desc: "AI 读取你的简历，模拟真实面试官。从自我介绍到项目深挖，完整走一遍面试流程。",
    tag: "全流程模拟",
  },
  {
    mode: "topic_drill",
    icon: Target,
    gradient: "from-emerald-500/20 via-green-500/10 to-transparent",
    iconBg: "bg-emerald-500/15 text-emerald-400",
    borderActive: "border-emerald-500/50",
    badgeVariant: "success",
    title: "专项强化训练",
    desc: "选一个领域集中刷题，AI 根据你的回答动态调整难度，精准定位薄弱点。",
    tag: "针对强化",
  },
  {
    mode: "job_prep",
    icon: BriefcaseBusiness,
    gradient: "from-sky-500/20 via-cyan-500/10 to-transparent",
    iconBg: "bg-sky-500/15 text-sky-400",
    borderActive: "border-sky-500/50",
    badgeVariant: "blue",
    title: "JD 定向备面",
    desc: "贴入岗位 JD，AI 拆解岗位重点，结合简历生成高概率问题和岗位匹配复盘。",
    tag: "岗位针对",
  },
  {
    mode: "recording",
    icon: Mic,
    gradient: "from-blue-500/20 via-cyan-500/10 to-transparent",
    iconBg: "bg-blue-500/15 text-blue-400",
    borderActive: "border-blue-500/50",
    badgeVariant: "blue",
    title: "录音复盘",
    desc: "上传面试录音或粘贴文字，AI 自动转写分析，帮你复盘每一场真实面试。",
    tag: "录音分析",
  },
];

export default function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null);
  const [profile, setProfile] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    getProfile()
      .then(setProfile)
      .catch(() => null)
      .finally(() => setPageLoading(false));
  }, []);

  const handleStart = () => {
    if (!mode) return;
    const routes = {
      job_prep: "/job-prep",
      recording: "/recording",
      topic_drill: "/topic-drill",
      resume: "/resume-interview",
    };
    navigate(routes[mode] || "/");
  };

  function renderStats() {
    if (pageLoading) {
      return (
        <div className="w-full max-w-[700px] mb-10">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <Skeleton className="h-5 w-24" />
            <div className="flex gap-6">
              <Skeleton className="h-12 w-20" />
              <Skeleton className="h-12 w-20" />
              <Skeleton className="h-12 flex-1" />
            </div>
          </div>
        </div>
      );
    }
    if (!profile?.stats?.total_sessions > 0 || mode) return null;
    const s = profile.stats;
    const lastEntry = (s.score_history || []).slice(-1)[0];
    const mastery = profile.topic_mastery || {};
    const topTopics = Object.entries(mastery)
      .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
      .slice(0, 3);
    return (
      <Card className="w-full max-w-[700px] mb-10 hover:shadow-md transition-shadow">
        <CardContent className="p-5 md:p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              <span className="text-[15px] font-semibold">训练概览</span>
            </div>
            <button
              className="text-[13px] text-primary flex items-center gap-1 hover:underline cursor-pointer"
              onClick={() => navigate("/profile")}
            >
              查看画像 <ChevronRight size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-4 md:gap-6">
            <StatBox value={s.total_sessions} label="总练习" color="text-primary" />
            <StatBox value={s.avg_score || "-"} label="综合平均" color="text-green" />
            {topTopics.length > 0 && (
              <div className="flex-1 min-w-[120px]">
                <div className="text-[11px] text-dim mb-2">领域掌握</div>
                {topTopics.map(([t, d]) => (
                  <div key={t} className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs w-[70px] text-text truncate">{t}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-accent-light transition-all duration-500"
                        style={{ width: `${d.score || 0}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-dim w-7 text-right">{d.score || 0}</span>
                  </div>
                ))}
              </div>
            )}
            {lastEntry && (
              <StatBox
                value={lastEntry.avg_score}
                label="上次得分"
                color={lastEntry.avg_score >= 6 ? "text-green" : "text-orange"}
              />
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center px-4 pt-8 pb-10 md:px-6 md:pt-12">
      {/* Hero */}
      <div className="text-center mb-10 md:mb-12 relative">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[500px] h-[250px] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-4">
            <Sparkles size={14} className="animate-float" />
            AI-Powered Mock Interview
          </div>
          <h1 className="text-3xl md:text-[44px] font-display font-bold mb-3 bg-gradient-to-r from-accent-light via-accent to-orange bg-clip-text text-transparent">
            InterviewLoop
          </h1>
          <p className="text-base text-dim max-w-[500px]">
            越练越懂你的 AI 面试教练——追踪你的成长轨迹，精准命中薄弱点
          </p>
        </div>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6 mb-10 md:mb-12 w-full max-w-[1320px] stagger-children">
        {MODE_CARDS.map((card) => {
          const Icon = card.icon;
          const isActive = mode === card.mode;
          return (
            <div
              key={card.mode}
              className={cn(
                "w-full relative overflow-hidden transition-all duration-300 text-left border-2 rounded-xl group",
                "cursor-pointer",
                isActive
                  ? `border-current ${card.borderActive} bg-card shadow-lg`
                  : "border-border bg-card hover:border-primary/30 hover:shadow-lg hover:-translate-y-1"
              )}
              onClick={() => setMode(card.mode)}
            >
              <div className={cn(
                "absolute inset-0 bg-gradient-to-br pointer-events-none transition-opacity duration-500",
                card.gradient,
                isActive ? "opacity-50" : "opacity-0 group-hover:opacity-15"
              )} />
              <div className="relative px-6 py-7">
                <div className="flex items-center justify-between mb-4">
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center transition-all", card.iconBg)}>
                    <Icon size={20} />
                  </div>
                  <Badge variant={card.badgeVariant}>{card.tag}</Badge>
                </div>
                <div className="text-xl font-semibold mb-2">{card.title}</div>
                <div className="text-sm text-dim leading-relaxed">{card.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick stats */}
      {renderStats()}

      {/* Start button */}
      {mode && (
        <div className="w-full max-w-[700px] animate-fade-in-up">
          <Button
            variant="gradient"
            size="lg"
            className="w-full py-6 text-[15px] tracking-wide"
            onClick={handleStart}
          >
            {{
              resume: "开始模拟面试",
              topic_drill: "开始专项训练",
              job_prep: "开始定向备面",
              recording: "前往录音复盘",
            }[mode] || "开始"}
          </Button>
        </div>
      )}
    </div>
  );
}

function StatBox({ value, label, color }) {
  return (
    <div className="text-center min-w-[60px]">
      <div className={cn("text-2xl font-bold", color)}>{value}</div>
      <div className="text-[11px] text-dim mt-0.5">{label}</div>
    </div>
  );
}
