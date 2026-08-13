import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Menu, X, Sparkles, ChevronRight, ChevronDown } from "lucide-react";
import { getTopicIcon } from "../utils/topicIcons";
import {
  getTopics, getCoreKnowledge, updateCoreKnowledge, createCoreKnowledge,
  deleteCoreKnowledge, getHighFreq, updateHighFreq, deleteTopic, generateKnowledge,
} from "../api/interview";
import AddTopicDialog from "../components/AddTopicDialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

interface TopicInfo {
  name?: string;
  icon?: string;
}

type Topics = Record<string, TopicInfo>;

interface CoreFile {
  filename: string;
  content: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Knowledge() {
  const [topics, setTopics] = useState<Topics>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"core" | "high_freq">("core");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [coreFiles, setCoreFiles] = useState<CoreFile[]>([]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<Record<string, string>>({});
  const [coreSaving, setCoreSaving] = useState<string | null>(null);
  const [coreEditing, setCoreEditing] = useState<string | null>(null);

  const [highFreq, setHighFreq] = useState("");
  const [highFreqDraft, setHighFreqDraft] = useState("");
  const [hfSaving, setHfSaving] = useState(false);
  const [hfEditing, setHfEditing] = useState(false);

  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [showAddTopic, setShowAddTopic] = useState(false);

  const refreshTopics = useCallback(async () => {
    const t = (await getTopics()) as unknown as Topics;
    setTopics(t);
    return t;
  }, []);

  useEffect(() => {
    let active = true;
    getTopics()
      .then((data) => {
        if (!active) return;
        const nextTopics = data as unknown as Topics;
        setTopics(nextTopics);
        const keys = Object.keys(nextTopics);
        setSelected((current) => current && nextTopics[current] ? current : (keys[0] ?? null));
      })
      .catch(() => {
        if (active) setTopics({});
      });
    return () => { active = false; };
  }, []);

  const loadCore = useCallback(async (topic: string) => {
    try {
      const files = (await getCoreKnowledge(topic)) as unknown as CoreFile[];
      setCoreFiles(files);
      setExpandedFile(files[0]?.filename ?? null);
      setCoreEditing(null);
      setEditContent(Object.fromEntries(files.map((file) => [file.filename, file.content])));
    } catch { setCoreFiles([]); }
  }, []);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    Promise.all([getCoreKnowledge(selected), getHighFreq(selected)])
      .then(([filesData, highFreqData]) => {
        if (!active) return;
        const files = filesData as unknown as CoreFile[];
        const highFreqContent = (highFreqData as unknown as { content?: string | null }).content || "";
        setCoreFiles(files);
        setExpandedFile(files[0]?.filename ?? null);
        setCoreEditing(null);
        setEditContent(Object.fromEntries(files.map((file) => [file.filename, file.content])));
        setHighFreq(highFreqContent);
        setHighFreqDraft(highFreqContent);
        setHfEditing(false);
      })
      .catch(() => {
        if (!active) return;
        setCoreFiles([]);
        setHighFreq("");
        setHighFreqDraft("");
        setHfEditing(false);
      });
    return () => { active = false; };
  }, [selected]);

  const handleSaveCore = async (filename: string) => {
    if (!selected) return;
    setCoreSaving(filename);
    try {
      await updateCoreKnowledge(selected, filename, editContent[filename] || "");
      setCoreFiles((prev) => prev.map((f) => f.filename === filename ? { ...f, content: editContent[filename] } : f));
      setCoreEditing(null);
    } catch (e) { alert("保存失败: " + errorMessage(e)); }
    setTimeout(() => setCoreSaving(null), 1500);
  };

  const handleSaveHighFreq = async () => {
    if (!selected) return;
    setHfSaving(true);
    try {
      await updateHighFreq(selected, highFreqDraft);
      setHighFreq(highFreqDraft);
      setHfEditing(false);
    } catch (e) { alert("保存失败: " + errorMessage(e)); }
    setTimeout(() => setHfSaving(false), 1500);
  };

  const handleCreateFile = async () => {
    if (!selected) return;
    const name = newFileName.trim();
    if (!name) return;
    const fname = name.endsWith(".md") ? name : name + ".md";
    try {
      await createCoreKnowledge(selected, fname, "");
      setNewFileName("");
      setShowNewFile(false);
      loadCore(selected);
    } catch (e) { alert("创建失败: " + errorMessage(e)); }
  };

