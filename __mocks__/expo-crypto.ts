/**
 * Jest mock for expo-crypto.
 * In tests, crypto.getRandomValues is already available via Node.js.
 */
import * as nodeCrypto from 'crypto';

export function getRandomValues(array: Uint8Array): Uint8Array {
  const bytes = nodeCrypto.randomBytes(array.length);
  array.set(bytes);
  return array;
}
