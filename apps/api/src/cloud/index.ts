import { BunUsageRepository } from '@techspar/db'
import { CloudQuotaService } from './quota.ts'
import { registerCloudRoutes } from './routes.ts'
import { SubscriptionRepository } from './subscriptions.ts'
import type { Extensions } from '../extensions.ts'

// quota 与 routes 由上游分两次调用,共用同一个实例,避免两份表句柄各自初始化。
let shared: SubscriptionRepository | undefined

function subscriptions(dbPath: string): SubscriptionRepository {
  if (!shared) {
    shared = new SubscriptionRepository(dbPath)
    shared.initialize()
  }
  return shared
}

const extensions: Extensions = {
  quota: (base, context) => new CloudQuotaService(base, new BunUsageRepository(context.dbPath), subscriptions(context.dbPath)),
  routes: (app, context) => registerCloudRoutes(app, { subscriptions: subscriptions(context.dbPath), tokens: context.tokens }),
}

export default extensions
