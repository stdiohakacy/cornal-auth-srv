@AGENTS.md
@.claude/rules/architecture.md

# cornal-auth-srv

Auth service của hệ thống microservices cornal.

## Stack
- NestJS 12 (ESM), TypeScript strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`)
- Test: Vitest (projects: unit · integration · e2e) · Lint: oxlint (type-aware) · Format: Prettier
- Hạ tầng local: PostgreSQL 17, PgBouncer, Redis 7, NATS JetStream (`docker-compose.yml`)
- Package manager: pnpm (`minimumReleaseAge` 14 ngày trong `pnpm-workspace.yaml`)

## Lệnh
- Hạ tầng: `docker compose up -d --wait` · Dev: `pnpm start:dev` (cổng `PORT`, mặc định 3001)
- Build: `pnpm build` · Lint: `pnpm lint` · Format: `pnpm format`
- Test: `pnpm test` (unit, không cần hạ tầng) · `pnpm test:int` · `pnpm test:e2e` · `pnpm test:all`
- `test:int` / `test:e2e` cần `docker compose up -d --wait`; global setup tự tạo DB `cornal_auth_<project>` và chạy migration
- Migration: `pnpm build && pnpm db:migrate` (`pnpm db:revert` lùi 1 bước); luôn chạy qua `DATABASE_DIRECT_URL`, không qua PgBouncer
- Node 24 (`.nvmrc`); env mẫu ở `.env.example` (`main.ts` tự nạp `.env` nếu có)

## Quy ước
- ESM: import tương đối phải có đuôi `.js`; dùng `import.meta.dirname`, không dùng `__dirname`.
- `APP_ROLE` = `login` | `api` | `worker`; module được ghép theo role trong `AppModule.forRole()`.
- Ghi DB chỉ trong `uow.run()` (`UNIT_OF_WORK`); domain event được ghi vào outbox trong cùng transaction
- Config chỉ đọc qua `APP_CONFIG` (đã parse bằng Zod), không đọc `process.env` trong code.
- Mock bằng `vi.fn()`, không dùng `jest.fn()`.
- Ưu tiên package first-party `@nestjs/*` (xem AGENTS.md) trước khi thêm thư viện ngoài.
- Không dùng `any`; không để code comment-out.
- Kế hoạch triển khai: `docs/superpowers/plans/` (roadmap + plan từng phase).
