import type { RequestContext } from '../kernel/context.ts'
import type { InterviewSessionRepository, PersistentTaskDispatcher } from '../interview/ports.ts'
import type { TaskRecord } from '../interview/model.ts'
import type { KnowledgeStore } from '../knowledge/ports.ts'
import type { TextGenerationUseCases } from '../provider/ports.ts'
import type { ResumeUseCases } from '../resume/ports.ts'
import type { CandidateProfile } from './model.ts'

export interface CandidateProfileRepository {
  load(userId: string): Promise<CandidateProfile>
  save(userId: string, profile: CandidateProfile): Promise<void>
  update<T>(userId: string, mutate: (profile: CandidateProfile) => T | Promise<T>): Promise<T>
}

export interface ProfileUseCases {
  get(context: RequestContext): Promise<CandidateProfile>
  inferTargetRole(context: RequestContext): Promise<{ target_role: string }>
  viewed(context: RequestContext): Promise<Record<string, unknown>>
  feedback(context: RequestContext, point: string, verdict: string): Promise<Record<string, unknown>>
  dueReviews(context: RequestContext, topic?: string): Promise<Array<Record<string, unknown>>>
  topicHistory(context: RequestContext, topic: string): Promise<unknown[]>
  retrospective(context: RequestContext, topic: string): Promise<{ task_id: string; status: 'pending' }>
  runRetrospectiveTask(task: TaskRecord): Promise<Record<string, unknown>>
}

export type ProfileDependencies = {
  repository: CandidateProfileRepository
  sessions: InterviewSessionRepository
  tasks: PersistentTaskDispatcher
  ai: TextGenerationUseCases
  resume: ResumeUseCases
  knowledgeStore: KnowledgeStore
}
