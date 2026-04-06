/**
 * Local notification service for AgentDeck — NO-OP STUB.
 *
 * The `expo-notifications` native module was temporarily removed because
 * the EAS-cached provisioning profile doesn't include the Push Notifications
 * capability. This stub preserves the full API surface so all consumers
 * (AppStore, chatSlice) continue to compile and run without changes.
 *
 * To restore real notifications:
 *   1. `npx expo install expo-notifications`
 *   2. Run `eas credentials -p ios` interactively to regenerate the
 *      provisioning profile with Push Notifications enabled
 *   3. Replace this stub with the real implementation
 *
 * @module gopilot-mobile/api/notifications
 */

// ─── Types ──────────────────────────────────────────────

/** Callback when user taps a notification — receives the target screen name. */
export type NotificationNavCallback = (screen: string) => void;

// ─── NotificationService (no-op stub) ───────────────────

export class NotificationService {
  private initialized = false;

  /**
   * Set this callback to handle notification tap → screen navigation.
   * The callback receives the screen name from the notification data.
   */
  public onNavigate: NotificationNavCallback | null = null;

  /**
   * No-op — always returns false (no native module available).
   */
  async initialize(): Promise<boolean> {
    this.initialized = true;
    return false;
  }

  /** No-op stub. */
  async showMessageNotification(_message: string, _unreadCount: number): Promise<void> {
    // Stub — expo-notifications removed temporarily
  }

  /** No-op stub. */
  async showUnreadSummary(_count: number): Promise<void> {
    // Stub — expo-notifications removed temporarily
  }

  /** No-op stub. */
  async setBadge(_count: number): Promise<void> {
    // Stub — expo-notifications removed temporarily
  }

  /** No-op stub. */
  async clearBadge(): Promise<void> {
    // Stub — expo-notifications removed temporarily
  }

  /** No-op stub. */
  dispose(): void {
    this.initialized = false;
  }
}
