/**
 * Tests for NotificationService — local notification scheduling,
 * permission management, unread badge, and notification tap handling.
 *
 * Uses mocked expo-notifications via moduleNameMapper (no real system calls).
 */

import * as Notifications from 'expo-notifications';
import {
  NotificationService,
  type NotificationNavCallback,
} from '../src/api/notifications';

// ─── Setup ──────────────────────────────────────────────

describe('NotificationService', () => {
  let service: NotificationService;
  let mockRemove: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up a tracked remove function for each test
    mockRemove = jest.fn();
    (Notifications.addNotificationResponseReceivedListener as jest.Mock)
      .mockReturnValue({ remove: mockRemove });
    (Notifications.requestPermissionsAsync as jest.Mock)
      .mockResolvedValue({ status: 'granted' });
    (Notifications.scheduleNotificationAsync as jest.Mock)
      .mockResolvedValue('notification-id-1');
    service = new NotificationService();
  });

  afterEach(() => {
    service.dispose();
  });

  // ── Initialization ────────────────────────────────────

  describe('initialize', () => {
    it('requests notification permissions', async () => {
      await service.initialize();
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    });

    it('sets up the notification handler', async () => {
      await service.initialize();
      expect(Notifications.setNotificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          handleNotification: expect.any(Function),
        }),
      );
    });

    it('returns true when permissions are granted', async () => {
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      const result = await service.initialize();
      expect(result).toBe(true);
    });

    it('returns false when permissions are denied', async () => {
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
      });
      const result = await service.initialize();
      expect(result).toBe(false);
    });

    it('registers notification tap listener', async () => {
      await service.initialize();
      expect(
        Notifications.addNotificationResponseReceivedListener,
      ).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ── Scheduling Local Notifications ────────────────────

  describe('showMessageNotification', () => {
    it('schedules a local notification with message preview', async () => {
      await service.initialize();
      await service.showMessageNotification('Hello from Copilot', 1);

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: 'AgentDeck',
          body: 'Hello from Copilot',
          data: { screen: 'Chat' },
          badge: 1,
        },
        trigger: null, // immediate
      });
    });

    it('truncates long messages to 100 characters', async () => {
      await service.initialize();
      const longMsg = 'A'.repeat(200);
      await service.showMessageNotification(longMsg, 1);

      const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
      expect(call.content.body.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(call.content.body).toMatch(/\.\.\.$/);
    });

    it('does not schedule if not initialized', async () => {
      await service.showMessageNotification('test', 1);
      expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('shows summary notification for multiple unread messages', async () => {
      await service.initialize();
      await service.showUnreadSummary(5);

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: 'AgentDeck',
          body: '5 unread messages',
          data: { screen: 'Chat' },
          badge: 5,
        },
        trigger: null,
      });
    });
  });

  // ── Badge Management ──────────────────────────────────

  describe('badge management', () => {
    it('sets the app badge count', async () => {
      await service.initialize();
      await service.setBadge(3);
      expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3);
    });

    it('clears the badge when count is 0', async () => {
      await service.initialize();
      await service.clearBadge();
      expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(0);
    });

    it('dismisses all notifications on clearBadge', async () => {
      await service.initialize();
      await service.clearBadge();
      expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled();
    });
  });

  // ── Notification Tap Navigation ───────────────────────

  describe('notification tap', () => {
    it('calls onNavigate callback with screen name from notification data', async () => {
      const onNavigate: NotificationNavCallback = jest.fn();
      service.onNavigate = onNavigate;
      await service.initialize();

      // Simulate notification tap by calling the registered listener
      const listener = (
        Notifications.addNotificationResponseReceivedListener as jest.Mock
      ).mock.calls[0][0];

      listener({
        notification: {
          request: {
            content: {
              data: { screen: 'Chat' },
            },
          },
        },
      });

      expect(onNavigate).toHaveBeenCalledWith('Chat');
    });

    it('does not crash if onNavigate is not set', async () => {
      await service.initialize();

      const listener = (
        Notifications.addNotificationResponseReceivedListener as jest.Mock
      ).mock.calls[0][0];

      // Should not throw
      expect(() => {
        listener({
          notification: {
            request: {
              content: {
                data: { screen: 'Chat' },
              },
            },
          },
        });
      }).not.toThrow();
    });

    it('does nothing if notification has no screen data', async () => {
      const onNavigate: NotificationNavCallback = jest.fn();
      service.onNavigate = onNavigate;
      await service.initialize();

      const listener = (
        Notifications.addNotificationResponseReceivedListener as jest.Mock
      ).mock.calls[0][0];

      listener({
        notification: {
          request: {
            content: {
              data: {},
            },
          },
        },
      });

      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  // ── Dispose ───────────────────────────────────────────

  describe('dispose', () => {
    it('removes notification listeners on dispose', async () => {
      await service.initialize();
      service.dispose();
      expect(mockRemove).toHaveBeenCalled();
    });
  });
});
