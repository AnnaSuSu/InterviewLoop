"""Intent Classifier — embedding 匹配 + 规则兜底，不调 LLM。"""
import re
import logging

from backend.llm_provider import get_embedding
from backend.copilot.strategy_tree import StrategyTreeNavigator

logger = logging.getLogger("uvicorn")

# 规则兜底关键词
_INTENT_KEYWORDS = {
    "greeting": ["你好", "自我介绍", "介绍一下自己", "先聊聊", "认识一下"],
    "technical": ["原理", "实现", "底层", "源码", "区别", "对比", "机制", "怎么理解", "解释一下"],
    "project": ["项目", "做过", "负责", "经历", "案例", "实际", "上线"],
    "behavioral": ["团队", "冲突", "压力", "失败", "困难", "挑战", "领导", "合作"],
    "pressure": ["为什么", "怎么看", "如果不是", "质疑", "反驳", "不同意"],
}


def rule_based_classify(utterance: str) -> str:
    """关键词规则分类，作为 embedding 匹配的兜底。"""
    text = utterance.lower()
    best_intent, best_count = "technical", 0
    for intent, keywords in _INTENT_KEYWORDS.items():
        count = sum(1 for kw in keywords if kw in text)
        if count > best_count:
            best_count = count
            best_intent = intent
    return best_intent


async def classify_intent(
    utterance: str,
    navigator: StrategyTreeNavigator,
) -> dict:
    """分类 HR 发言意图，返回 {intent, node_id, confidence, utterance_embedding}。

    优先 embedding 匹配策略树节点，匹配不上则规则兜底。
    utterance_embedding 透传给调用方用于 correction 命中判断。
    """
    embed_model = get_embedding()
    try:
        utt_emb = embed_model.get_text_embedding(utterance)
    except Exception as e:
        logger.warning(f"Embedding failed, falling back to rules: {e}")
        return {"intent": rule_based_classify(utterance), "node_id": None, "confidence": 0.0, "utterance_embedding": None}

    node_id, intent, score = navigator.match_utterance(utt_emb)

    if node_id is None:
        return {
            "intent": rule_based_classify(utterance),
            "node_id": None,
            "confidence": round(score, 3),
            "utterance_embedding": utt_emb,
        }

    return {
        "intent": intent,
        "node_id": node_id,
        "confidence": round(score, 3),
        "utterance_embedding": utt_emb,
    }
