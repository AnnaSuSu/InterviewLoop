import type { TaskRecord } from './model.ts'
import type { PersistentTaskDispatcher, TaskRepository } from './ports.ts'

export type TaskHandler = (task: TaskRecord) => Promise<Record<string, unknown> | undefined>

export class PersistentTaskQueue implements PersistentTaskDispatcher {
  private readonly handlers = new Map<string, TaskHandler>()
  private readonly scheduled = new Set<string>()

  constructor(private readonly repository: TaskRepository) {}

  register(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler)
  }

  async start(): Promise<void> {
    for (const task of await this.repository.recoverable()) this.schedule(task.task_id, task.user_id)
  }

  async enqueue(input: { taskId: string; userId: string; type: string; payload: Record<string, unknown> }): Promise<TaskRecord> {
    const task = await this.repository.upsert(input)
    this.schedule(task.task_id, task.user_id)
    return task
  }

  get(taskId: string, userId: string): Promise<TaskRecord | undefined> {
    return this.repository.get(taskId, userId)
  }

  private schedule(taskId: string, userId: string): void {
    const key = `${taskId}:${userId}`
    if (this.scheduled.has(key)) return
    this.scheduled.add(key)
    queueMicrotask(() => void this.run(taskId, userId, key))
  }

  private async run(taskId: string, userId: string, key: string): Promise<void> {
    try {
      const task = await this.repository.claim(taskId, userId)
      if (!task) return
      const handler = this.handlers.get(task.type)
      if (!handler) throw new Error(`No task handler registered for ${task.type}`)
      const result = await handler(task)
      await this.repository.complete(taskId, userId, result)
    } catch (error) {
      await this.repository.fail(taskId, userId, error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500))
    } finally {
      this.scheduled.delete(key)
    }
  }
}
