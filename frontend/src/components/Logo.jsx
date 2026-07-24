import { cn } from "@/lib/utils";

// TechSpar 折线脉冲标:下探-反弹-上扬,终点高于起点(每轮复盘后更高)。
// 单色琥珀,与站内主色一致,深浅主题通用。
export default function Logo({ className }) {
  return (
    <svg
      viewBox="86 86 340 340"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="TechSpar"
      shapeRendering="geometricPrecision"
      className={cn("shrink-0 block", className)}
    >
      <path
        d="M120 283 L160 283 L198 383 L250 165 L300 251 L392 129"
        stroke="#f59e0b"
        strokeWidth="36"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
