"""简历 PDF → 结构化数据的解析提示词(简历管理「解析为模板简历」用)。"""

# 富文本字段一律要点数组,由前端统一渲染成编辑器 HTML;
# 日期是自由文本(保持原文写法),不要求机器可解析
RESUME_PARSE_PROMPT = """请把下面这份简历的原文,解析成结构化 JSON。

要求:
1. 只输出 JSON,不要任何解释或 Markdown 代码块。
2. 字段值一律用简历原文的语言,不要翻译、不要润色、不要编造原文没有的内容。
3. 原文缺失的字段:字符串填 ""、数组填 []。
4. 日期保持原文写法(如 "2021.07 - 2023.04"、"2023至今"),不要改格式。
5. details / description / skills / selfEvaluation 是要点数组:一条要点一个元素,去掉行首的项目符号(•、-、数字编号)。

JSON 结构:
{{
  "basic": {{
    "name": "姓名",
    "title": "求职意向/职位",
    "email": "",
    "phone": "",
    "location": "所在城市",
    "birthDate": "",
    "employementStatus": "在职/离职/应届等求职状态"
  }},
  "education": [
    {{"school": "", "major": "", "degree": "", "startDate": "", "endDate": "", "gpa": "", "description": ["在校经历要点"]}}
  ],
  "experience": [
    {{"company": "", "position": "", "date": "起止时间", "details": ["工作内容要点"]}}
  ],
  "projects": [
    {{"name": "项目名", "role": "担任角色", "date": "起止时间", "description": ["项目要点"]}}
  ],
  "skills": ["技能要点"],
  "selfEvaluation": ["自我评价要点"]
}}

简历原文:
---
{resume_text}
---
"""
