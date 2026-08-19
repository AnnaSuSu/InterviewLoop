export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Invalid or expired token') {
    super(message, 401)
  }
}

export class ProviderNotConfigured extends AppError {
  constructor(readonly provider: 'LLM' | 'Embedding') {
    const label = provider === 'LLM' ? 'LLM' : 'Embedding'
    super(
      `请先在「设置」里配置你自己的 ${label} 服务后再使用`,
      400,
      'provider_not_configured',
      { provider },
    )
  }
}

export class QuotaExceeded extends AppError {
  constructor(message: string) {
    super(message, 402, 'quota_exceeded')
  }
}
