/**
 * Polyfill crypto.getRandomValues for React Native / Hermes.
 * tweetnacl checks self.crypto || window.crypto — neither exists in RN.
 * This MUST be imported before tweetnacl.
 */
import { getRandomValues } from 'expo-crypto';

if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {} as Crypto;
}

if (!globalThis.crypto.getRandomValues) {
  (globalThis.crypto as any).getRandomValues = getRandomValues;
}
