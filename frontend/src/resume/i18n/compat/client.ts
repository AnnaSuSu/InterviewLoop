// 上游 next-intl shim 的极简版:整站仅中文,无需 Provider
import zhMessages from "../locales/zh.json";
import { createTranslator, Translator } from "./utils";

const translatorCache = new Map<string, Translator>();

export function useLocale() {
  return "zh";
}

export function useTranslations(namespace?: string): Translator {
  const key = namespace ?? "";
  let translator = translatorCache.get(key);
  if (!translator) {
    translator = createTranslator(zhMessages, namespace);
    translatorCache.set(key, translator);
  }
  return translator;
}
