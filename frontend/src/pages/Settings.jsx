import { useState, useEffect } from "react";
import { Server, Sliders, Eye, EyeOff, Loader2, Check, Bot } from "lucide-react";
import { getSettings, updateSettings } from "../api/interview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

const PREDICTION_AGENTS = [
  { id: "tech_deep", label: "技术追问", description: "深挖技术细节和底层原理" },
  { id: "project_shift", label: "项目经验", description: "切换到实际项目案例" },
  { id: "pressure", label: "压力质疑", description: "质疑或挑战当前回答" },
  { id: "behavioral", label: "行为考察", description: "转向软技能和团队协作" },
  { id: "breadth", label: "横向扩展", description: "横向延伸至相关技术领域" },
];

const DIVERGENCE_OPTIONS = [
  { value: 1, label: "聚焦薄弱", description: "100% 针对存在弱点的知识域，适合考前专项突击" },
  { value: 2, label: "侧重薄弱", description: "约 70% 针对薄弱点，30% 拓展至新知识点" },
  { value: 3, label: "均衡", description: "薄弱环节巩固与全新知识盲区发掘各占 50%" },
  { value: 4, label: "侧重探索", description: "约 30% 回顾薄弱点，70% 探索全新知识层面" },
  { value: 5, label: "全面探索", description: "100% 探索未涉猎过的新知识领域，发掘潜在盲区" },
];

export default function Settings() {
  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [numQuestions, setNumQuestions] = useState(10);
  const [divergence, setDivergence] = useState(3);
  const [predictionAgents, setPredictionAgents] = useState(["tech_deep", "pressure", "project_shift"]);

  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSettings()
      .then((data) => {
        setApiBase(data.llm.api_base || "");
        setApiKey(data.llm.api_key || "");
        setModel(data.llm.model || "");
        setTemperature(data.llm.temperature ?? 0.7);
        setNumQuestions(data.training.num_questions ?? 10);
        setDivergence(data.training.divergence ?? 3);
        setPredictionAgents(data.training.prediction_agents ?? ["tech_deep", "pressure", "project_shift"]);
      })
      .catch((err) => setError("加载设置失败: " + err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateSettings({
        llm: { api_base: apiBase, api_key: apiKey, model, temperature },
        training: { num_questions: numQuestions, divergence, prediction_agents: predictionAgents },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError("保存失败: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-dim">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80";
  const inputClass = "h-12 rounded-2xl bg-card/90";

  return (
    <div className="flex-1 w-full max-w-[700px] mx-auto px-4 py-6 md:px-7 md:py-8">
      <div className="mb-8">
        <div className="text-2xl md:text-[28px] font-display font-bold">设置</div>
        <div className="text-sm text-dim mt-1">配置 LLM 服务和训练参数</div>
      </div>

      <div className="space-y-5">
        {/* LLM Provider */}
        <Card className="overflow-hidden border-border/80 bg-card/76">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Server size={16} className="text-primary" />
              <span className="text-base font-semibold">LLM 服务配置</span>
            </div>
            <div className="text-[13px] text-dim mb-6">更改后立即生效，无需重启后端</div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className={labelClass}>API Base URL</Label>
                <Input
                  className={inputClass}
                  placeholder="例：https://api.openai.com/v1"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>Model</Label>
                <Input
                  className={inputClass}
                  placeholder="例：gpt-4o"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 mt-4">
              <div className="space-y-2">
                <Label className={labelClass}>API Key</Label>
                <div className="relative">
                  <Input
                    className={cn(inputClass, "pr-11")}
                    type={showKey ? "text" : "password"}
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text transition-colors"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className={labelClass}>Temperature</Label>
                <Input
                  className={inputClass}
                  type="number"
                  step={0.1}
                  min={0}
                  max={2}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Training Params */}
        <Card className="overflow-hidden border-border/80 bg-card/76">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Sliders size={16} className="text-primary" />
              <span className="text-base font-semibold">训练参数</span>
            </div>
            <div className="text-[13px] text-dim mb-6">每次开始专项训练时的默认设置</div>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label className={labelClass}>每轮题目数</Label>
                <Input
                  className={cn(inputClass, "max-w-[140px]")}
                  type="number"
                  min={5}
                  max={20}
                  value={numQuestions}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (v >= 5 && v <= 20) setNumQuestions(v);
                    else if (e.target.value === "") setNumQuestions(5);
                  }}
                />
                <div className="text-[12px] text-dim/60">范围 5 – 20，默认 10</div>
              </div>

              <div className="space-y-2.5">
                <Label className={labelClass}>题目发散度</Label>
                <div className="flex flex-wrap gap-2">
                  {DIVERGENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDivergence(opt.value)}
                      className={cn(
                        "px-4 py-2 rounded-xl border text-sm transition-all",
                        divergence === opt.value
                          ? "bg-primary/12 text-primary border-primary/50 font-medium"
                          : "border-border bg-card/80 text-dim hover:text-text hover:bg-hover"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="text-[12px] text-dim/70 mt-1 min-h-[18px]">
                  {DIVERGENCE_OPTIONS.find((o) => o.value === divergence)?.description}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        {/* Copilot Prediction Agents */}
        <Card className="overflow-hidden border-border/80 bg-card/76">
          <CardContent className="p-5 md:p-7">
            <div className="flex items-center gap-2 mb-1">
              <Bot size={16} className="text-primary" />
              <span className="text-base font-semibold">面试 Copilot</span>
            </div>
            <div className="text-[13px] text-dim mb-6">
              选择面试时启用的预测 Agent，最多同时开启 4 个
            </div>

            <div className="space-y-2.5">
              <Label className={labelClass}>预测 Agent</Label>
              <div className="flex flex-col gap-2">
                {PREDICTION_AGENTS.map((agent) => {
                  const enabled = predictionAgents.includes(agent.id);
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => {
                        if (enabled) {
                          if (predictionAgents.length > 1)
                            setPredictionAgents(predictionAgents.filter((a) => a !== agent.id));
                        } else {
                          if (predictionAgents.length < 4)
                            setPredictionAgents([...predictionAgents, agent.id]);
                        }
                      }}
                      className={cn(
                        "flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all text-left",
                        enabled
                          ? "bg-primary/12 text-primary border-primary/50"
                          : "border-border bg-card/80 text-dim hover:text-text hover:bg-hover"
                      )}
                    >
                      <div>
                        <span className="font-medium">{agent.label}</span>
                        <span className={cn("ml-2 text-[12px]", enabled ? "text-primary/70" : "text-dim/60")}>
                          {agent.description}
                        </span>
                      </div>
                      {enabled && <Check size={14} />}
                    </button>
                  );
                })}
              </div>
              <div className="text-[12px] text-dim/60 mt-1">
                已选 {predictionAgents.length} 个，最多 4 个
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Save */}
      <div className="flex items-center justify-end gap-3 mt-6">
        {error && <span className="text-sm text-red">{error}</span>}
        <Button variant="gradient" className="px-8" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
          {saving ? "保存中..." : saved ? "已保存" : "保存"}
        </Button>
      </div>
    </div>
  );
}
