/**
 * Branch Modal — view and switch git branches.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/AppStore';
import { Colors, Spacing, FontSize, BorderRadius } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

function parseBranches(output: string): BranchInfo[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.includes('HEAD detached') && !l.includes('->'))
    .map((l) => {
      const isCurrent = l.startsWith('* ');
      const raw = l.replace(/^\*?\s*/, '');
      const isRemote = raw.startsWith('remotes/');
      const name = isRemote ? raw.replace('remotes/', '') : raw;
      return { name, isCurrent, isRemote };
    });
}

export default function BranchModal({ visible, onClose }: Props) {
  const { runTerminalCommand, loadWorkspaceInfo, workspace, connectionStatus, theme } = useAppStore();
  const colors = Colors[theme];

  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  const isAuthenticated = connectionStatus === 'authenticated';

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const result = await runTerminalCommand('git branch -a');
      setBranches(parseBranches(result.output));
    } catch {
      setBranches([]);
    }
    setLoading(false);
  }, [isAuthenticated, runTerminalCommand]);

  useEffect(() => {
    if (visible && isAuthenticated) refresh();
  }, [visible, isAuthenticated]);

  const handleCheckout = useCallback(async (branch: BranchInfo) => {
    if (branch.isCurrent) return;

    const checkoutName = branch.isRemote
      ? branch.name.replace(/^origin\//, '')
      : branch.name;

    setSwitching(checkoutName);
    try {
      const result = await runTerminalCommand(`git checkout ${checkoutName}`);
      if (result.exitCode && result.exitCode !== 0) {
        Alert.alert('Checkout Failed', result.output);
      } else {
        await loadWorkspaceInfo();
        await refresh();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message);
    }
    setSwitching(null);
  }, [runTerminalCommand, loadWorkspaceInfo, refresh]);

  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: colors.surface }]}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.headerLeft}>
              <Ionicons name="git-branch-outline" size={18} color={colors.primary} />
              <Text style={[styles.headerTitle, { color: colors.text }]}>Branches</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close-outline" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Current branch */}
          {workspace?.gitBranch && (
            <View style={[styles.currentBranch, { backgroundColor: colors.primary + '15' }]}>
              <Ionicons name="radio-button-on" size={12} color={colors.primary} />
              <Text style={[styles.currentBranchText, { color: colors.primary }]}>
                {workspace.gitBranch}
              </Text>
            </View>
          )}

          {/* Branch list */}
          <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <>
                {localBranches.length > 0 && (
                  <View>
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Local</Text>
                    {localBranches.map((b) => (
                      <TouchableOpacity
                        key={b.name}
                        style={[
                          styles.branchRow,
                          { borderBottomColor: colors.border },
                          b.isCurrent && { backgroundColor: colors.primary + '11' },
                        ]}
                        onPress={() => handleCheckout(b)}
                        disabled={b.isCurrent || switching !== null}
                      >
                        <Ionicons
                          name={b.isCurrent ? 'radio-button-on' : 'radio-button-off'}
                          size={16}
                          color={b.isCurrent ? colors.primary : colors.textMuted}
                        />
                        <Text
                          style={[
                            styles.branchName,
                            { color: b.isCurrent ? colors.primary : colors.text },
                            b.isCurrent && { fontWeight: '600' },
                          ]}
                          numberOfLines={1}
                        >
                          {b.name}
                        </Text>
                        {switching === b.name && (
                          <ActivityIndicator size="small" color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {remoteBranches.length > 0 && (
                  <View>
                    <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Remote</Text>
                    {remoteBranches.map((b) => (
                      <TouchableOpacity
                        key={b.name}
                        style={[styles.branchRow, { borderBottomColor: colors.border }]}
                        onPress={() => handleCheckout(b)}
                        disabled={switching !== null}
                      >
                        <Ionicons name="cloud-outline" size={14} color={colors.textMuted} />
                        <Text
                          style={[styles.branchName, { color: colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {b.name}
                        </Text>
                        {switching === b.name.replace(/^origin\//, '') && (
                          <ActivityIndicator size="small" color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {localBranches.length === 0 && remoteBranches.length === 0 && (
                  <View style={styles.center}>
                    <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
                      No branches found
                    </Text>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    maxHeight: '70%',
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
  },
  currentBranch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  currentBranchText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  scrollArea: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  branchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  branchName: {
    flex: 1,
    fontSize: FontSize.md,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
  },
});
