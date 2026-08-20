import type { IdGenerator, PasswordHasher, UserRepository } from './ports.ts'

export type DefaultAccountInput = {
  email: string
  password: string
  name: string
  rotateLegacyPassword?: string
}

/** Provision the configured owner account and rotate the desktop client's former fixed password once. */
export async function ensureDefaultAccount(
  users: UserRepository,
  passwords: PasswordHasher,
  ids: IdGenerator,
  input: DefaultAccountInput,
): Promise<'created' | 'rotated' | 'unchanged'> {
  const existing = await users.findByEmail(input.email)
  if (!existing) {
    await users.create({ id: ids.next(), email: input.email, password: await passwords.hash(input.password), name: input.name })
    return 'created'
  }
  if (!input.rotateLegacyPassword || await passwords.verify(input.password, existing.password)) return 'unchanged'
  if (!await passwords.verify(input.rotateLegacyPassword, existing.password)) return 'unchanged'
  await users.updatePassword(existing.id, await passwords.hash(input.password))
  return 'rotated'
}
