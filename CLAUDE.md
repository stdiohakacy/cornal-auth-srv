@AGENTS.md

# cornal-auth-srv

Auth service của hệ thống microservices cornal.

## Stack
- NestJS 12 (ESM), TypeScript strict
- Test: Vitest · Lint: oxlint (type-aware) · Format: Prettier
- Package manager: pnpm (`minimumReleaseAge` 14 ngày trong `pnpm-workspace.yaml`)

## Lệnh
- Dev: `pnpm start:dev` (cổng `PORT`, mặc định 3001)
- Build: `pnpm build` · Lint: `pnpm lint` · Test: `pnpm test` · E2E: `pnpm test:e2e` · Format: `pnpm format`
- Node 24 (`.nvmrc`); env mẫu ở `.env.example`

## Quy ước
- ESM: import tương đối phải có đuôi `.js`; dùng `import.meta.dirname`, không dùng `__dirname`.
- Mock bằng `vi.fn()`, không dùng `jest.fn()`.
- Ưu tiên package first-party `@nestjs/*` (xem AGENTS.md) trước khi thêm thư viện ngoài.
- Không dùng `any`; không để code comment-out.
