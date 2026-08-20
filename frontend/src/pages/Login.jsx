import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Logo from "../components/Logo";
import { loadRegistrationConfig } from "../lib/registrationConfig";
import { bootstrapDesktopSession, isDesktopApp } from "../lib/desktop";

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [registrationStatus, setRegistrationStatus] = useState("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [desktopBootstrapping, setDesktopBootstrapping] = useState(isDesktopApp);
  const desktopBootstrapAttempted = useRef(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const refreshRegistrationStatus = useCallback(async () => {
    setRegistrationStatus("loading");
    try {
      const allowed = await loadRegistrationConfig();
      setRegistrationStatus(allowed ? "allowed" : "disabled");
    } catch {
      setRegistrationStatus("error");
    }
  }, []);

  useEffect(() => {
    refreshRegistrationStatus();
  }, [refreshRegistrationStatus]);

  useEffect(() => {
    if (!isDesktopApp() || desktopBootstrapAttempted.current) return;
    desktopBootstrapAttempted.current = true;
    let cancelled = false;
    void bootstrapDesktopSession()
      .then((data) => {
        if (cancelled || !data) return;
        login(data.token, data.user);
        navigate("/", { replace: true });
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setDesktopBootstrapping(false); });
    return () => { cancelled = true; };
  }, [login, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (isRegister && password.length < 6) {
      setError("密码至少 6 个字符");
      return;
    }

    setLoading(true);
    try {
      const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
      const body = isRegister ? { email, password, name } : { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "操作失败");
      }

      const data = await res.json();
      login(data.token, data.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-b from-primary/8 to-transparent rounded-full blur-[80px] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1.5 text-sm text-dim hover:text-text transition-colors mb-8 cursor-pointer"
        >
          <ArrowLeft size={16} />
          返回首页
        </button>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/10 to-transparent rounded-bl-full pointer-events-none" />
          <CardHeader className="relative">
            <div className="flex items-center gap-3 mb-1">
              <Logo className="w-10 h-10 rounded-xl drop-shadow-sm" />
              <div>
                <CardTitle>{isRegister ? "创建账号" : "欢迎回来"}</CardTitle>
                <CardDescription className="mt-1">
                  {desktopBootstrapping ? "正在打开本地工作区…" : isRegister ? "注册后开始你的面试训练" : "登录继续你的面试训练"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative">
            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegister && (
                <div className="space-y-1.5">
                  <Label>昵称</Label>
                  <Input type="text" autoComplete="name" placeholder="你的称呼（选填）" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}

              <div className="space-y-1.5">
                <Label>邮箱</Label>
                <Input type="email" autoComplete="username" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <Label>密码</Label>
                <Input type="password" autoComplete={isRegister ? "new-password" : "current-password"} placeholder={isRegister ? "至少 6 个字符" : "输入密码"} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-red/10 border border-red/20 text-red text-sm">
                  {error}
                </div>
              )}

              <Button type="submit" variant="gradient" className="w-full mt-2" disabled={loading || desktopBootstrapping}>
                {desktopBootstrapping ? "正在进入…" : loading ? "处理中..." : isRegister ? "注册" : "登录"}
              </Button>
            </form>

            {registrationStatus === "allowed" && (
              <div className="mt-6 pt-5 border-t border-border text-center">
                <span className="text-sm text-dim">
                  {isRegister ? "已有账号？" : "还没有账号？"}
                </span>
                <button
                  onClick={() => { setIsRegister(!isRegister); setError(""); }}
                  className="text-sm text-primary font-medium ml-1.5 hover:underline cursor-pointer"
                >
                  {isRegister ? "去登录" : "注册"}
                </button>
              </div>
            )}

            {registrationStatus === "loading" && (
              <div className="mt-6 pt-5 border-t border-border text-center text-sm text-dim">
                正在检查是否开放注册…
              </div>
            )}

            {registrationStatus === "error" && (
              <div className="mt-6 pt-5 border-t border-border text-center">
                <span className="text-sm text-dim">注册状态加载失败</span>
                <button
                  type="button"
                  onClick={refreshRegistrationStatus}
                  className="text-sm text-primary font-medium ml-1.5 hover:underline cursor-pointer"
                >
                  重试
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
