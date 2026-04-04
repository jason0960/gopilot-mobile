/**
 * Mock for expo-notifications — used by notification tests.
 */

export const setNotificationHandler = jest.fn();
export const getPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const requestPermissionsAsync = jest.fn().mockResolvedValue({ status: 'granted' });
export const scheduleNotificationAsync = jest.fn().mockResolvedValue('notification-id-1');
export const dismissAllNotificationsAsync = jest.fn().mockResolvedValue(undefined);
export const setBadgeCountAsync = jest.fn().mockResolvedValue(true);
export const getBadgeCountAsync = jest.fn().mockResolvedValue(0);
export const addNotificationResponseReceivedListener = jest.fn().mockReturnValue({ remove: jest.fn() });
export const addNotificationReceivedListener = jest.fn().mockReturnValue({ remove: jest.fn() });

export const AndroidImportance = {
  MAX: 5,
  HIGH: 4,
  DEFAULT: 3,
  LOW: 2,
  MIN: 1,
};

export const setNotificationChannelAsync = jest.fn().mockResolvedValue(undefined);

export default {
  setNotificationHandler,
  getPermissionsAsync,
  requestPermissionsAsync,
  scheduleNotificationAsync,
  dismissAllNotificationsAsync,
  setBadgeCountAsync,
  getBadgeCountAsync,
  addNotificationResponseReceivedListener,
  addNotificationReceivedListener,
  AndroidImportance,
  setNotificationChannelAsync,
};
