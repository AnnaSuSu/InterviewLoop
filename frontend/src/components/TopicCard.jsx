import { getTopicIcon } from "../utils/topicIcons";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

export default function TopicCard({ name, icon, onClick, selected }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-4 md:gap-5 p-4 md:px-6 md:py-5 rounded-2xl cursor-pointer transition-all duration-300 text-left border bg-card/60 backdrop-blur-sm overflow-hidden",
        selected
          ? "border-primary bg-primary/[0.04] shadow-lg shadow-primary/20 -translate-y-1"
          : "border-border/80 hover:border-primary/40 hover:bg-card hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5"
      )}
    >
      {selected && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-[30px] -mr-12 -mt-12 pointer-events-none transition-opacity" />
      )}

      <div className={cn(
        "w-12 h-12 md:w-14 md:h-14 flex flex-shrink-0 items-center justify-center rounded-xl transition-colors duration-300 shadow-sm border z-10",
        selected
          ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/30"
          : "bg-background border-border/80 text-dim group-hover:text-primary group-hover:bg-primary/10 group-hover:border-primary/30"
      )}>
        {getTopicIcon(icon, selected ? 26 : 24)}
      </div>

      <div className="min-w-0 flex-1 z-10">
        <div className={cn(
          "text-[14px] md:text-[15px] font-extrabold leading-snug line-clamp-2 transition-colors duration-300 tracking-tight",
          selected ? "text-primary" : "text-text group-hover:text-primary/95"
        )}>
          {name}
        </div>
      </div>
        
      {selected ? (
        <div className="text-primary animate-in zoom-in duration-300 z-10 shrink-0 ml-2">
          <CheckCircle2 size={22} className="fill-current text-card drop-shadow-sm" />
        </div>
      ) : (
        <div className="w-1.5 h-1.5 rounded-full bg-border group-hover:bg-primary/40 transition-colors z-10 shrink-0 ml-2" />
      )}
    </div>
  );
}
