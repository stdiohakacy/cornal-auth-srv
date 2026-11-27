import {
  decodePermissionBits,
  encodePermissionBits,
  hasPermission,
  type PermissionCatalog,
} from './permission-bits.js';

describe('permission bits', () => {
  const catalog: PermissionCatalog = {
    version: 1,
    bitByCode: new Map(
      Array.from({ length: 500 }, (_, i) => [`svc:perm_${i}`, i] as const),
    ),
  };

  it('round-trips and stays compact for 500 permissions', () => {
    const granted = Array.from(
      { length: 500 },
      (_, i) => `svc:perm_${i}`,
    ).filter((_, i) => i % 3 === 0);
    const pbits = encodePermissionBits(catalog, granted);
    expect(pbits.length).toBeLessThanOrEqual(84);
    const bits = decodePermissionBits(pbits);
    expect(hasPermission(catalog, bits, 'svc:perm_0')).toBe(true);
    expect(hasPermission(catalog, bits, 'svc:perm_1')).toBe(false);
    expect(hasPermission(catalog, bits, 'svc:perm_498')).toBe(true);
  });

  it('unknown code → false; empty grant → empty string', () => {
    const bits = decodePermissionBits(
      encodePermissionBits(catalog, ['svc:perm_3']),
    );

    expect(hasPermission(catalog, bits, 'svc:unknown')).toBe(false);
    expect(encodePermissionBits(catalog, [])).toBe('');
  });
});
