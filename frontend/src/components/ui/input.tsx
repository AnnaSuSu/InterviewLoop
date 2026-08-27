import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, autoComplete, ...props }, ref) => {
  // Chrome ignores autocomplete="off" on anything it reads as a login form, and
  // extension managers ignore it outright — that is how an email ended up typed
  // into the LLM "Model" box next to the API-key field. Vendor opt-out
  // attributes are the only thing they honour. Fields that DO want autofill
  // (login/register) pass an explicit autoComplete and keep manager support.
  const ignoreManagers =
    autoComplete === undefined
      ? { "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": true, "data-form-type": "other" }
      : {};
  return (
    <input
      type={type}
      autoComplete={autoComplete ?? (type === "password" ? "new-password" : "off")}
      {...ignoreManagers}
      className={cn(
        "flex h-9 w-full rounded-lg border border-border bg-input px-3.5 py-2.5 text-sm text-text shadow-sm transition-colors placeholder:text-dim/50 focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
