import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import {
  getSettings,
  updateSettings,
  testLLMConnection,
  testEmbeddingConnection,
} from "../api/interview";
import { Loader2, Server, Boxes, ArrowRight, ArrowLeft, Eye, EyeOff, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Logo from "../components/Logo";

// 首登引导：每个用户都得带自己的 key,这里两步把 LLM + Embedding 配齐。
// 其余可选服务(语音/搜索/录音上传)留到设置页按需填。
export default function Onboarding() {
  const { setNeedsOnboarding, logout } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showEmbKey, setShowEmbKey] = useState(false);

  const [apiBase, setApiBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [embApiBase, setEmbApiBase] = useState("");
  const [embApiKey, setEmbApiKey] = useState("");
  const [embApiModel, setEmbApiModel] = useState("");

  // 保留 training/services/system,保存时不被覆盖
  const [base, setBase] = useState(null);

  useEffect(() => {
    getSettings()
      .then((data) => {
        setApiBase(data.llm?.api_base || "");
        setApiKey(data.llm?.api_key || "");
        setModel(data.llm?.model || "");
        const emb = data.embedding || {};
        setEmbApiBase(emb.api_base || "");
        setEmbApiKey(emb.api_key || "");
        setEmbApiModel(emb.api_model || "");
        setBase(data);
      })
      .catch((e) => setError("加载失败：" + e.message))
      .finally(() => setLoading(false));
  }, []);

  const llmReady = apiKey.trim() && model.trim();
  const embReady = embApiKey.trim() && embApiModel.trim();

  // 进入下一步前先实测 LLM；连不通就拦住，不让继续。
  async function handleNext() {
    setTesting(true);
    setError("");
    try {
      const r = await testLLMConnection({
        api_base: apiBase.trim(),
        api_key: apiKey.trim(),
        model: model.trim(),
      });
      if (!r.ok) {
        setError("LLM 连接失败：" + r.error);
        return;
      }
      setStep(2);
    } catch (e) {
      setError("LLM 连接测试失败：" + e.message);
    } finally {
      setTesting(false);
    }
  }

  async function handleFinish() {
    setSaving(true);
    setError("");
    try {
      const r = await testEmbeddingConnection({
        backend: "api",
        api_base: embApiBase.trim(),
        api_key: embApiKey.trim(),
        api_model: embApiModel.trim(),
      });
      if (!r.ok) {
        setError("Embedding 连接失败：" + r.error);
        setSaving(false);
        return;
      }
      await updateSettings({
        llm: {
          api_base: apiBase.trim(),
          api_key: apiKey.trim(),
          model: model.trim(),
          temperature: base?.llm?.temperature ?? 0.7,
        },
        embedding: {
          backend: "api",
          api_base: embApiBase.trim(),
          api_key: embApiKey.trim(),
          api_model: embApiModel.trim(),
          local_model: "",
          local_path: "",
        },
        services: base?.services || {},
        system: base?.system || { allow_registration: false },
        training: base?.training || { num_questions: 10, divergence: 3 },
      });
      setNeedsOnboarding(false);
      navigate("/profile", { replace: true });
    } catch (e) {
      setError("保存失败：" + e.message);
      setSaving(false);
    }
  }

  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/80";
  const inputClass = "h-12 rounded-2xl bg-card/90";

  const steps = [
    { n: 1, label: "LLM", icon: Server },
    { n: 2, label: "Embedding", icon: Boxes },
  ];

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 py-10 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-b from-primary/8 to-transparent rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-lg relative z-10">
        <div className="flex items-center gap-3 mb-6">
          <Logo className="w-10 h-10 rounded-xl drop-shadow-sm" />
          <div>
            <div className="text-lg font-display font-bold">先配置你的模型服务</div>
            <div className="text-[13px] text-dim mt-0.5">
              每个账号用自己的 key,不共享。两步配齐 LLM 和 Embedding 即可开始。
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const active = step === s.n;
            const done = step > s.n;
            return (
              <div key={s.n} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors",
                    active ? "bg-primary/12 text-primary font-medium" : done ? "text-primary/70" : "text-dim"
                  )}
                >
                  <Icon size={14} />
                  {s.label}
                </div>
                {i < steps.length - 1 && <div className="h-px w-6 bg-border" />}
              </div>
            );
          })}
        </div>

        <Card className="relative overflow-hidden">
          <CardContent className="p-6 md:p-7">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-dim">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : step === 1 ? (
              <div className="space-y-4">
                <div className="text-[13px] text-dim">
                  填你自己的 LLM(OpenAI 兼容接口)。没有的话,ModelScope 的 <span className="text-text">ZhipuAI/GLM-5</span> 有免费额度可先跑通。
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Base URL</Label>
                  <Input className={inputClass} autoComplete="off" placeholder="例：https://api-inference.modelscope.cn/v1" value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>Model</Label>
                  <Input className={inputClass} autoComplete="off" placeholder="例：ZhipuAI/GLM-5" value={model} onChange={(e) => setModel(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Key</Label>
                  <div className="relative">
                    <Input
                      className={cn(inputClass, "pr-11")}
                      type={showKey ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text" onClick={() => setShowKey((v) => !v)}>
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-[13px] text-dim">
                  Embedding 用于知识库 / 个人资料库 / 记忆向量化；简历会直接读取全文。免费示例:SiliconFlow 的 <span className="text-text">BAAI/bge-large-zh-v1.5</span>。可与 LLM 用不同服务商。
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Base URL</Label>
                  <Input className={inputClass} autoComplete="off" placeholder="例：https://api.siliconflow.cn/v1（OpenAI 官方可留空）" value={embApiBase} onChange={(e) => setEmbApiBase(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>Embedding Model</Label>
                  <Input className={inputClass} autoComplete="off" placeholder="例：BAAI/bge-large-zh-v1.5" value={embApiModel} onChange={(e) => setEmbApiModel(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label className={labelClass}>API Key</Label>
                  <div className="relative">
                    <Input
                      className={cn(inputClass, "pr-11")}
                      type={showEmbKey ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="sk-..."
                      value={embApiKey}
                      onChange={(e) => setEmbApiKey(e.target.value)}
                    />
                    <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-text" onClick={() => setShowEmbKey((v) => !v)}>
                      {showEmbKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 px-3 py-2 rounded-lg bg-red/10 border border-red/20 text-red text-sm">{error}</div>
            )}

            {!loading && (
              <div className="mt-6 flex items-center justify-between gap-3">
                {step === 1 ? (
                  <button onClick={logout} className="flex items-center gap-1.5 text-[13px] text-dim hover:text-text cursor-pointer">
                    <LogOut size={14} /> 退出登录
                  </button>
                ) : (
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft size={15} className="mr-1.5" /> 上一步
                  </Button>
                )}

                {step === 1 ? (
                  <Button variant="gradient" disabled={!llmReady || testing} onClick={handleNext}>
                    {testing && <Loader2 size={15} className="mr-1.5 animate-spin" />}
                    {testing ? "测试连接中..." : "下一步"}
                    {!testing && <ArrowRight size={15} className="ml-1.5" />}
                  </Button>
                ) : (
                  <Button variant="gradient" disabled={!embReady || saving} onClick={handleFinish}>
                    {saving && <Loader2 size={15} className="mr-1.5 animate-spin" />}
                    {saving ? "测试并保存中..." : "完成,开始使用"}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-[12px] text-dim/70 mt-4">
          语音输入、联网搜索、录音复盘等可选功能的 key 可稍后在「设置 → 可选服务」里补。
        </div>
      </div>
    </div>
  );
}
