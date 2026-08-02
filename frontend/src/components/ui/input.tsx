import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, autoComplete, ...props }, ref) => {
  return (
    <input
      type={type}
      // Default off so the browser's password manager stops injecting saved
      // credentials into config/API-key fields (Chrome pairs any password input
      // with the nearest text field as a fake login form). Callers that DO want
      // autofill (login/register) pass an explicit autoComplete.
      autoComplete={autoComplete ?? (type === "password" ? "new-password" : "off")}
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
