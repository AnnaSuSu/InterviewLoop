import { createHash, createVerify } from 'node:crypto'

/** 爱发电订单。字段含义见其开发者文档,这里只列用得上的。 */
export type AfdianOrder = {
  out_trade_no: string
  /** 下单的爱发电用户 ID,不是本站用户 */
  user_id: string
  /** 方案 ID;自选金额时为空 */
  plan_id: string
  /** 前端下单链接透传回来的自定义字段,本站用它携带自己的用户 ID */
  custom_order_id?: string
  month?: number
  total_amount: string
  /** 2 表示交易成功,目前也只会推送这一种 */
  status: number
  remark?: string
}

/** 爱发电公钥,用于回调验签。取自其开发者文档。 */
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`

/**
 * 校验回调签名。
 *
 * 签名原文是 out_trade_no、user_id、plan_id、total_amount 依次拼接,顺序由
 * 平台定死,不能改。**没有签名一律当伪造处理**——这个接口一旦能被伪造,
 * 任何人都能给自己开订阅。
 */
export function verifyOrderSignature(order: AfdianOrder, sign: string | undefined): boolean {
  if (!sign) return false
  const source = `${order.out_trade_no}${order.user_id}${order.plan_id}${order.total_amount}`
  try {
    return createVerify('SHA256').update(source).verify(PUBLIC_KEY, sign, 'base64')
  } catch {
    return false
  }
}

/** 主动查询接口的客户端,用于对账——文档明说 webhook 不保证送达。 */
export class AfdianClient {
  constructor(private readonly userId: string, private readonly token: string) {}

  static fromEnv(): AfdianClient | null {
    const userId = process.env.AFDIAN_USER_ID?.trim()
    const token = process.env.AFDIAN_TOKEN?.trim()
    return userId && token ? new AfdianClient(userId, token) : null
  }

  private async call<T>(endpoint: string, params: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify(params)
    const ts = Math.floor(Date.now() / 1000)
    // 平台规则:md5(token + 按 key 排序拼接的 kv),kv 之间无分隔符
    const sign = createHash('md5').update(`${this.token}params${body}ts${ts}user_id${this.userId}`).digest('hex')
    const response = await fetch(`https://ifdian.net/api/open/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: this.userId, params: body, ts, sign }),
      signal: AbortSignal.timeout(20_000),
    })
    const payload = (await response.json()) as { ec: number; em: string; data: T }
    if (payload.ec !== 200) throw new Error(`爱发电接口 ${endpoint} 失败: ${payload.ec} ${payload.em}`)
    return payload.data
  }

  async queryOrders(page = 1): Promise<AfdianOrder[]> {
    const data = await this.call<{ list: AfdianOrder[] }>('query-order', { page })
    return data.list ?? []
  }
}
