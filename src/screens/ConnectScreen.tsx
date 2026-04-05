/**
 * Connect Screen — QR code scanner, relay room code, and direct URL input.
 * Primary pairing UX for Mobile Copilot.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/AppStore';
import { Colors, Spacing, FontSize, BorderRadius } from '../theme';
import type { PubSubPairingInfo } from '../api/pubsub';

type ConnectMode = 'scan' | 'code';

export default function ConnectScreen() {
  const {
    connectionStatus,
    connectionError,
    theme,
    connectDirect,
    connectRelayWithCode,
    connectPubSub,
    disconnect,
  } = useAppStore();

  const colors = Colors[theme];

  const [mode, setMode] = useState<ConnectMode>('code');
  const [roomCode, setRoomCode] = useState('');
  const [scanned, setScanned] = useState(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const isConnecting = connectionStatus === 'connecting' || connectionStatus === 'connected';

  // ─── QR Code Handler ──────────────────────────────────

  const handleQrScanned = ({ data }: { data: string }) => {
    if (scanned || isConnecting) return;
    setScanned(true);

    try {
      // Try parsing as JSON first — Pub/Sub pairing QR
      const parsed = JSON.parse(data);
      if (isPubSubPairing(parsed)) {
        connectPubSub(parsed);
        return;
      }
    } catch {
      // Not JSON — fall through to URL/room-code parsing
    }

    try {
      // VS Code extension QR: http(s)://host:port/pair?token=XXXX
      const url = new URL(data);
      const qrToken = url.searchParams.get('token');

      if (qrToken && url.pathname.includes('pair')) {
        const serverOrigin = url.origin;
        connectDirect(serverOrigin, qrToken);
        return;
      }

      Alert.alert('QR Code', `Scanned: ${data}\n\nNot a recognized pairing code.`, [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    } catch {
      // Not a URL — might be a room code
      const cleaned = data.trim().toUpperCase();
      if (/^[A-Z0-9]{4,8}$/.test(cleaned)) {
        setRoomCode(cleaned);
        setMode('code');
        setScanned(false);
        return;
      }

      Alert.alert('QR Code', `Could not parse: ${data}`, [
        { text: 'OK', onPress: () => setScanned(false) },
      ]);
    }
  };

  // ─── Connect Handlers ─────────────────────────────────

  const handleRelayConnect = async () => {
    const code = roomCode.trim().toUpperCase();
    if (!code || code.length < 4) return;

    // Try pairing exchange first — the code might be for a Pub/Sub session
    const relayServerUrl = useAppStore.getState().relayServerUrl;
    const httpUrl = relayServerUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');

    try {
      const res = await fetch(`${httpUrl}/pair/${code}`);
      if (res.ok) {
        const data = await res.json();
        if (isPubSubPairing(data)) {
          // Pub/Sub pairing found — connect via Pub/Sub
          connectPubSub(data);
          return;
        }
      }
    } catch {
      // Pairing lookup failed (network error, etc.) — fall through to relay
    }

    // Fall back to WebSocket relay join
    connectRelayWithCode(code);
  };

  /** Type guard for PubSubPairingInfo payloads. */
  function isPubSubPairing(obj: any): obj is PubSubPairingInfo {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof obj.projectId === 'string' &&
      typeof obj.topicName === 'string' &&
      typeof obj.mobileSubscription === 'string' &&
      typeof obj.userId === 'string' &&
      typeof obj.accessToken === 'string'
    );
  }

  // ─── Camera Permission ────────────────────────────────

  useEffect(() => {
    if (mode === 'scan' && !cameraPermission?.granted) {
      requestCameraPermission();
    }
  }, [mode]);

  // ─── Render ───────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>AgentDeck</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {isConnecting ? 'Connecting...' : 'Connect to VS Code'}
        </Text>
      </View>

      {/* Mode Tabs */}
      <View style={[styles.tabBar, { backgroundColor: colors.surface }]}>
        {([
          { key: 'scan' as const, icon: 'scan-outline' as const, label: 'Scan QR' },
          { key: 'code' as const, icon: 'keypad-outline' as const, label: 'Room Code' },
        ]).map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.tab, mode === m.key && { backgroundColor: colors.primary }]}
            onPress={() => { setMode(m.key); setScanned(false); }}
          >
            <View style={styles.tabContent}>
              <Ionicons
                name={m.icon}
                size={16}
                color={mode === m.key ? '#fff' : colors.textSecondary}
              />
              <Text style={[styles.tabText, { color: mode === m.key ? '#fff' : colors.textSecondary }]}>
                {m.label}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
      >
        {/* ── QR Scanner Tab ──────────────────────────── */}
        {mode === 'scan' && (
          <View style={styles.scanContainer}>
            {cameraPermission?.granted ? (
              <View style={styles.cameraWrapper}>
                <CameraView
                  style={styles.camera}
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={scanned ? undefined : handleQrScanned}
                />
                {/* Viewfinder overlay */}
                <View style={styles.overlay}>
                  <View style={[styles.viewfinder, { borderColor: isConnecting ? colors.connecting : colors.primary }]}>
                    {isConnecting && (
                      <ActivityIndicator size="large" color={colors.primary} style={styles.scannerSpinner} />
                    )}
                  </View>
                </View>
                <Text style={[styles.scanHint, { color: '#fff' }]}>
                  {isConnecting
                    ? 'Connecting...'
                    : scanned
                      ? 'Processing...'
                      : 'Point at the QR code in VS Code'}
                </Text>
                {isConnecting && (
                  <TouchableOpacity
                    style={[styles.rescanBtn, { backgroundColor: colors.error || '#e74c3c' }]}
                    onPress={disconnect}
                  >
                    <Text style={styles.rescanBtnText}>Cancel</Text>
                  </TouchableOpacity>
                )}
                {scanned && !isConnecting && (
                  <TouchableOpacity
                    style={[styles.rescanBtn, { backgroundColor: colors.primary }]}
                    onPress={() => setScanned(false)}
                  >
                    <Text style={styles.rescanBtnText}>Scan Again</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.permissionBox}>
                <Ionicons name="camera-outline" size={48} color={colors.textSecondary} />
                <Text style={[styles.permTitle, { color: colors.text }]}>Camera Access Needed</Text>
                <Text style={[styles.permDesc, { color: colors.textSecondary }]}>
                  Camera is used to scan the QR code shown in VS Code for quick pairing.
                </Text>
                <TouchableOpacity
                  style={[styles.permBtn, { backgroundColor: colors.primary }]}
                  onPress={requestCameraPermission}
                >
                  <Text style={styles.permBtnText}>Allow Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMode('code')}>
                  <Text style={[styles.skipLink, { color: colors.textSecondary }]}>
                    Or enter a room code
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ── Room Code Tab ────────────────────────────── */}
        {mode === 'code' && (
          <ScrollView contentContainerStyle={styles.formScrollCentered} keyboardShouldPersistTaps="handled" bounces={false}>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Enter Room Code</Text>
              <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
                Open VS Code with AgentDeck — the 6-character room code appears automatically. Works with both Relay and Pub/Sub.
              </Text>

              <TextInput
                style={[styles.input, styles.roomCodeInput, {
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border,
                }]}
                placeholder="ABC123"
                placeholderTextColor={colors.textMuted}
                value={roomCode}
                onChangeText={(t) => setRoomCode(t.toUpperCase())}
                autoCapitalize="characters"
                maxLength={8}
                textAlign="center"
                autoCorrect={false}
                autoFocus={false}
                editable={!isConnecting}
              />

              {isConnecting ? (
                <TouchableOpacity
                  style={[styles.connectBtn, { backgroundColor: colors.error || '#e74c3c' }]}
                  onPress={disconnect}
                >
                  <Text style={styles.connectBtnText}>Cancel</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.connectBtn, { backgroundColor: colors.primary }]}
                  onPress={handleRelayConnect}
                  disabled={!roomCode.trim()}
                >
                  <Text style={styles.connectBtnText}>Join Room</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* Error Banner */}
      {connectionError && (
        <View style={[styles.errorBanner, { backgroundColor: colors.error + '22' }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{connectionError}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIEWFINDER_SIZE = Math.min(SCREEN_WIDTH * 0.65, 280);

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    alignItems: 'center',
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.xxl, fontWeight: '700' },
  subtitle: { fontSize: FontSize.md, marginTop: Spacing.xs },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    borderRadius: BorderRadius.lg,
    padding: 3,
    marginBottom: Spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabText: { fontSize: FontSize.sm, fontWeight: '600' },

  content: { flex: 1 },

  // QR Scanner
  scanContainer: { flex: 1 },
  cameraWrapper: { flex: 1, position: 'relative' },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  viewfinder: {
    width: VIEWFINDER_SIZE,
    height: VIEWFINDER_SIZE,
    borderWidth: 3,
    borderRadius: BorderRadius.lg,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerSpinner: { position: 'absolute' },
  scanHint: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    fontSize: FontSize.md,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  rescanBtn: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  rescanBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '600' },

  // Camera Permission
  permissionBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  permTitle: { fontSize: FontSize.lg, fontWeight: '600', marginTop: Spacing.lg, marginBottom: Spacing.sm },
  permDesc: { fontSize: FontSize.md, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.xl },
  permBtn: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  permBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '600' },
  skipLink: { fontSize: FontSize.sm },

  // Forms
  formScrollCentered: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  cardTitle: { fontSize: FontSize.lg, fontWeight: '600', marginBottom: Spacing.xs },
  cardDesc: { fontSize: FontSize.sm, marginBottom: Spacing.lg, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    marginBottom: Spacing.md,
  },
  roomCodeInput: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    letterSpacing: 4,
    paddingVertical: Spacing.lg,
  },
  connectBtn: {
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  connectBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: '600' },

  // Error
  errorBanner: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  errorText: { fontSize: FontSize.sm, textAlign: 'center' },
});
