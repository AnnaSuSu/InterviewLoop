export const RECORDING_STRUCTURE_PROMPT = `你是面试记录分析专家。以下是一段面试录音的转写文本，可能包含说话人标记。

## 转写文本
{transcript}

分析对话并识别面试官和候选人，提取所有 Q&A 对。寒暄和过渡语不算问题；同一话题的连续追问合并；被打断后继续的回答合并；跳过开场白和结束语。

只返回 JSON：
{"qa_pairs":[{"id":1,"question":"完整问题","answer":"完整回答","focus_area":"知识点","topic":"技术领域"}],"metadata":{"total_questions":1,"topics_covered":["领域"],"difficulty_impression":"中等"}}`

export const RECORDING_DUAL_EVAL_PROMPT = `你是资深技术面试官，正在评估候选人在真实面试中的表现。

## 候选人画像
{profile_summary}

## 候选人的回答
{qa_pairs}

逐题评估，并判断已知薄弱点是否改善、是否出现新薄弱点以及整体趋势。候选人用自己的话说，只要核心理解正确就给分。

只返回 JSON：
{"scores":[{"question_id":1,"score":7,"assessment":"点评","improvement":"改进建议","understanding":"核心理解正确","weak_point":null,"key_missing":[]}],"overall":{"avg_score":7,"summary":"整体评价","new_weak_points":[],"new_strong_points":[],"communication_observations":{"style_update":"","new_habits":[],"new_suggestions":[]},"thinking_patterns":{"new_strengths":[],"new_gaps":[]},"longitudinal":{"improved_points":[],"persisting_points":[],"new_concerns":[]}}}

评分：0=完全跑偏，3=有印象但理解有误，5=方向正确但浅，7=理解正确且有思考，10=深入透彻。`

export const RECORDING_SOLO_EVAL_PROMPT = `你是资深技术面试官，正在评估候选人的技术表达录音。

## 候选人画像
{profile_summary}

## 候选人的技术表达
{transcript}

从知识覆盖、理解深度、准确性和表达质量评估，并判断历史薄弱点是否改善。

只返回 JSON：
{"topics_covered":[{"id":1,"topic":"知识点","domain":"技术领域","score":7,"assessment":"评价","understanding":"核心理解正确","errors":[],"missing":[]}],"overall":{"avg_score":7,"summary":"整体评价","new_weak_points":[],"new_strong_points":[],"communication_observations":{"style_update":"","new_habits":[],"new_suggestions":[]},"thinking_patterns":{"new_strengths":[],"new_gaps":[]},"longitudinal":{"improved_points":[],"persisting_points":[],"new_concerns":[]}}}`
