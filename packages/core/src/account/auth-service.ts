import { AppError } from '../kernel/errors.ts'
import type { AuthUser } from './model.ts'
import type { AuthPolicy, AuthUseCases, IdGenerator, PasswordHasher, TokenService, UserRepository } from './ports.ts'

/** Authentication application service. It depends only on ports owned by core. */
export class AuthService implements AuthUseCases {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly ids: IdGenerator,
    private readonly policy: AuthPolicy,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const row = await this.users.findByEmail(email)
    if (!row || !(await this.passwords.verify(password, row.password))) {
      throw new AppError('Invalid email or password', 401)
    }
    const { password: _, ...user } = row
    return { token: await this.tokens.create(user.id), user }
  }

  async register(email: string, password: string, name: string): Promise<{ token: string; user: AuthUser }> {
    if (!this.policy.allowRegistration) throw new AppError('Registration is disabled', 403)
    if (await this.users.findByEmail(email)) throw new AppError('Email already registered', 409)
    const user = await this.users.create({
      id: this.ids.next(),
      email,
      password: await this.passwords.hash(password),
      name,
    })
    return { token: await this.tokens.create(user.id), user }
  }
}