  const handleDeleteFile = async (filename: string) => {
    if (!selected) return;
    if (!confirm(`确定删除「${filename}」？此操作不可撤销。`)) return;
    try {
      await deleteCoreKnowledge(selected, filename);
      setCoreFiles((prev) => prev.filter((f) => f.filename !== filename));
      if (expandedFile === filename) setExpandedFile(null);
    } catch (e) { alert("删除失败: " + errorMessage(e)); }
  };

  const handleGenerate = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      await generateKnowledge(selected);
      await loadCore(selected);
      setExpandedFile("README.md");
    } catch (e) { alert("生成失败: " + errorMessage(e)); }
    setGenerating(false);
  };

  const coreIsEmpty = coreFiles.length === 0 ||
    (coreFiles.length === 1 && coreFiles[0].filename === "README.md" && (coreFiles[0].content?.length || 0) <= 20);

  const handleTopicCreated = async (key: string) => {
    await refreshTopics();
    setSelected(key);
  };

  const handleDeleteTopic = async (key: string) => {
    if (!confirm(`确定删除「${topics[key]?.name || key}」？`)) return;
    try {
      await deleteTopic(key);
      const t = await refreshTopics();
      const keys = Object.keys(t);
      if (selected === key) setSelected(keys.length > 0 ? keys[0] : null);
    } catch (e) { alert("删除失败: " + errorMessage(e)); }
  };

  const topicKeys = Object.keys(topics);

  return (
    <div className="flex flex-1 overflow-hidden h-full">
      <Button
        variant="gradient"
        size="icon"
        className="fixed bottom-4 right-4 z-40 md:hidden rounded-full w-12 h-12"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </Button>

      <div className={cn(
        "fixed inset-y-0 left-0 z-30 w-[200px] border-r border-border bg-bg p-4 flex flex-col transition-transform duration-200 md:static md:translate-x-0 md:shrink-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex justify-between items-center mb-3 px-2">
          <div className="text-[13px] font-semibold text-dim">专项领域</div>
          <Button variant="ghost" size="icon" className="w-6 h-6 text-base" title="新增领域" onClick={() => setShowAddTopic(true)}>+</Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {topicKeys.map((key) => (
            <div key={key} className="relative mb-0.5 group">
              <button
                className={cn(
                  "w-full px-3 py-2.5 rounded-lg text-sm text-left flex items-center gap-2 transition-all cursor-pointer",
                  selected === key ? "bg-hover text-text" : "text-dim hover:bg-hover"
                )}
                onClick={() => { setSelected(key); setSidebarOpen(false); }}
              >
                <span className="text-dim">{getTopicIcon(topics[key]?.icon, 16)}</span>
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{topics[key]?.name || key}</span>
              </button>
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-dim text-sm px-1.5 py-1 rounded opacity-0 group-hover:opacity-100 hover:text-red hover:bg-red/10 transition-all cursor-pointer"
                title="删除领域"
                onClick={() => handleDeleteTopic(key)}
              ><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <AddTopicDialog
        open={showAddTopic}
        onClose={() => setShowAddTopic(false)}
        onCreated={handleTopicCreated}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex border-b border-border px-4 md:px-6 bg-card">
          {(["core", "high_freq"] as const).map((t) => (
            <button
              key={t}
              className={cn(
                "px-4 py-3 md:px-5 text-sm border-b-2 transition-all cursor-pointer",
                tab === t ? "text-text border-b-primary font-medium" : "text-dim border-b-transparent hover:text-text"
              )}
              onClick={() => setTab(t)}
            >
              {t === "core" ? "核心知识库" : "高频题库"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {!selected ? (
            <div className="text-center py-15 text-dim text-sm">选择一个领域</div>
          ) : tab === "core" ? (
            <div>
              <div className="text-[13px] text-dim mb-3">
                AI 出题和评分的参考依据，编辑后影响该领域的题目质量。支持 Markdown 格式。
              </div>
              <div className="flex gap-2 mb-4">
                {showNewFile ? (
                  <div className="flex gap-2 flex-1">
                    <Input className="flex-1" placeholder="文件名 (例: 装饰器.md)" value={newFileName} onChange={(e) => setNewFileName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateFile()} />
                    <Button variant="gradient" size="sm" onClick={handleCreateFile}>创建</Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowNewFile(false); setNewFileName(""); }}>取消</Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setShowNewFile(true)}>+ 新增文件</Button>
                    {coreIsEmpty && (
                      <Button variant="outline" size="sm" className="border-primary/40 text-primary" onClick={handleGenerate} disabled={generating}>
                        {generating ? "正在生成..." : <><Sparkles size={14} /> AI 生成基础内容</>}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {coreFiles.length === 0 ? (
                <div className="text-center py-15 text-dim text-sm">该领域暂无知识文件</div>
              ) : (
                <div className="flex flex-col gap-3 stagger-children">
                  {coreFiles.map((f) => (
                    <Card key={f.filename} className="overflow-hidden">
                      <div
                        className="flex justify-between items-center px-4 py-3 cursor-pointer text-sm font-medium hover:bg-hover/50 transition-colors"
                        onClick={() => { setExpandedFile(expandedFile === f.filename ? null : f.filename); setCoreEditing(null); }}
                      >
                        <span>{f.filename}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-dim flex items-center gap-1">{expandedFile === f.filename ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {(f.content?.length || 0)} 字</span>
                          <button
                            className="text-dim cursor-pointer p-1 rounded opacity-50 hover:text-red hover:opacity-100 transition-all"
                            title="删除文件"
                            onClick={(e) => { e.stopPropagation(); handleDeleteFile(f.filename); }}
                          ><X size={14} /></button>
                        </div>
                      </div>
                      {expandedFile === f.filename && (
                        <div className="border-t border-border p-4 animate-fade-in">
                          {coreEditing === f.filename ? (
                            <>
                              <textarea
                                className="w-full min-h-[300px] p-3 rounded-lg border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:border-primary"
                                value={editContent[f.filename] ?? f.content}
                                onChange={(e) => setEditContent((prev) => ({ ...prev, [f.filename]: e.target.value }))}
                                autoFocus
                              />
                              <div className="flex gap-2 mt-3 justify-end">
                                <Button variant="outline" size="sm" onClick={() => { setEditContent((prev) => ({ ...prev, [f.filename]: f.content })); setCoreEditing(null); }}>取消</Button>
                                <Button variant="gradient" size="sm" onClick={() => handleSaveCore(f.filename)}>保存</Button>
                              </div>
                            </>
                          ) : (
                            <>
                              {(editContent[f.filename] ?? f.content)?.trim() ? (
                                <div className="md-content text-sm leading-6 text-text">
                                  <ReactMarkdown>{editContent[f.filename] ?? f.content}</ReactMarkdown>
                                </div>
                              ) : (
                                <div className="text-dim text-sm py-6 text-center">空文件，点「编辑」添加内容</div>
                              )}
                              <div className="flex gap-2 mt-3 justify-end items-center">
                                {coreSaving === f.filename && <span className="text-xs text-green mr-1">已保存</span>}
                                <Button variant="outline" size="sm" onClick={() => setCoreEditing(f.filename)}>编辑</Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="text-[13px] text-dim mb-3">
                标记的高频面试考点，出题时会优先覆盖。建议一行一题，或一个「##」标题一题，方便出题精准覆盖。
              </div>
              {hfEditing ? (
                <>
                  <textarea
                    className="w-full min-h-[500px] p-3 rounded-xl border border-border bg-bg text-text text-[13px] font-mono leading-relaxed resize-y focus:outline-none focus:border-primary"
                    value={highFreqDraft}
                    onChange={(e) => setHighFreqDraft(e.target.value)}
                    placeholder={"# 高频题\n\n## 1. xxx原理是什么？为什么这样设计？\n\n## 2. 实际项目中遇到xxx问题怎么解决？"}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3 justify-end">
                    {hfSaving && <span className="text-xs text-green self-center mr-3">已保存</span>}
                    {highFreqDraft !== highFreq && (
                      <Button variant="outline" size="sm" onClick={() => setHighFreqDraft(highFreq)}>撤销修改</Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => { setHighFreqDraft(highFreq); setHfEditing(false); }}>取消</Button>
                    <Button variant="gradient" size="sm" onClick={handleSaveHighFreq} disabled={highFreqDraft === highFreq}>保存</Button>
                  </div>
                </>
              ) : (
                <>
                  {highFreq.trim() ? (
                    <div className="md-content text-sm leading-6 text-text rounded-xl border border-border bg-bg p-4">
                      <ReactMarkdown>{highFreq}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-dim text-sm py-10 text-center rounded-xl border border-border bg-bg">暂无高频题，点「编辑」添加</div>
                  )}
                  <div className="flex gap-2 mt-3 justify-end items-center">
                    {hfSaving && <span className="text-xs text-green mr-1">已保存</span>}
                    <Button variant="outline" size="sm" onClick={() => setHfEditing(true)}>编辑</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
