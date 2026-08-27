import { Database } from 'bun:sqlite'

/** 一笔订单的处理结果。未发放的也要落库,否则对账时无从判断是漏了还是有意跳过。 */
export type OrderOutcome =
  | 'granted'        // 已发放
  | 'unmatched'      // 认不出本站用户(custom_order_id 缺失或无此人)
  | 'unknown_plan'   // 认不出档位(plan_id 没配进 CLOUD_TIERS)
  | 'ignored'        // 非成功订单等,无需处理

/**
 * 已处理订单台账。
 *
 * 存在的唯一理由是幂等:平台在异常时会重复推送同一笔订单,不去重就会重复
 * 延长有效期。out_trade_no 作主键,重复推送直接被主键挡下。
 */
export class OrderRepository {
  private readonly sqlite: Database

  constructor(path: string) {
    this.sqlite = new Database(path, { create: true })
    this.sqlite.exec('PRAGMA journal_mode = WAL')
  }

  initialize(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS cloud_orders (
        out_trade_no TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL DEFAULT '',
        plan_id      TEXT NOT NULL DEFAULT '',
        tier         TEXT NOT NULL DEFAULT '',
        months       INTEGER NOT NULL DEFAULT 1,
        amount       TEXT NOT NULL DEFAULT '',
        outcome      TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cloud_orders_outcome ON cloud_orders (outcome);
    `)
  }

  processed(outTradeNo: string): boolean {
    return !!this.sqlite
      .query<{ n: number }, { $no: string }>('SELECT 1 AS n FROM cloud_orders WHERE out_trade_no = $no')
      .get({ $no: outTradeNo })
  }

  /** 落库。已存在则原样保留,不覆盖——重复推送不该改写首次处理的结论。 */
  record(input: {
    outTradeNo: string
    userId?: string
    planId?: string
    tier?: string
    months?: number
    amount?: string
    outcome: OrderOutcome
  }): void {
    this.sqlite
      .query(`
        INSERT INTO cloud_orders (out_trade_no, user_id, plan_id, tier, months, amount, outcome)
        VALUES ($no, $userId, $planId, $tier, $months, $amount, $outcome)
        ON CONFLICT(out_trade_no) DO NOTHING
      `)
      .run({
        $no: input.outTradeNo,
        $userId: input.userId ?? '',
        $planId: input.planId ?? '',
        $tier: input.tier ?? '',
        $months: input.months ?? 1,
        $amount: input.amount ?? '',
        $outcome: input.outcome,
      })
  }

  /** 待人工处理的订单:认不出用户或档位的那些。 */
  pending(): Array<{ out_trade_no: string; user_id: string; plan_id: string; amount: string; outcome: string; created_at: string }> {
    return this.sqlite
      .query<{ out_trade_no: string; user_id: string; plan_id: string; amount: string; outcome: string; created_at: string }, []>(
        "SELECT out_trade_no, user_id, plan_id, amount, outcome, created_at FROM cloud_orders WHERE outcome IN ('unmatched','unknown_plan') ORDER BY created_at DESC",
      )
      .all()
  }

  close(): void {
    this.sqlite.close()
  }
}
