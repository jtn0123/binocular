import NetInfo from '@react-native-community/netinfo';
import { File } from 'expo-file-system';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useDb } from '../db/DbProvider';
import { purgeDeletedItems } from '../db/queries';

import { activateEncoderIfDownloaded } from '../vision/executorchEmbedder';
import { backfillEmbeddings } from '../vision/visualMemory';

import { initScanQueue, pruneOldScanPhotos, recoverInterruptedScans } from './scanQueue';

/**
 * D20: encode a bounded slice of the item backlog per foreground, so turning
 * visual memory on does not stall the first launch of a workshop with a
 * thousand photos. Returns quietly when no encoder is available.
 */
const EMBEDDING_BATCH = 8;

async function drainEmbeddingBacklog(db: Parameters<typeof backfillEmbeddings>[0]) {
  try {
    let done = await backfillEmbeddings(db, EMBEDDING_BATCH);
    // Keep going while a full batch came back — there is more waiting — but
    // yield between batches so the UI thread is never held hostage.
    while (done === EMBEDDING_BATCH) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      done = await backfillEmbeddings(db, EMBEDDING_BATCH);
    }
  } catch {
    // Backfill is an optimisation; it must never break app startup.
  }
}

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
    // D20: bring the encoder back if its weights are already here (never
    // downloads), then work the backlog with it. Ordered, not raced — a
    // backfill that starts before the encoder loads would find nothing to do
    // and report a false "0 remaining" on every cold start.
    void activateEncoderIfDownloaded()
      .catch(() => false)
      .then(() => drainEmbeddingBacklog(db));

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void queue.drain();
        void drainEmbeddingBacklog(db);
      }
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
