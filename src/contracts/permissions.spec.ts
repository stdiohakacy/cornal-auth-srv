import {
  PERMISSION_CATALOG_VERSION,
  PERMISSIONS,
  permissionCatalog,
  SYSTEM_ROLES,
} from './permissions.js';

/**
 * Append-only lock: every code→bit pair ever shipped. Tokens in flight and other services decode
 * bits with this mapping, so an existing pair must never change. Adding a permission = append a
 * new pair here AND in PERMISSIONS, and bump PERMISSION_CATALOG_VERSION.
 */
const SHIPPED: ReadonlyArray<readonly [string, number]> = [
  ['org:read', 0],
  ['org:manage', 1],
  ['member:read', 2],
  ['member:invite', 3],
  ['member:manage', 4],
  ['role:read', 5],
  ['role:manage', 6],
  ['audit:read', 7],
];

describe('permission catalog', () => {
  it('codes and bits are unique and well-formed', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    const bits = PERMISSIONS.map((p) => p.bit);

    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(bits).size).toBe(bits.length);
    for (const { code, bit } of PERMISSIONS) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/);
      expect(Number.isInteger(bit) && bit >= 0 && bit < 2000).toBe(true);
    }
  });

  it('existing code→bit pairs never change (lock)', () => {
    const current = new Map<string, number>(
      PERMISSIONS.map((p) => [p.code, p.bit]),
    );

    for (const [code, bit] of SHIPPED) expect(current.get(code)).toBe(bit);
    expect(PERMISSIONS.length).toBe(SHIPPED.length); // a new permission must be locked here too
    expect(PERMISSION_CATALOG_VERSION).toBe(1);
  });

  it('system roles only reference catalog codes; owner has all', () => {
    const codes = new Set(PERMISSIONS.map((p) => p.code));

    for (const permissions of Object.values(SYSTEM_ROLES)) {
      for (const code of permissions) expect(codes.has(code)).toBe(true);
    }
    expect([...SYSTEM_ROLES.owner].sort()).toEqual([...codes].sort());
    expect(SYSTEM_ROLES.admin).not.toContain('org:manage');
    expect([...SYSTEM_ROLES.member].sort()).toEqual([
      'member:read',
      'org:read',
      'role:read',
    ]);
  });

  it('exposes a lookup catalog for pbits encoding', () => {
    const catalog = permissionCatalog();

    expect(catalog.version).toBe(PERMISSION_CATALOG_VERSION);
    expect(catalog.bitByCode.get('member:manage')).toBe(4);
  });
});
