/**
 * Compact permission claim. The catalog maps `code → bit index`; indices are append-only and never
 * reused, so a token minted with catalog v7 stays readable by a service that knows catalog v9.
 * 500 permissions = 63 bytes = 84 base64url chars, versus kilobytes for a JSON list of codes.
 */
export type PermissionCatalog = {
  readonly version: number;
  readonly bitByCode: ReadonlyMap<string, number>;
};

export function encodePermissionBits(
  catalog: PermissionCatalog,
  granted: Iterable<string>,
): string {
  const indices: number[] = [];
  for (const code of granted) {
    const bit = catalog.bitByCode.get(code);
    if (bit !== undefined) indices.push(bit);
  }
  const bytes = new Uint8Array(
    indices.length === 0 ? 0 : (Math.max(...indices) >> 3) + 1,
  );
  for (const bit of indices) {
    const byteIndex = bit >> 3;
    bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (bit & 7));
  }
  return Buffer.from(bytes).toString('base64url');
}

/** Pre-decode once per request, then each check is O(1) with no allocation. */
export function decodePermissionBits(pbits: string): Uint8Array {
  return new Uint8Array(Buffer.from(pbits, 'base64url'));
}

export function hasPermission(
  catalog: PermissionCatalog,
  bits: Uint8Array,
  code: string,
): boolean {
  const bit = catalog.bitByCode.get(code);
  if (bit === undefined) return false; // unknown code: deny (fail closed)
  const byte = bits[bit >> 3];
  return byte !== undefined && (byte & (1 << (bit & 7))) !== 0;
}
