import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

/**
 * Bumps a counter every time the screen regains focus, so components that
 * read from SQLite synchronously during render pick up fresh data.
 */
export function useFocusTick(): number {
  const [tick, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  return tick;
}
