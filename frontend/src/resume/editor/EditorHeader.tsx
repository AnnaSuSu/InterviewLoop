import { useEffect } from "react";
import { useTranslations } from "@/resume/i18n/compat/client";
import { Edit2, Undo2, Redo2 } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "@/resume/lib/navigation";
import { Input } from "@/resume/ui/input";
import PdfExport from "../shared/PdfExport";
import { useResumeStore } from "@/resume/store/useResumeStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/resume/ui/tooltip";
import { Button } from "@/resume/ui/button";

interface EditorHeaderProps {
  isMobile?: boolean;
}

export function EditorHeader({ isMobile }: EditorHeaderProps) {
  const { activeResume, updateResumeTitle, undo, redo, canUndo, canRedo } =
    useResumeStore();
  const router = useRouter();
  const t = useTranslations();
  const undoLabel = t("richEditor.undo");
  const redoLabel = t("richEditor.redo");

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      return (
        target.isContentEditable ||
        target.closest("[contenteditable='true']") ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      if (!isModifierPressed || isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  return (
    <motion.header
      className={`h-16 border-b sticky top-0 z-10 bg-background`}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
    >
      <div className="flex items-center justify-between px-6 h-full pr-2">
        <div className="flex items-center space-x-4 scrollbar-hide">
          <motion.div
            className="flex items-center space-x-2 shrink-0 cursor-pointer"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              router.push("/resume-manager");
            }}
          >
            <span className="text-lg font-semibold">简历管理</span>
          </motion.div>

          <span className="text-muted-foreground/30 hidden md:inline-block font-light">
            /
          </span>

          <div className="relative hidden md:flex items-center group">
            <Input
              key={activeResume?.id || "resume-title"}
              defaultValue={activeResume?.title || ""}
              onBlur={(e) => {
                updateResumeTitle(e.target.value || "未命名简历");
              }}
              className="w-56 text-sm h-8 bg-muted/30 border-transparent hover:bg-muted/60 focus:bg-background transition-colors px-2.5 py-1 pr-8 shadow-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-border rounded-md font-medium text-foreground/90 hover:text-foreground"
              placeholder="简历名称"
            />
            <Edit2 className="w-3.5 h-3.5 absolute right-2.5 text-muted-foreground/40 pointer-events-none transition-colors group-hover:text-muted-foreground/80" />
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="hidden md:flex items-center gap-1">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={undo}
                    disabled={!canUndo()}
                    aria-label={undoLabel}
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{undoLabel}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={redo}
                    disabled={!canRedo()}
                    aria-label={redoLabel}
                  >
                    <Redo2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{redoLabel}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="md:flex items-center ">
            <PdfExport />
          </div>
        </div>
      </div>
    </motion.header>
  );
}
