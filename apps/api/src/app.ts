import { OpenAPIHono } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import type { UpgradeWebSocket } from 'hono/ws'
import {
  AppError,
  type AuthPolicy,
  type AuthUseCases,
  type KnowledgeUseCases,
  type InterviewUseCases,
  type QuotaUseCases,
  type ResumeUseCases,
  type ProfileUseCases,
  type PersonalAgentUseCases,
  type DataMigrationUseCases,
  type RecordingUseCases,
  type CopilotPrepUseCases,
  type CopilotRealtimeUseCases,
  type VoiceprintUseCases,
  type SettingsUseCases,
  type SettingsOperationsUseCases,
  type TokenService,
} from '@techspar/core'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerSettingsRoutes } from './routes/settings.ts'
import { registerKnowledgeRoutes } from './routes/knowledge.ts'
import { registerResumeRoutes } from './routes/resume.ts'
import { registerInterviewRoutes } from './routes/interview.ts'
import { registerProfileRoutes } from './routes/profile.ts'
import { registerPersonalAgentRoutes } from './routes/personal-agent.ts'
import { registerDataMigrationRoutes } from './routes/data-migration.ts'
import { registerRecordingRoutes } from './routes/recording.ts'
import { registerCopilotRoutes, registerCopilotWebSocket } from './routes/copilot.ts'
import { registerVoiceprintRoutes } from './routes/voiceprint.ts'

export type AppDependencies = {
  auth: AuthUseCases
  registration: AuthPolicy
  settings: SettingsUseCases
  settingsOperations?: SettingsOperationsUseCases
  quota: QuotaUseCases
  tokens: TokenService
  knowledge: KnowledgeUseCases
  resume: ResumeUseCases
  interview?: InterviewUseCases
  profile?: ProfileUseCases
  personalAgent?: PersonalAgentUseCases
  migration?: DataMigrationUseCases
  recording?: RecordingUseCases
  copilotPrep?: CopilotPrepUseCases
  copilotRealtime?: CopilotRealtimeUseCases
  websocketUpgrade?: UpgradeWebSocket
  voiceprint?: VoiceprintUseCases
}

export function createApp(deps: AppDependencies): OpenAPIHono {
  const app = new OpenAPIHono()

  app.use('*', requestId())
  app.use('/api/*', logger())
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], allowHeaders: ['*'] }))

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ detail: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details || {}) }, error.status as 400)
    }
    console.error(error)
    return c.json({ detail: 'Internal Server Error' }, 500)
  })

  registerAuthRoutes(app, deps)
  registerSettingsRoutes(app, deps)
  registerKnowledgeRoutes(app, deps)
  registerResumeRoutes(app, deps)
  if (deps.interview) registerInterviewRoutes(app, { interview: deps.interview, tokens: deps.tokens })
  if (deps.profile) registerProfileRoutes(app, { profile: deps.profile, tokens: deps.tokens })
  if (deps.personalAgent) registerPersonalAgentRoutes(app, { personalAgent: deps.personalAgent, tokens: deps.tokens })
  if (deps.migration) registerDataMigrationRoutes(app, { migration: deps.migration, tokens: deps.tokens })
  if (deps.recording) registerRecordingRoutes(app, { recording: deps.recording, tokens: deps.tokens })
  if (deps.copilotPrep) registerCopilotRoutes(app, { prep: deps.copilotPrep, tokens: deps.tokens })
  if (deps.copilotRealtime && deps.websocketUpgrade) registerCopilotWebSocket(app, { realtime: deps.copilotRealtime, tokens: deps.tokens, upgrade: deps.websocketUpgrade })
  if (deps.voiceprint) registerVoiceprintRoutes(app, { voiceprint: deps.voiceprint, tokens: deps.tokens })
  app.doc('/openapi.json', { openapi: '3.1.0', info: { title: 'TechSpar', version: '0.2.0' } })
  return app
}
