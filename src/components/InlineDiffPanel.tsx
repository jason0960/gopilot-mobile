/**
 * Inline Diff Panel — collapsible git diff viewer for the Chat screen.
 * Two-view UX: file list (like `git status`) → tap file → full diff (like `git diff -- file`).
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
import { Colors, Spacing, FontSize, BorderRadius } from '../theme';
import { parseDiffIntoHunks } from '../utils/diffParser';

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

const STATUS_LABELS: Record<string, string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U',
};

function countDiffLines(diff: string): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 };
  let added = 0, removed = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++')) added++;
    else if (l.startsWith('-') && !l.startsWith('---')) removed++;
  }
  return { added, removed };
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Wrapper that conditionally mounts/unmounts the inner panel.
 * Has ZERO hooks — prevents React hook ordering errors during Fast Refresh.
 */
export default function InlineDiffPanel({ visible, onClose }: Props) {
  if (!visible) return null;
  return <InlineDiffPanelInner onClose={onClose} />;
}

function InlineDiffPanelInner({ onClose }: { onClose: () => void }) {
  const { loadChanges, restoreFiles, connectionStatus, theme } = useAppStore();
  const colors = Colors[theme];

  const [data, setData] = useState<ChangesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // null = file list view, string = viewing that file's diff
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const isAuthenticated = connectionStatus === 'authenticated';

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const result = await loadChanges();
      if (result && result.files) {
        setData(result);
      } else {
        setData(null);
        setErrorMsg('No response from extension');
      }
    } catch (err: any) {
      setData(null);
      setErrorMsg(err?.message || 'Failed to load changes');
    }
    setLoading(false);
  }, [isAuthenticated, loadChanges]);

  useEffect(() => {
    if (isAuthenticated) {
      setSelectedFile(null);
      refresh();
    }
  }, [isAuthenticated]);

  const handleRevertFile = useCallback((filePath: string) => {
    const name = filePath.split('/').pop() ?? filePath;
    Alert.alert('Revert File', `Discard all changes in ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revert',
        style: 'destructive',
        onPress: async () => {
          try {
            await restoreFiles([filePath]);
            setSelectedFile(null);
            refresh();
          } catch (err: any) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  }, [restoreFiles, refresh]);

  const handleRevertAll = useCallback(() => {
    const currentFiles = data?.files ?? [];
    if (!currentFiles.length) return;
    Alert.alert('Revert All', `Discard changes to all ${currentFiles.length} files?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revert All',
        style: 'destructive',
        onPress: async () => {
          try {
            await restoreFiles(currentFiles.map((f) => f.path));
            refresh();
          } catch (err: any) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  }, [data, restoreFiles, refresh]);

  const files = data?.files ?? [];
  const summary = data?.summary;
  const activeFile = selectedFile ? files.find((f) => f.path === selectedFile) : null;

  // ─── Single File Diff View ────────────────────────────
  if (activeFile) {
    const parsed = activeFile.diff ? parseDiffIntoHunks(activeFile.diff) : null;
    const counts = countDiffLines(activeFile.diff ?? '');
    const statusColor = activeFile.status === 'added' ? colors.success
      : activeFile.status === 'deleted' ? colors.error
      : colors.warning;
    const fileIdx = files.indexOf(activeFile);
    const hasPrev = fileIdx > 0;
    const hasNext = fileIdx < files.length - 1;

    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {/* File header with back button */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setSelectedFile(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={18} color={colors.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {activeFile.path.split('/').pop()}
            </Text>
            <View style={styles.fileMetaRow}>
              <Text style={[styles.statusLabel, { color: statusColor }]}>
                {STATUS_LABELS[activeFile.status] ?? '?'}
              </Text>
              <Text style={[styles.statAdd, { color: colors.success }]}>+{counts.added}</Text>
              <Text style={[styles.statDel, { color: colors.error }]}>-{counts.removed}</Text>
              <Text style={[styles.fileCounter, { color: colors.textMuted }]}>
                {fileIdx + 1}/{files.length}
              </Text>
            </View>
          </View>
          {/* Prev / Next arrows */}
          <TouchableOpacity
            onPress={() => hasPrev && setSelectedFile(files[fileIdx - 1].path)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={!hasPrev}
          >
            <Ionicons name="chevron-back" size={20} color={hasPrev ? colors.textSecondary : colors.textMuted + '44'} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => hasNext && setSelectedFile(files[fileIdx + 1].path)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={!hasNext}
          >
            <Ionicons name="chevron-forward" size={20} color={hasNext ? colors.textSecondary : colors.textMuted + '44'} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleRevertFile(activeFile.path)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-undo-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>

        {/* Dir path */}
        {activeFile.path.includes('/') && (
          <View style={[styles.dirBar, { backgroundColor: colors.codeBg }]}>
            <Text style={[styles.dirBarText, { color: colors.textMuted }]} numberOfLines={1}>
              {activeFile.path.substring(0, activeFile.path.lastIndexOf('/'))}
            </Text>
          </View>
        )}

        {/* File diff content */}
        <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator>
          {parsed && parsed.hunks.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.diffContent}>
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
                              color: isAdd ? colors.diffAddedText : isDel ? colors.diffRemovedText : colors.codeText,
                              backgroundColor: isAdd ? colors.diffAdded : isDel ? colors.diffRemoved : 'transparent',
                            },
                          ]}
                        >
                          {line}
                        </Text>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          ) : (
            <View style={styles.center}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No diff content available</Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ─── File List View (git status) ──────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="git-compare-outline" size={16} color={colors.primary} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            Changes{summary ? ` (${files.length})` : ''}
          </Text>
          {summary && (
            <Text style={[styles.headerStats, { color: colors.textMuted }]}>
              +{summary.totalAdded} -{summary.totalRemoved}
            </Text>
          )}
        </View>
        <View style={styles.headerRight}>
          {files.length > 0 && (
            <TouchableOpacity onPress={handleRevertAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: colors.error, fontSize: FontSize.xs, fontWeight: '600' }}>Revert All</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={refresh} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-down-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* File list */}
      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading...</Text>
          </View>
        ) : errorMsg ? (
          <View style={styles.center}>
            <Ionicons name="warning-outline" size={24} color={colors.warning} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>{errorMsg}</Text>
            <TouchableOpacity onPress={refresh}>
              <Text style={{ color: colors.primary, fontSize: FontSize.sm, marginTop: Spacing.sm }}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : files.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="checkmark-circle-outline" size={24} color={colors.success} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>Working tree clean</Text>
          </View>
        ) : (
          <>
            {files.map((file) => {
              const counts = countDiffLines(file.diff ?? '');
              const statusColor = file.status === 'added' ? colors.success
                : file.status === 'deleted' ? colors.error
                : colors.warning;
              const fileName = file.path.split('/').pop() ?? file.path;
              const dirPath = file.path.includes('/')
                ? file.path.substring(0, file.path.lastIndexOf('/'))
                : '';

              return (
                <TouchableOpacity
                  key={file.path}
                  style={[styles.fileRow, { borderBottomColor: colors.border }]}
                  onPress={() => setSelectedFile(file.path)}
                  activeOpacity={0.6}
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
                  <Text style={[styles.statAdd, { color: colors.success }]}>+{counts.added}</Text>
                  <Text style={[styles.statDel, { color: colors.error }]}>-{counts.removed}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}

            {/* git diff --stat footer */}
            {summary && (
              <View style={[styles.statFooter, { borderTopColor: colors.border }]}>
                <Text style={[styles.statFooterText, { color: colors.textMuted }]}>
                  {files.length} file{files.length !== 1 ? 's' : ''} changed
                  {summary.totalAdded > 0 ? `, ${summary.totalAdded} insertion${summary.totalAdded !== 1 ? 's' : ''}(+)` : ''}
                  {summary.totalRemoved > 0 ? `, ${summary.totalRemoved} deletion${summary.totalRemoved !== 1 ? 's' : ''}(-)` : ''}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    gap: Spacing.xs,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
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
  backBtn: {
    marginRight: Spacing.sm,
    padding: 4,
  },
  fileMetaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    marginTop: 2,
  },
  statusLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fileCounter: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dirBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
  },
  dirBarText: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  scrollArea: {
    maxHeight: 260,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  loadingText: { fontSize: FontSize.sm },
  emptyText: { fontSize: FontSize.sm, textAlign: 'center' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusBadge: {
    width: 24,
    height: 24,
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
  statAdd: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statDel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  diffContent: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  hunkHeader: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    marginBottom: 2,
    borderRadius: BorderRadius.sm,
  },
  diffLine: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingHorizontal: Spacing.sm,
    lineHeight: 18,
    minWidth: '100%',
  },
  statFooter: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  statFooterText: {
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
