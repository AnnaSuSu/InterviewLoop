"""Company Researcher — Tavily 联网搜索公司面试信息。"""
import json
import logging

from backend.llm_provider import HumanMessage, SystemMessage, get_copilot_llm, resolve_tavily_key

logger = logging.getLogger("uvicorn")


async def search_company(company: str, position: str = "") -> str:
    """搜索公司信息并结构化整理。返回 JSON 字符串格式的 company_report。"""
    tavily_key = resolve_tavily_key()
    if not tavily_key:
        logger.warning("TAVILY_API_KEY not configured, skipping company search")
        return json.dumps({
            "company_name": company or "未知",
            "tech_stack": [],
            "interview_style": "无法获取（未配置搜索 API）",
            "culture_notes": "",
            "common_focus_areas": [],
            "sources": [],
        }, ensure_ascii=False)

    from tavily import TavilyClient
    client = TavilyClient(api_key=tavily_key)

    queries = [
        f"{company} {position} 业务方向 技术场景 产品",
        f"{company} {position} 面试经验 面试流程 考察重点",
        f"{company} 技术栈 工程文化 技术架构",
    ]

    all_results = []
    for q in queries:
        try:
            resp = client.search(query=q, max_results=3, search_depth="basic")
            for r in resp.get("results", []):
                all_results.append({
                    "title": r.get("title", ""),
                    "content": r.get("content", "")[:500],
                    "url": r.get("url", ""),
                })
        except Exception as e:
            logger.warning(f"Tavily search failed for '{q}': {e}")

    if not all_results:
        return json.dumps({
            "company_name": company or "未知",
            "tech_stack": [],
            "interview_style": "搜索未返回结果",
            "culture_notes": "",
            "common_focus_areas": [],
            "sources": [],
        }, ensure_ascii=False)

    llm = get_copilot_llm()
    messages = [
        SystemMessage(content="""你是一个面试情报分析师。根据搜索结果，为候选人整理目标公司针对该岗位的面试情报。

分析时严格按以下推导链进行：
1. 该公司在【目标岗位所属领域】有哪些具体产品或业务（不是公司最出名的业务，是跟岗位直接相关的）
2. 这些产品在工程上面临什么具体技术挑战（要结合产品特点，不要泛泛而谈）
3. 因此面试官会聚焦哪些技术问题（从产品挑战倒推，而不是列通用考点）

输出严格 JSON 格式：
{
  "company_name": "公司名",
  "main_business": "该公司在目标岗位领域有哪些产品/业务，2-3句，具体到产品名",
  "interviewer_mindset": "基于上述产品的真实技术挑战，面试官会重点考察什么、会往哪里深挖，逻辑要从产品出发",
  "how_to_reference": "回答技术问题时，如何把答案与公司该领域产品的具体场景挂钩，给出1-2个可直接套用的角度",
  "tech_stack": ["技术1", "技术2"],
  "interview_style": "面试风格描述（轮数、侧重点、难度）",
  "culture_notes": "工程文化特点",
  "common_focus_areas": ["重点考察方向1", "方向2"],
  "sources": ["url1", "url2"]
}
只输出 JSON，不要其他内容。"""),
        HumanMessage(content=f"公司: {company}\n岗位: {position}\n\n搜索结果:\n{json.dumps(all_results, ensure_ascii=False)}"),
    ]
    resp = await llm.ainvoke(messages)
    text = resp.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()
