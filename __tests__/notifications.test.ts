/**
 * Tests for NotificationService — NO-OP STUB version.
 *
 * The `expo-notifications` native module was temporarily removed to fix
 * provisioning profile issues. This tests the stub API surface to ensure
 * consumers (AppStore, chatSlice) can call all methods without errors.
 */

import {
  NotificationService,
  type NotificationNavCallback,
} from '../src/api/notifications';

// ─── Setup ──────────────────────────────────────────────

describe('NotificationService (stub)', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService();
  });

  afterEach(() => {
    service.dispose();
  });

  // ── Initialization ────────────────────────────────────

  describe('initialize', () => {
    it('returns false (no native module)', async () => {
      const result = await service.initialize();
      expect(result).toBe(false);
    });
  });

  // ── Stub Methods (no-op, no throws) ───────────────────

  describe('stub methods do not throw', () => {
    it('showMessageNotification is a no-op', async () => {
      await service.initialize();
      await expect(
        service.showMessageNotification('Hello', 1),
      ).resolves.toBeUndefined();
    });

    it('showUnreadSummary is a no-op', async () => {
      await service.initialize();
      await expect(service.showUnreadSummary(5)).resolves.toBeUndefined();
    });

    it('setBadge is a no-op', async () => {
      await service.initialize();
      await expect(service.setBadge(3)).resolves.toBeUndefined();
    });

    it('clearBadge is a no-op', async () => {
      await service.initialize();
      await expect(service.clearBadge()).resolves.toBeUndefined();
    });
  });

  // ── onNavigate callback ───────────────────────────────

  describe('onNavigate', () => {
    it('can be set without error', () => {
      const cb: NotificationNavCallback = jest.fn();
      service.onNavigate = cb;
      expect(service.onNavigate).toBe(cb);
    });
  });

  // ── Dispose ───────────────────────────────────────────

  describe('dispose', () => {
    it('does not throw', () => {
      service.dispose();
    });
  });
});
