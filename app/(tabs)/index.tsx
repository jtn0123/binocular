import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BinThumb } from '@/components/BinThumb';
import { CodeTag } from '@/components/CodeTag';
import { QrModal } from '@/components/QrModal';
import { useDb } from '@/db/DbProvider';
import {
  countItemsForBin,
  getBin,
  getBinPlace,
  listCheckedOutItems,
  listItemPhotoUris,
  listLowStockItems,
  listRecentBins,
  returnItem,
  type BinRow,
  type ItemWithBin,
} from '@/db/queries';
import { logEvent } from '@/diagnostics/events';
import { useFocusTick } from '@/lib/useFocusTick';
import { searchBins, searchItems, type SearchResult } from '@/search/fts';
import { colors, radius, sp, type } from '@/theme';

function BinCard({
  bin,
  itemCount,
  itemPhotoUris,
  place,
  onShowQr,
}: {
  bin: BinRow;
  itemCount: number;
  itemPhotoUris: string[];
  place: string | null;
  onShowQr: () => void;
}) {
  return (
    <Link href={{ pathname: '/bin/[id]', params: { id: bin.id } }} asChild>
      <Pressable
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={`Bin ${bin.short_code}, ${bin.name}, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
      >
        <Pressable
          onPress={onShowQr}
          accessibilityRole="button"
          accessibilityLabel={`Show QR code for ${bin.short_code}`}
          testID={`qr-thumb-${bin.short_code}`}
        >
          <BinThumb
            coverUri={bin.cover_photo_uri}
            itemPhotoUris={itemPhotoUris}
            size={64}
            radius={radius.md}
          />
        </Pressable>
        <View style={styles.cardMain}>
          <CodeTag code={bin.short_code} small />
          <Text style={styles.cardName} numberOfLines={1}>
            {bin.name}
          </Text>
          <Text style={styles.cardMeta}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
            {place ? `  ·  ${place}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
    </Link>
  );
}

function ResultRow({
  result,
  onPress,
  onShowQr,
}: {
  result: SearchResult;
  onPress: () => void;
  onShowQr: () => void;
}) {
  const where =
    [result.binName, result.shelfName, result.locationName].filter(Boolean).join(', ') ||
    'unassigned';
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${result.quantity > 1 ? `${result.quantity} ` : ''}${result.brand ? `${result.brand} ` : ''}${result.name}, in ${where}${result.checkedOutTo ? `, checked out to ${result.checkedOutTo}` : ''}`}
    >
      <Pressable
        onPress={onShowQr}
        accessibilityRole="button"
        accessibilityLabel={`Show QR code for the bin holding ${result.name}`}
      >
        {result.binCoverUri ? (
          <Image source={{ uri: result.binCoverUri }} style={styles.thumbSm} contentFit="cover" />
        ) : (
          <View style={[styles.thumbSm, styles.thumbEmpty]}>
            <Ionicons name="cube-outline" size={18} color={colors.textFaint} />
          </View>
        )}
      </Pressable>
      <View style={styles.cardMain}>
        <Text style={styles.resultName} numberOfLines={1}>
          {result.quantity > 1 ? `${result.quantity}× ` : ''}
          {result.brand ? `${result.brand} ` : ''}
          {result.name}
        </Text>
        <View style={styles.crumbRow}>
          {result.binCode ? <CodeTag code={result.binCode} small /> : null}
          <Text style={styles.cardMeta} numberOfLines={1}>
            {[result.binName, result.shelfName, result.locationName].filter(Boolean).join(' · ') ||
              'unassigned'}
          </Text>
        </View>
        {result.checkedOutTo ? (
          <Text style={styles.checkedOut}>checked out to {result.checkedOutTo}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function StatusRow({
  item,
  detail,
  actionLabel,
  onAction,
  onOpen,
}: {
  item: ItemWithBin;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  onOpen: () => void;
}) {
  return (
    <Pressable
      style={styles.statusRow}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${detail}${item.bin_code ? `, bin ${item.bin_code}` : ''}`}
    >
      {item.bin_code ? <CodeTag code={item.bin_code} small /> : null}
      <View style={styles.statusMain}>
        <Text style={styles.statusName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.statusDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          style={styles.statusAction}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel} ${item.name}`}
        >
          <Text style={styles.statusActionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export default function HomeScreen() {
  const db = useDb();
  const router = useRouter();
  useFocusTick();
  const [query, setQuery] = useState('');
  const [qrBin, setQrBin] = useState<BinRow | null>(null);

  const [tick, setTick] = useState(0);
  void tick;
  const trimmed = query.trim();
  const results = trimmed ? searchItems(db, trimmed, 50) : [];
  const binMatches = trimmed ? searchBins(db, trimmed) : [];
  const recentBins = trimmed ? [] : listRecentBins(db, 12);

  // D16: log the settled query, not every keystroke.
  useEffect(() => {
    if (!trimmed) return;
    const timer = setTimeout(() => {
      logEvent(db, {
        kind: 'search',
        name: 'search',
        detail: { query: trimmed, items: results.length, bins: binMatches.length },
      });
    }, 400);
    return () => clearTimeout(timer);
    // Intentionally keyed on the query alone: result counts are derived from
    // it, and including them would re-fire the timer on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, trimmed]);
  const checkedOut = trimmed ? [] : listCheckedOutItems(db);
  const lowStock = trimmed ? [] : listLowStockItems(db);

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={17} color={colors.textFaint} />
        <TextInput
          style={styles.search}
          placeholder="Search your workshop…"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          testID="home-search"
        />
        {trimmed.length > 0 && (
          <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {trimmed ? (
        <>
          {binMatches.length > 0 && (
            <View style={styles.binHits} testID="bin-hits">
              {binMatches.map((bin) => (
                <Pressable
                  key={bin.id}
                  style={styles.binHit}
                  accessibilityRole="button"
                  accessibilityLabel={`Bin ${bin.short_code}, ${bin.name}`}
                  onPress={() => router.push({ pathname: '/bin/[id]', params: { id: bin.id } })}
                >
                  <CodeTag code={bin.short_code} small />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.binHitName} numberOfLines={1}>
                      {bin.name}
                    </Text>
                    {(() => {
                      const where = getBinPlace(db, bin.id);
                      const crumb = [where.shelfName, where.locationName]
                        .filter(Boolean)
                        .join(' · ');
                      return crumb ? <Text style={styles.cardMeta}>{crumb}</Text> : null;
                    })()}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={styles.stamp}>
            {results.length} match{results.length === 1 ? '' : 'es'}
          </Text>
          <FlatList
            data={results}
            keyExtractor={(r) => r.itemId}
            contentContainerStyle={{ gap: sp(2), paddingBottom: sp(8) }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.empty}>Nothing matches “{trimmed}” yet.</Text>
            }
            renderItem={({ item: result }) => (
              <ResultRow
                result={result}
                onPress={() =>
                  result.binId &&
                  router.push({ pathname: '/bin/[id]', params: { id: result.binId } })
                }
                onShowQr={() => {
                  if (result.binId) setQrBin(getBin(db, result.binId));
                }}
              />
            )}
          />
        </>
      ) : (
        <>
          {checkedOut.length > 0 && (
            <View style={styles.statusBlock}>
              <Text style={styles.stamp}>Checked out</Text>
              {checkedOut.map((item) => (
                <StatusRow
                  key={item.id}
                  item={item}
                  detail={`with ${item.checked_out_to}`}
                  actionLabel="Return"
                  onAction={() => {
                    returnItem(db, item.id);
                    setTick((t) => t + 1);
                  }}
                  onOpen={() =>
                    item.bin_id &&
                    router.push({ pathname: '/bin/[id]', params: { id: item.bin_id } })
                  }
                />
              ))}
            </View>
          )}
          {lowStock.length > 0 && (
            <View style={styles.statusBlock}>
              <Text style={styles.stamp}>Running low</Text>
              {lowStock.map((item) => (
                <StatusRow
                  key={item.id}
                  item={item}
                  detail={`${item.quantity} left (alert at ${item.low_stock_threshold})`}
                  onOpen={() =>
                    item.bin_id &&
                    router.push({ pathname: '/bin/[id]', params: { id: item.bin_id } })
                  }
                />
              ))}
            </View>
          )}
          <Text style={styles.stamp}>Recent bins</Text>
          <FlatList
            data={recentBins}
            keyExtractor={(bin) => bin.id}
            contentContainerStyle={{ gap: sp(2.5), paddingBottom: sp(8) }}
            ListEmptyComponent={
              <Text style={styles.empty}>No bins yet — create one in Browse.</Text>
            }
            renderItem={({ item: bin }) => (
              <BinCard
                bin={bin}
                itemCount={countItemsForBin(db, bin.id)}
                itemPhotoUris={bin.cover_photo_uri ? [] : listItemPhotoUris(db, bin.id)}
                place={(() => {
                  const where = getBinPlace(db, bin.id);
                  return [where.shelfName, where.locationName].filter(Boolean).join(' · ') || null;
                })()}
                onShowQr={() => setQrBin(bin)}
              />
            )}
          />
        </>
      )}
      <QrModal bin={qrBin} onClose={() => setQrBin(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: sp(4), gap: sp(3) },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: sp(3.5),
    paddingVertical: sp(3),
  },
  search: { flex: 1, fontSize: 15, color: colors.text, padding: 0 },
  stamp: { ...type.stamp, marginTop: sp(1) },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(3),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: sp(2.5),
  },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  thumbSm: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardMain: { flex: 1, gap: 3 },
  cardName: { ...type.h2 },
  cardMeta: { ...type.dim, fontSize: 12, flexShrink: 1 },
  resultName: { ...type.body, fontWeight: '600' },
  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  checkedOut: { fontSize: 11, color: colors.warn },
  empty: { ...type.dim, paddingVertical: sp(6), textAlign: 'center' },
  binHits: { gap: sp(1.5) },
  binHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: sp(3),
    paddingVertical: sp(2.5),
  },
  binHitName: { color: colors.text, fontWeight: '600' },
  statusBlock: { gap: sp(2) },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp(2.5),
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: sp(2.5),
  },
  statusMain: { flex: 1 },
  statusName: { ...type.body, fontWeight: '600', fontSize: 14 },
  statusDetail: { ...type.dim, fontSize: 12 },
  statusAction: {
    backgroundColor: colors.amber,
    paddingHorizontal: sp(2.75),
    paddingVertical: sp(1.5),
    borderRadius: radius.pill,
  },
  statusActionLabel: { color: colors.amberInkOn, fontWeight: '700', fontSize: 12 },
});
