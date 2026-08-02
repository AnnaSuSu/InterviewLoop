// 字体经 @fontsource 自托管(见 styles/fonts.ts),不内嵌上游的 ttf/otf 原件;
// 导出 API 与上游保持一致
type FontDefinition = {
  label: string;
  value: string;
  aliases: string[];
};

export const DEFAULT_FONT_FAMILY =
  '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const FONT_DEFINITIONS: FontDefinition[] = [
  {
    label: "思源黑体",
    value: DEFAULT_FONT_FAMILY,
    aliases: [
      '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
      'Alibaba PuHuiTi, sans-serif',
      '"Alibaba PuHuiTi", sans-serif',
      '"MiSans", sans-serif',
      'MiSans, sans-serif',
      '"Microsoft YaHei", "微软雅黑", sans-serif',
      'Microsoft YaHei, sans-serif',
      '"Noto Sans SC", "Noto Sans CJK SC", sans-serif',
      'Noto Sans SC, sans-serif',
    ],
  },
  {
    label: "思源宋体",
    value: '"Noto Serif SC", "Songti SC", "Source Han Serif SC", serif',
    aliases: [
      '"Songti SC", "Noto Serif SC", "SimSun", serif',
      '"Source Han Serif SC", "Noto Serif SC", serif',
      '"Noto Serif SC", "Source Han Serif SC", serif',
      'Source Han Serif SC, serif',
      'Noto Serif SC, serif',
    ],
  },
  {
    label: "楷体(系统)",
    value: '"Kaiti SC", "STKaiti", "KaiTi", serif',
    aliases: [],
  },
];

const findFontDefinition = (fontFamily?: string) => {
  const normalizedValue = fontFamily?.trim();
  if (!normalizedValue) {
    return FONT_DEFINITIONS[0];
  }

  return (
    FONT_DEFINITIONS.find(
      (definition) =>
        definition.value === normalizedValue ||
        definition.aliases.includes(normalizedValue) ||
        definition.aliases.some((alias) =>
          normalizedValue.includes(alias.replace(/"/g, ""))
        )
    ) || FONT_DEFINITIONS[0]
  );
};

export const normalizeFontFamily = (fontFamily?: string) =>
  findFontDefinition(fontFamily).value;

export const getFontOptions = (_t?: (key: string) => string) =>
  FONT_DEFINITIONS.map((definition) => ({
    value: definition.value,
    label: definition.label,
  }));

// @font-face 由打包后的样式表提供,打印 iframe 拷贝页面样式即可拿到,无需在此内联
export const getFontFaceCss = async (_fontFamily?: string, _inline = false) =>
  "";
