const EXACT_TITLES = {
  diagnosis: "总体诊断",
  nextSteps: "下一轮训练计划",
};

const FALLBACK_TITLES = {
  diagnosis: /进步|薄弱|掌握/,
  nextSteps: /建议|下一步/,
};

export function parseRetrospectiveSections(markdown) {
  if (!markdown) return [];

  const lines = markdown.split("\n");
  const sections = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const content = current.markdown.trim();
    if (!content) return;
    sections.push({ title: current.title, markdown: content });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = parseRetrospectiveHeading(line);

    if (heading) {
      pushCurrent();
      current = { title: heading, markdown: "" };
      continue;
    }

    if (!current) current = { title: "阶段回顾", markdown: "" };
    current.markdown += current.markdown ? `\n${rawLine}` : rawLine;
  }

  pushCurrent();
  return sections;
}

export function selectRetrospectiveSections(sections) {
  const select = (kind) => sections.find((section) => section.title === EXACT_TITLES[kind])
    || sections.find((section) => FALLBACK_TITLES[kind].test(section.title));

  return { diagnosis: select("diagnosis"), nextSteps: select("nextSteps") };
}

function parseRetrospectiveHeading(line) {
  if (!line) return "";
  if (/^#{1,6}\s+/.test(line)) return cleanHeading(line.replace(/^#{1,6}\s+/, ""));
  if (/^\d+\.\s+/.test(line)) return cleanHeading(line.replace(/^\d+\.\s+/, ""));
  return "";
}

function cleanHeading(value) {
  return value.replace(/\*\*/g, "").trim();
}
