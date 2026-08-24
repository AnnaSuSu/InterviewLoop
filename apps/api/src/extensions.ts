import type { OpenAPIHono } from '@hono/zod-openapi'
import type { QuotaUseCases, TokenService } from '@techspar/core'

export type ExtensionContext = {
  dbPath: string
  tokens: TokenService
}

/** 部署方可选注入的扩展。内置装配之外的行为都从这里进来,核心代码不感知具体实现。 */
export type Extensions = {
  /** 包装或替换默认配额策略,用于自定义计费规则。 */
  quota?(base: QuotaUseCases, context: ExtensionContext): QuotaUseCases
  /** 在内置路由注册完成后追加路由。 */
  routes?(app: OpenAPIHono, context: ExtensionContext): void
}

/**
 * 加载 TECHSPAR_EXTENSIONS 指向的模块,相对本文件解析。
 *
 * 没配置就是没扩展;配置了却加载失败必须抛出——静默降级会让计费策略无声失效,
 * 那种故障在生产上极难察觉。
 */
export async function loadExtensions(specifier: string | undefined): Promise<Extensions> {
  const target = specifier?.trim()
  if (!target) return {}
  const module = (await import(target)) as { default?: Extensions }
  if (!module.default) throw new Error(`扩展模块 ${target} 必须默认导出 Extensions`)
  return module.default
}
