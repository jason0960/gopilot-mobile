/**
 * Local notification service for AgentDeck.
 *
 * Manages:
 * - Local notification scheduling (message previews, unread summaries)
 * - Badge count management
 * - Notification tap → screen navigation callback
 * - Permission requests
 *
 * Uses `expo-notifications` for all platform-specific notification APIs.
 * This module handles LOCAL notifications only — push notifications are Phase 3.
 *
 * @module gopilot-mobile/api/notifications
 */

import * as Notifications from 'expo-notifications';

// ─── Types ──────────────────────────────────────────────

/** Callback when user taps a notification — receives the target screen name. */
export type NotificationNavCallback = (screen: string) => void;

// ─── Constants ──────────────────────────────────────────

const MAX_BODY_LENGTH = 100;
const NOTIFICATION_TITLE = 'AgentDeck';

// ─── NotificationService ────────────────────────────────

export class NotificationService {
  private initialized = false;
  private tapSubscription: { remove: () => void } | null = null;

  /**
   * Set this callback to handle notification tap → screen navigation.
   * The callback receives the screen name from the notification data.
   */
  public onNavigate: NotificationNavCallback | null = null;

  /**
   * Request permissions and set up notification handlers.
   * Returns `true` if permission was granted.
   */
  async initialize(): Promise<boolean> {
    // Set up handler for foreground notifications
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    // Request permission
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      return false;
    }

    // Listen for notification taps
    this.tapSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const screen = response.notification?.request?.content?.data?.screen;
        if (screen && this.onNavigate) {
          this.onNavigate(screen as string);
        }
      },
    );

    this.initialized = true;
    return true;
  }

  /**
   * Show a local notification with a message preview.
   * @param message — the assistant message text (truncated to 100 chars)
   * @param unreadCount — current unread count (shown as badge)
   */
  async showMessageNotification(message: string, unreadCount: number): Promise<void> {
    if (!this.initialized) return;

    const body =
      message.length > MAX_BODY_LENGTH
        ? message.slice(0, MAX_BODY_LENGTH) + '...'
        : message;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: NOTIFICATION_TITLE,
        body,
        data: { screen: 'Chat' },
        badge: unreadCount,
      },
      trigger: null, // immediate
    });
  }

  /**
   * Show a summary notification for multiple unread messages.
   * @param count — number of unread messages
   */
  async showUnreadSummary(count: number): Promise<void> {
    if (!this.initialized) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: NOTIFICATION_TITLE,
        body: `${count} unread messages`,
        data: { screen: 'Chat' },
        badge: count,
      },
      trigger: null,
    });
  }

  /**
   * Set the app badge count.
   */
  async setBadge(count: number): Promise<void> {
    if (!this.initialized) return;
    await Notifications.setBadgeCountAsync(count);
  }

  /**
   * Clear the app badge and dismiss all notifications.
   */
  async clearBadge(): Promise<void> {
    if (!this.initialized) return;
    await Notifications.setBadgeCountAsync(0);
    await Notifications.dismissAllNotificationsAsync();
  }

  /**
   * Clean up listeners.
   */
  dispose(): void {
    this.tapSubscription?.remove();
    this.tapSubscription = null;
    this.initialized = false;
  }
}
