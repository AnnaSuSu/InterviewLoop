type ValidationIssue = {
  code: string
  path: PropertyKey[]
  message: string
}

const LOCATION: Record<string, string> = {
  json: 'body',
  form: 'body',
  param: 'path',
  query: 'query',
  header: 'header',
  cookie: 'cookie',
}

export function fastApiValidationBody(target: string, issues: readonly ValidationIssue[], input?: unknown) {
  return {
    detail: issues.map((issue) => {
      const missing = issue.code === 'invalid_type' && issue.message.includes('received undefined')
      return {
        type: missing ? 'missing' : issue.code,
        loc: [LOCATION[target] || target, ...issue.path.map((part) => typeof part === 'symbol' ? String(part) : part)],
        msg: missing ? 'Field required' : issue.message,
        input: input ?? null,
      }
    }),
  }
}
