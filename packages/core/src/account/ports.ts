import type { AuthUser } from './model.ts'

export interface UserRepository {
  findByEmail(email: string): Promise<(AuthUser & { password: string }) | undefined>
  findById(id: string): Promise<AuthUser | undefined>
  create(input: { id: string; email: string; password: string; name: string }): Promise<AuthUser>
}

export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(password: string, hash: string): Promise<boolean>
}

export interface TokenService {
  create(userId: string): Promise<string>
  decode(token: string): Promise<string | undefined>
}

export interface IdGenerator {
  next(): string
}

export interface AuthUseCases {
  login(email: string, password: string): Promise<{ token: string; user: AuthUser }>
  register(email: string, password: string, name: string): Promise<{ token: string; user: AuthUser }>
}

export type AuthPolicy = {
  allowRegistration: boolean
}
