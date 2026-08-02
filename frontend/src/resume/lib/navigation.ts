import { useLocation, useNavigate } from "react-router-dom";

type NavigateTarget =
  | string
  | {
      to: string;
      search?: Record<string, unknown>;
      hash?: string;
    };

function toPath(target: NavigateTarget) {
  if (typeof target === "string") return target;
  const search = target.search
    ? `?${new URLSearchParams(
        Object.entries(target.search).map(([k, v]) => [k, String(v)])
      )}`
    : "";
  const hash = target.hash ? `#${target.hash}` : "";
  return `${target.to}${search}${hash}`;
}

export function useRouter() {
  const navigate = useNavigate();

  return {
    push: (target: NavigateTarget) => navigate(toPath(target)),
    replace: (target: NavigateTarget) =>
      navigate(toPath(target), { replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
  };
}

export function usePathname() {
  return useLocation().pathname;
}
