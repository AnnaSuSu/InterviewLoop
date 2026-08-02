import { useEffect, useRef, useState } from "react";
import { Layout, PanelsLeftBottom } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslations } from "@/resume/i18n/compat/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/resume/ui/sheet-no-overlay";
import { cn } from "@/resume/lib/utils";
import { DEFAULT_TEMPLATES } from "@/resume/config";
import { useResumeStore } from "@/resume/store/useResumeStore";
import { ScrollArea } from "@/resume/ui/scroll-area";
import type { ResumeData } from "@/resume/types/resume";
import ResumeTemplateComponent from "@/resume/templates";

type TemplateItem = (typeof DEFAULT_TEMPLATES)[number];

// A4 宽度按 96dpi 折算的像素值,与预览容器一致
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

// 用当前简历数据实时缩放渲染模板缩略图,替代上游的静态 PNG 快照
const TemplateThumbnail = ({
  template,
  data,
}: {
  template: TemplateItem;
  data: ResumeData;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / A4_WIDTH_PX);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-white">
      {scale > 0 && (
        <div
          className="pointer-events-none origin-top-left"
          style={{
            width: A4_WIDTH_PX,
            minHeight: A4_HEIGHT_PX,
            transform: `scale(${scale})`,
            padding: `${data.globalSettings?.pagePadding ?? 32}px`,
          }}
        >
          <ResumeTemplateComponent
            data={{ ...data, templateId: template.id }}
            template={template}
          />
        </div>
      )}
    </div>
  );
};

interface TemplatePreviewProps {
  template: TemplateItem;
  isActive: boolean;
  data: ResumeData;
  onSelect: (templateId: string) => void;
}

const TemplatePreview = ({
  template,
  isActive,
  data,
  onSelect,
}: TemplatePreviewProps) => {
  return (
    <button
      onClick={() => onSelect(template.id)}
      className={cn(
        "relative group rounded-lg overflow-hidden border-2 transition-all duration-200 hover:scale-[1.02] text-left",
        isActive
          ? "border-primary dark:border-primary shadow-lg dark:shadow-primary/30"
          : "border-gray-100 hover:border-gray-200 dark:border-neutral-800 dark:hover:border-neutral-700"
      )}
    >
      <div className="relative aspect-[210/297] w-full overflow-hidden bg-gray-50 dark:bg-gray-900">
        <TemplateThumbnail template={template} data={data} />
      </div>
      <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
        <span className="text-xs font-medium text-white">{template.name}</span>
      </div>
      {isActive && (
        <motion.div
          layoutId="template-selected"
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/10 dark:bg-black/40 pointer-events-none"
        >
          <Layout className="h-8 w-8 text-primary shadow-sm" />
        </motion.div>
      )}
    </button>
  );
};

const TemplateSheet = () => {
  const t = useTranslations("templates");
  const { activeResume, setTemplate } = useResumeStore();

  const currentTemplate =
    DEFAULT_TEMPLATES.find(
      (template) => template.id === activeResume?.templateId
    ) || DEFAULT_TEMPLATES[0];

  return (
    <Sheet>
      <SheetTrigger asChild>
        <PanelsLeftBottom size={20} />
      </SheetTrigger>
      <SheetContent side="left" forceMount className="w-1/2 sm:max-w-1/2">
        <SheetHeader>
          <SheetTitle>{t("switchTemplate")}</SheetTitle>
        </SheetHeader>
        <SheetDescription />

        <div className="mt-4 h-[calc(100vh-8rem)]">
          <ScrollArea className="h-full w-full pr-4">
            <div className="grid grid-cols-4 gap-4 pb-8">
              {activeResume &&
                DEFAULT_TEMPLATES.map((template) => (
                  <TemplatePreview
                    key={template.id}
                    template={template}
                    isActive={template.id === currentTemplate.id}
                    data={activeResume}
                    onSelect={setTemplate}
                  />
                ))}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default TemplateSheet;
