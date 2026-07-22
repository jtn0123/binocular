import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { CodeTag } from '@/components/CodeTag';
import { useDb } from '@/db/DbProvider';
import { countItemsForBin, listRecentBins, type BinRow } from '@/db/queries';
import { useFocusTick } from '@/lib/useFocusTick';
import { searchItems, type SearchResult } from '@/search/fts';
import { colors, radius, sp, type } from '@/theme';

function BinCard({ bin, itemCount }: { bin: BinRow; itemCount: number }) {
  return (
    <Link href={{ pathname: '/bin/[id]', params: { id: bin.id } }} asChild>
      <Pressable style={styles.card}>
        {bin.cover_photo_uri ? (
          <Image source={{ uri: bin.cover_photo_uri }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="file-tray" size={22} color={colors.textFaint} />
          </View>
        )}
        <View style={styles.cardMain}>
          <CodeTag code={bin.short_code} small />
          <Text style={styles.cardName} numberOfLines={1}>
            {bin.name}
          </Text>
          <Text style={styles.cardMeta}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
            {bin.last_scanned_at ? `  ·  scanned ${bin.last_scanned_at.slice(0, 10)}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
    </Link>
  );
}

function ResultRow({ result, onPress }: { result: SearchResult; onPress: () => void }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      {result.binCoverUri ? (
        <Image source={{ uri: result.binCoverUri }} style={styles.thumbSm} contentFit="cover" />
      ) : (
        <View style={[styles.thumbSm, styles.thumbEmpty]}>
          <Ionicons name="cube-outline" size={18} color={colors.textFaint} />
        </View>
      )}
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

export default function HomeScreen() {
  const db = useDb();
  const router = useRouter();
  useFocusTick();
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const results = trimmed ? searchItems(db, trimmed, 50) : [];
  const recentBins = trimmed ? [] : listRecentBins(db, 12);

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
              />
            )}
          />
        </>
      ) : (
        <>
          <Text style={styles.stamp}>Recent bins</Text>
          <FlatList
            data={recentBins}
            keyExtractor={(bin) => bin.id}
            contentContainerStyle={{ gap: sp(2.5), paddingBottom: sp(8) }}
            ListEmptyComponent={
              <Text style={styles.empty}>No bins yet — create one in Browse.</Text>
            }
            renderItem={({ item: bin }) => (
              <BinCard bin={bin} itemCount={countItemsForBin(db, bin.id)} />
            )}
          />
        </>
      )}
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
});
