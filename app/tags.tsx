import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { PromptModal, type PromptRequest } from '@/components/PromptModal';
import { useDb } from '@/db/DbProvider';
import {
  createTag,
  deleteTag,
  FALLBACK_TAG,
  listTags,
  renameTag,
  tagUsageCounts,
  TagError,
  type TagRow,
} from '@/db/tags';
import { colors, radius, sp, type } from '@/theme';

/**
 * Manage the tag vocabulary (blueprint D19).
 *
 * The list is short and personal, so this is deliberately plain: tap to
 * rename, trash to delete. Deleting says how many items will move to
 * “Other” before it happens — §11 forbids losing inventory quietly, and a
 * tag delete is the one action here that touches items.
 */
export default function TagsScreen() {
  const db = useDb();
  const [tick, setTick] = useState(0);
  void tick;
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const refresh = () => setTick((t) => t + 1);

  const tags = listTags(db);
  const counts = tagUsageCounts(db);

  function run(action: () => void) {
    try {
      action();
      refresh();
    } catch (err) {
      Alert.alert(
        'That did not work',
        err instanceof TagError ? err.message : 'Something went wrong changing the tag.',
      );
    }
  }

  function promptAdd() {
    setPrompt({
      title: 'New tag',
      placeholder: 'e.g. Marine',
      submitLabel: 'Add',
      onSubmit: (label) => run(() => createTag(db, label)),
    });
  }

  function promptRename(tag: TagRow) {
    setPrompt({
      title: `Rename “${tag.label}”`,
      initialValue: tag.label,
      onSubmit: (label) => run(() => renameTag(db, tag.slug, label)),
    });
  }

  function confirmDelete(tag: TagRow) {
    const used = counts[tag.slug] ?? 0;
    Alert.alert(
      `Delete “${tag.label}”?`,
      used === 0
        ? 'Nothing is using this tag.'
        : `${used} item${used === 1 ? '' : 's'} will move to “Other”. Nothing is deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => run(() => deleteTag(db, tag.slug)),
        },
      ],
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Tags' }} />
      <FlatList
        data={tags}
        keyExtractor={(tag) => tag.slug}
        contentContainerStyle={{ gap: sp(2), padding: sp(4) }}
        ListHeaderComponent={
          <Text style={styles.note}>
            Tags are yours to change. Recognition is told this list, so adding the ones your
            workshop actually uses makes scans land in the right place. Renaming carries every item
            with it.
          </Text>
        }
        renderItem={({ item: tag }) => {
          const used = counts[tag.slug] ?? 0;
          const protectedTag = tag.slug === FALLBACK_TAG;
          return (
            <View style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => promptRename(tag)}
                accessibilityRole="button"
                accessibilityLabel={`Rename ${tag.label}, used by ${used} item${used === 1 ? '' : 's'}`}
                testID={`tag-${tag.slug}`}
              >
                <Text style={styles.label}>{tag.label}</Text>
                <Text style={styles.meta}>
                  {tag.slug}
                  {'  ·  '}
                  {used} item{used === 1 ? '' : 's'}
                  {protectedTag ? '  ·  fallback' : ''}
                </Text>
              </Pressable>
              {protectedTag ? (
                <Ionicons name="lock-closed-outline" size={16} color={colors.textFaint} />
              ) : (
                <Pressable
                  onPress={() => confirmDelete(tag)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${tag.label}`}
                  testID={`delete-${tag.slug}`}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              )}
            </View>
          );
        }}
        ListFooterComponent={
          <Pressable
            style={styles.addRow}
            onPress={promptAdd}
            accessibilityRole="button"
            accessibilityLabel="Add a tag"
            testID="add-tag"
          >
            <Ionicons name="add" size={16} color={colors.amberInkOn} />
            <Text style={styles.addLabel}>Add tag</Text>
          </Pressable>
        }
      />
      <PromptModal request={prompt} onClose={() => setPrompt(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  note: { ...type.dim, marginBottom: sp(2) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: sp(3),
  },
  rowMain: { flex: 1, gap: 2 },
  label: { ...type.body, fontWeight: '600' },
  meta: { ...type.dim, fontSize: 12 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: sp(3),
    paddingVertical: sp(3),
    borderRadius: radius.pill,
    backgroundColor: colors.amber,
  },
  addLabel: { color: colors.amberInkOn, fontWeight: '700' },
});
