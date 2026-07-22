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
            testID="prompt-input"
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="prompt-submit"
              onPress={() => {
                if (!value.trim()) return;
                request?.onSubmit(value.trim());
                onClose();
              }}
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
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: sp(5.5), alignItems: 'center' },
  cancel: { color: colors.textDim },
  submit: { color: colors.amber, fontWeight: '800' },
});
