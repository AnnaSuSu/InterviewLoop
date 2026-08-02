// 不随仓库分发字体文件,全部走系统字库;导出 API 与上游保持一致
type FontDefinition = {
  label: string;
  value: string;
  aliases: string[];
};

export const DEFAULT_FONT_FAMILY =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

const FONT_DEFINITIONS: FontDefinition[] = [
  {
    label: "系统黑体",
    value: DEFAULT_FONT_FAMILY,
    aliases: [
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
    label: "宋体 / 衬线",
    value: '"Songti SC", "Noto Serif SC", "SimSun", serif',
    aliases: [
      '"Source Han Serif SC", "Noto Serif SC", serif',
      '"Noto Serif SC", "Source Han Serif SC", serif',
      'Source Han Serif SC, serif',
      'Noto Serif SC, serif',
    ],
  },
  {
    label: "楷体",
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

// 系统字库无需内嵌 @font-face;打印路径直接依赖本机字体
export const getFontFaceCss = async (_fontFamily?: string, _inline = false) =>
  "";
