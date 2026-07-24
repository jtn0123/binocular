import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useDb } from '../db/DbProvider';
import { purgeDeletedItems } from '../db/queries';

import { initScanQueue, pruneOldScanPhotos, recoverInterruptedScans } from './scanQueue';

/**
 * Mounts once inside DbProvider: boot recovery + pruning, then keeps the
 * single drain loop kicked on app foreground and connectivity changes.
 */
export function QueueRunner() {
  const db = useDb();

  useEffect(() => {
    recoverInterruptedScans(db);
    pruneOldScanPhotos(db, (uri) => {
      const file = new File(uri);
      if (file.exists) file.delete();
    });
    // D17: recently-deleted items age out after 30 days, same boot cadence.
    purgeDeletedItems(db);

    const queue = initScanQueue(db);
    void queue.drain();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queue.drain();
    });
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      if (state.isConnected) void queue.drain();
    });
    return () => {
      appStateSub.remove();
      unsubscribeNet();
      queue.dispose();
    };
  }, [db]);

  return null;
}
