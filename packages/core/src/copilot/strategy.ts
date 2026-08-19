import type { EmbeddingUseCases } from '../provider/ports.ts'
import type { RequestContext } from '../kernel/context.ts'

function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || !left.length) return -1
  let dot = 0; let l = 0; let r = 0
  for (let index = 0; index < left.length; index += 1) { dot += left[index]! * right[index]!; l += left[index]! ** 2; r += right[index]! ** 2 }
  return l && r ? dot / Math.sqrt(l * r) : -1
}

export class StrategyNavigator {
  readonly nodes: Record<string, Record<string, unknown>>
  private readonly samples: Array<{ nodeId: string; vector: Float32Array }> = []
  constructor(private readonly tree: Record<string, unknown>) { this.nodes = object(tree.nodes) as Record<string, Record<string, unknown>> }

  async prepare(context: RequestContext, embeddings: EmbeddingUseCases): Promise<void> {
    const values = Object.entries(this.nodes).flatMap(([nodeId, node]) => (Array.isArray(node.sample_questions) ? node.sample_questions : []).flatMap((question) => typeof question === 'string' && question.trim() ? [{ nodeId, question }] : []))
    const vectors = await embeddings.embed(context, values.map((value) => value.question))
    this.samples.splice(0, this.samples.length, ...values.map((value, index) => ({ nodeId: value.nodeId, vector: vectors[index]! })))
  }

  async match(context: RequestContext, embeddings: EmbeddingUseCases, utterance: string, lastNodeId?: string | null): Promise<{ nodeId?: string; intent: string; confidence: number }> {
    try {
      const vector = (await embeddings.embed(context, [utterance]))[0]
      let best: { nodeId?: string; score: number } = { score: -1 }
      if (vector) for (const sample of this.samples) { const score = cosine(vector, sample.vector); if (score > best.score) best = { nodeId: sample.nodeId, score } }
      if ((!best.nodeId || best.score < 0.5) && lastNodeId && this.nodes[lastNodeId]) return { nodeId: lastNodeId, intent: String(this.nodes[lastNodeId]!.intent || 'unknown'), confidence: Math.round(best.score * 1000) / 1000 }
      if (best.nodeId && best.score >= 0.45) return { nodeId: best.nodeId, intent: String(this.nodes[best.nodeId]?.intent || 'unknown'), confidence: Math.round(best.score * 1000) / 1000 }
      return { intent: ruleIntent(utterance), confidence: Math.round(best.score * 1000) / 1000 }
    } catch { return { nodeId: lastNodeId || undefined, intent: lastNodeId ? String(this.nodes[lastNodeId]?.intent || 'unknown') : ruleIntent(utterance), confidence: 0 } }
  }
  node(nodeId?: string): Record<string, unknown> | undefined { return nodeId ? this.nodes[nodeId] : undefined }
  children(nodeId?: string): Array<Record<string, unknown>> { const node = this.node(nodeId); return (Array.isArray(node?.children) ? node.children : []).flatMap((id) => typeof id === 'string' && this.nodes[id] ? [this.nodes[id]!] : []) }
}

const KEYWORDS: Record<string, string[]> = { greeting: ['你好', '自我介绍', '介绍一下自己', '先聊聊'], technical: ['原理', '实现', '底层', '区别', '机制', '解释一下'], project: ['项目', '做过', '负责', '经历', '案例', '上线'], behavioral: ['团队', '冲突', '压力', '失败', '困难', '挑战', '合作'], pressure: ['为什么', '怎么看', '质疑', '反驳', '不同意'] }
export function ruleIntent(text: string): string { let winner = 'technical'; let count = 0; for (const [intent, words] of Object.entries(KEYWORDS)) { const hits = words.filter((word) => text.toLowerCase().includes(word)).length; if (hits > count) { winner = intent; count = hits } } return winner }
