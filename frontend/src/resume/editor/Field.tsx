import { useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "@/resume/i18n/compat/client";

import { cn } from "@/resume/lib/utils";
import { Switch } from "@/resume/ui/switch";
import RichTextEditor from "../shared/rich-editor/RichEditor";

interface FieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "textarea" | "date" | "editor" | "date-range";
  placeholder?: string;
  required?: boolean;
  className?: string;
  showPresentSwitch?: boolean;
}

const Field = ({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  className,
  showPresentSwitch,
}: FieldProps) => {
  const t = useTranslations();

  const isPresentValue = useMemo(() => {
    return (
      value === t("field.toPresent") ||
      value.endsWith(` - ${t("field.toPresent")}`)
    );
  }, [value, t]);

  const handlePresentToggle = (checked: boolean) => {
    if (type === "date") {
      onChange(checked ? t("field.toPresent") : "");
    } else if (type === "date-range") {
      const [start] = value.split(" - ");
      onChange(
        checked
          ? [start, t("field.toPresent")].filter(Boolean).join(" - ")
          : start || ""
      );
    }
  };

  const renderLabel = () => {
    if (!label) return null;
    return (
      <div className="flex items-center justify-between mb-1.5 font-medium">
        <span className="text-sm text-foreground">{label}</span>
        {showPresentSwitch && (
          <div className="flex items-center gap-2">
            <Switch
              checked={isPresentValue}
              onCheckedChange={handlePresentToggle}
            />
            <span className="text-xs text-muted-foreground">
              {t("field.toPresent")}
            </span>
          </div>
        )}
      </div>
    );
  };

  const inputStyles = cn(
    "block w-full rounded-md border-0 py-1.5 px-3",
    "text-foreground bg-background",
    "shadow-sm ring-1 ring-inset ring-input",
    "placeholder:text-muted-foreground",
    "focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary",
    "sm:text-sm sm:leading-6",
    className
  );

  if (type === "textarea") {
    return (
      <label className="block">
        {renderLabel()}
        <motion.textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputStyles}
          required={required}
          rows={4}
          whileHover={{ scale: 1.005 }}
          whileTap={{ scale: 0.995 }}
        />
      </label>
    );
  }

  if (type === "editor") {
    return (
      <motion.div className="block">
        {renderLabel()}
        <div className="mt-1.5">
          <RichTextEditor
            content={value || ""}
            onChange={onChange}
            placeholder={placeholder}
          />
        </div>
      </motion.div>
    );
  }

  // date / date-range 存的本就是自由文本(如 "2023.06"、"2023.06 - 至今"),用普通输入框
  return (
    <label className="block">
      {renderLabel()}
      <motion.input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputStyles}
        required={required}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
      />
    </label>
  );
};

export default Field;
