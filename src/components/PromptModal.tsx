import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, sp, type } from '../theme';

/**
 * Cross-platform text prompt (Alert.prompt is iOS-only). Controlled by a
 * `request` object so one instance serves a whole screen.
 */
export interface PromptRequest {
  title: string;
  placeholder?: string;
  initialValue?: string;
  keyboardType?: 'default' | 'number-pad';
  submitLabel?: string;
  onSubmit: (value: string) => void;
}

export function PromptModal({
  request,
  onClose,
}: {
  request: PromptRequest | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [seededFor, setSeededFor] = useState<PromptRequest | null>(null);

  if (request && seededFor !== request) {
    setValue(request.initialValue ?? '');
    setSeededFor(request);
  }

  function submit() {
    if (!value.trim()) return;
    request?.onSubmit(value.trim());
    onClose();
  }

  return (
    <Modal visible={request !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{request?.title}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={request?.placeholder}
            placeholderTextColor={colors.textFaint}
            keyboardType={request?.keyboardType ?? 'default'}
            autoFocus
            // The keyboard's own action key finishes the job, which is what a
            // thumb reaches for after typing one word.
            returnKeyType="done"
            onSubmitEditing={submit}
            testID="prompt-input"
          />
          {/*
            These were bare <Text> in a padding-less Pressable — roughly 17dp
            tall, with no accessibilityRole, in the dialog behind every rename
            in the app: bins, tags, shelves, slot counts, quantities. And Save
            was a silent no-op on an empty field rather than being visibly
            unavailable.
          */}
          <View style={styles.actions}>
            <Pressable
              style={styles.action}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              testID="prompt-cancel"
            >
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.action, !value.trim() && styles.actionDisabled]}
              disabled={!value.trim()}
              accessibilityRole="button"
              accessibilityState={{ disabled: !value.trim() }}
              accessibilityLabel={request?.submitLabel ?? 'Save'}
              testID="prompt-submit"
              onPress={submit}
            >
              <Text style={styles.submit}>{request?.submitLabel ?? 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: sp(8),
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    padding: sp(4.5),
    gap: sp(3),
  },
  title: { ...type.h2 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSunken,
    color: colors.text,
    borderRadius: radius.md,
    padding: sp(2.5),
    fontSize: 15,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: sp(2), alignItems: 'center' },
  // Real targets rather than bare text: this dialog is every rename in the app.
  action: { paddingHorizontal: sp(4), paddingVertical: sp(2.5), borderRadius: radius.md },
  actionDisabled: { opacity: 0.4 },
  cancel: { color: colors.textDim },
  submit: { color: colors.amber, fontWeight: '800' },
});
