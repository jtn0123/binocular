import { useLocalSearchParams, useRouter } from 'expo-router';

import { ReviewScreen } from '@/review/ReviewScreen';

export default function ReviewRoute() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  const router = useRouter();
  if (!scanId) return null;
  return (
    <ReviewScreen
      scanId={scanId}
      onDone={(binId) => {
        if (binId) {
          router.replace({ pathname: '/bin/[id]', params: { id: binId } });
        } else if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/');
        }
      }}
    />
  );
}
