import { useState } from "react";
import { ICON_OPTIONS } from "../utils/topicIcons";
import { createTopic } from "../api/interview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

interface AddTopicDialogProps {
  open: boolean;
  onClose: () => void;
  /** 创建成功后以新领域 key 回调,随后弹窗自动关闭 */
  onCreated: (key: string) => void | Promise<void>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function AddTopicDialog({ open, onClose, onCreated }: AddTopicDialogProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("FileText");
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleClose = () => {
    setName("");
    setIcon("FileText");
    onClose();
  };

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const result = (await createTopic(trimmed, icon)) as unknown as { key: string };
      await onCreated(result.key);
      handleClose();
    } catch (error) {
      alert("添加失败: " + errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={handleClose}>
      <Card className="w-[380px] max-w-[90vw] animate-bounce-in" onClick={(e) => e.stopPropagation()}>
        <CardContent className="p-6 md:p-8">
          <div className="text-lg font-semibold mb-5">新增训练领域</div>
          <div className="mb-3.5 space-y-1.5">
            <Label>名称</Label>
            <Input
              placeholder="Docker 容器化"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              autoFocus
            />
          </div>
          <div className="mb-3.5 space-y-1.5">
            <Label>图标</Label>
            <div className="grid grid-cols-8 gap-1.5">
              {ICON_OPTIONS.map(({ name: iconName, Icon }) => (
                <button
                  key={iconName}
                  type="button"
                  className={cn(
                    "w-9 h-9 rounded-lg flex items-center justify-center transition-all cursor-pointer border",
                    icon === iconName ? "bg-primary/20 text-primary border-primary" : "bg-hover text-dim border-transparent hover:text-text"
                  )}
                  onClick={() => setIcon(iconName)}
                  title={iconName}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
          <p className="text-[12px] leading-5 text-dim">
            创建后先补充核心知识（手写或让 AI 生成基础内容），出题会更贴合你的方向。
          </p>
          <div className="flex gap-2.5 justify-end mt-6">
            <Button variant="outline" onClick={handleClose}>取消</Button>
            <Button variant="gradient" onClick={handleAdd} disabled={!name.trim() || creating}>
              {creating ? "创建中..." : "添加"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
