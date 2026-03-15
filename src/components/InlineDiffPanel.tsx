/**
 * Inline Diff Panel — collapsible git diff viewer for the Chat screen.
 * Shows changed files with per-file expandable diffs and approve/reject.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore, GitChange } from '../store/AppStore';
import { Colors, Spacing, FontSize, BorderRadius, ThemeColors } from '../theme';
import { parseDiffIntoHunks, ParsedDiff } from '../utils/diffParser';

interface ChangesData {
  files: GitChange[];
  summary: {
    modified: number;
    added: number;
    deleted: number;
    totalAdded: number;
    totalRemoved: number;
  };
}

const STATUS_COLORS: Record<string, (c: ThemeColors) => string> = {
  modified: (c) => c.warning,
  added: (c) => c.success,
  deleted: (c) => c.error,
  renamed: (c) => c.info,
  untracked: (c) => c.textMuted,
};

const STATUS_LABELS: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function InlineDiffPanel({ visible, onClose }: Props) {
  const { loadChanges, restoreFiles, revertHunks, connectionStatus, theme } = useAppStore();
  const colors = Colors[theme];

  const [data, setData] = useState<ChangesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<Set<string>>(new Set());

  const isAuthenticated = connectionStatus === 'authenticated';

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const result = await loadChanges();
      setData(result);
      setRejectedFiles(new Set());
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [isAuthenticated, loadChanges]);

  useEffect(() => {
    if (visible && isAuthenticated) refresh();
  }, [visible, isAuthenticated]);

  const toggleFileRejected = useCallback((path: string) => {
    setRejectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleRevertFile = useCallback(async (path: string) => {
    Alert.alert('Revert File', `Discard all changes in ${path.split('/').pop()}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revert',
        style: 'destructive',
        onPress: async () => {
          try {
            await restoreFiles([path]);
            refresh();
          } catch (err: any) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  }, [restoreFiles, refresh]);

  if (!visible) return null;

  const files = data?.files ?? [];
  const summary = data?.summary;

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="git-compare-outline" size={16} color={colors.primary} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Changes
            {summary ? ` (${files.length})` : ''}
          </Text>
          {summary && (
            <Text style={[styles.headerStats, { color: colors.textMuted }]}>
              +{summary.totalAdded} -{summary.totalRemoved}
            </Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={refresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-down-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={true}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading diffs...</Text>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No changes found</Text>
          </View>
        ) : (
          files.map((file) => {
            const isExpanded = expandedFile === file.path;
            const isRejected = rejectedFiles.has(file.path);
            const statusColor = (STATUS_COLORS[file.status] ?? (() => colors.textMuted))(colors);
            const fileName = file.path.split('/').pop() ?? file.path;
            const dirPath = file.path.includes('/')
              ? file.path.substring(0, file.path.lastIndexOf('/'))
              : '';
            const parsed = file.diff ? parseDiffIntoHunks(file.diff) : null;

            return (
              <View key={file.path} style={[styles.fileItem, { borderBottomColor: colors.border }]}>
                {/* File row */}
                <TouchableOpacity
                  style={styles.fileRow}
                  onPress={() => setExpandedFile(isExpanded ? null : file.path)}
                >
                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
                    <Text style={[styles.statusText, { color: statusColor }]}>
                      {STATUS_LABELS[file.status] ?? '?'}
                    </Text>
                  </View>
                  <View style={styles.fileNameCol}>
                    <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>
                      {fileName}
                    </Text>
                    {dirPath ? (
                      <Text style={[styles.dirPath, { color: colors.textMuted }]} numberOfLines={1}>
                        {dirPath}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.fileActions}>
                    <TouchableOpacity
                      style={[
                        styles.approveBtn,
                        { backgroundColor: isRejected ? colors.error + '22' : colors.success + '22' },
                      ]}
                      onPress={() => toggleFileRejected(file.path)}
                    >
                      <Ionicons
                        name={isRejected ? 'close-outline' : 'checkmark-outline'}
                        size={14}
                        color={isRejected ? colors.error : colors.success}
                      />
                      <Text style={{ color: isRejected ? colors.error : colors.success, fontSize: FontSize.xs }}>
                        {isRejected ? 'Reject' : 'Approve'}
                      </Text>
                    </TouchableOpacity>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </View>
                </TouchableOpacity>

                {/* Expanded diff */}
                {isExpanded && file.diff && parsed && (
                  <View style={[styles.diffBlock, { backgroundColor: colors.codeBg }]}>
                    {parsed.hunks.map((hunk) => (
                      <View key={hunk.index}>
                        <Text style={[styles.hunkHeader, { color: colors.info, backgroundColor: colors.diffHunk }]}>
                          {hunk.header}
                        </Text>
                        {hunk.lines.map((line, li) => {
                          const isAdd = line.startsWith('+');
                          const isDel = line.startsWith('-');
                          return (
                            <Text
                              key={`${hunk.index}-${li}`}
                              style={[
                                styles.diffLine,
                                {
                                  color: isAdd ? colors.diffAddedText
                                    : isDel ? colors.diffRemovedText
                                    : colors.codeText,
                                  backgroundColor: isAdd ? colors.diffAdded
                                    : isDel ? colors.diffRemoved
                                    : 'transparent',
                                },
                              ]}
                            >
                              {line}
                            </Text>
                          );
                        })}
                      </View>
                    ))}
                    <TouchableOpacity
                      style={[styles.revertBtn, { borderColor: colors.error + '44' }]}
                      onPress={() => handleRevertFile(file.path)}
                    >
                      <Ionicons name="arrow-undo-outline" size={14} color={colors.error} />
                      <Text style={{ color: colors.error, fontSize: FontSize.xs }}>Revert File</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    maxHeight: '45%',
    borderTopWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerTitle: {
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  headerStats: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  scrollArea: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  loadingText: { fontSize: FontSize.sm },
  emptyText: { fontSize: FontSize.sm },
  fileItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  statusBadge: {
    width: 22,
    height: 22,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fileNameCol: {
    flex: 1,
  },
  fileName: {
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  dirPath: {
    fontSize: FontSize.xs,
    marginTop: 1,
  },
  fileActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    gap: 3,
  },
  diffBlock: {
    marginHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    overflow: 'hidden',
  },
  hunkHeader: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    marginBottom: 2,
    borderRadius: BorderRadius.sm,
  },
  diffLine: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingHorizontal: Spacing.sm,
    lineHeight: 18,
  },
  revertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: BorderRadius.full,
  },
});
