import { describe, expect, test } from 'bun:test'
import {
  AuthService,
  QuotaService,
  SettingsService,
  type AuthUser,
  type PlatformProviderConfig,
  type KnowledgeUseCases,
  type ResumeUseCases,
  type ProviderSettingsRepository,
  type StoredProviderSettings,
  type TrainingSettings,
  type UserRepository,
} from '@techspar/core'
import { createApp } from '../apps/api/src/app.ts'
import { BcryptPasswordHasher, JoseTokenService, loadConfig, ShortUuidGenerator } from '@techspar/platform'

class MemoryUsers implements UserRepository {
  rows = new Map<string, AuthUser & { password: string }>()
  async findByEmail(email: string) { return [...this.rows.values()].find((row) => row.email === email.toLowerCase().trim()) }
  async findById(id: string) { return this.rows.get(id) }
  async create(input: { id: string; email: string; password: string; name: string }) {
    const user = { id: input.id, email: input.email.toLowerCase().trim(), name: input.name, is_admin: false }
    this.rows.set(user.id, { ...user, password: input.password })
    return user
  }
}

class MemorySettings implements ProviderSettingsRepository {
  async loadProvider(): Promise<StoredProviderSettings> { return { services: { dashscope_api_key: '', tavily_api_key: '', oss_access_key_id: '', oss_access_key_secret: '', oss_bucket: '', oss_endpoint: '' } } }
  async saveProvider(): Promise<void> {}
  async loadTraining(): Promise<TrainingSettings> { return { num_questions: 10, divergence: 3 } }
  async saveTraining(): Promise<void> {}
  async loadLastReindexAt(): Promise<string> { return '' }
  async saveLastReindexAt(): Promise<void> {}
  async loadSystem() { return undefined }
  async saveSystem(): Promise<void> {}
}

const platform: PlatformProviderConfig = {
  llm: { api_base: '', api_key: '', model: '' },
  embedding: { api_base: '', api_key: '', api_model: '' },
  dailyCallLimit: 0,
}

function testApp(allowRegistration = false) {
  const users = new MemoryUsers()
  const config = loadConfig({ TECHSPAR_BASE_DIR: '/tmp/techspar-test', JWT_SECRET: 'test-secret', ALLOW_REGISTRATION: String(allowRegistration) })
  const passwords = new BcryptPasswordHasher()
  const tokens = new JoseTokenService(config.jwtSecret)
  const registration = { allowRegistration }
  const auth = new AuthService(users, passwords, tokens, new ShortUuidGenerator(), registration)
  const settings = new SettingsService(new MemorySettings(), users, { async invalidateUser() {}, resetEmbeddingClient() {} }, platform, registration)
  const usage = { initialize() {}, async record() {}, async platformCallsToday() { return 0 } }
  return { users, config, passwords, app: createApp({ auth, registration, settings, quota: new QuotaService(usage, platform), tokens, knowledge: {} as KnowledgeUseCases, resume: {} as ResumeUseCases }) }
}

describe('auth compatibility', () => {
  test('reports registration flag and service version', async () => {
    const { app } = testApp()
    expect(await (await app.request('/api/auth/config')).json()).toEqual({ allow_registration: false })
    expect(await (await app.request('/api/')).json()).toEqual({ service: 'TechSpar', version: '0.2.0' })
  })

  test('accepts an existing bcrypt password', async () => {
    const { app, users, passwords } = testApp()
    users.rows.set('legacy01', { id: 'legacy01', email: 'admin@example.com', name: 'Admin', is_admin: false, password: await passwords.hash('secret') })
    const response = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ADMIN@example.com', password: 'secret' }) })
    expect(response.status).toBe(200)
    expect((await response.json() as { user: AuthUser }).user.id).toBe('legacy01')
  })

  test('keeps FastAPI login error body', async () => {
    const { app } = testApp()
    const response = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }) })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ detail: 'Invalid email or password' })
  })

  test('registration remains disabled by default', async () => {
    const { app } = testApp()
    const response = await app.request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'new@example.com', password: 'secret', name: '' }) })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'Registration is disabled' })
  })
})
