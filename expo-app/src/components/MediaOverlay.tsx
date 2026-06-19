import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { CachedMedia } from '../lib/mediaCache';

interface Props {
  media: CachedMedia;
}

/** Affiche un média (déjà en cache) en plein écran sur l'écran projecteur. */
export function MediaOverlay({ media }: Props) {
  if (media.kind === 'video') return <VideoOverlay uri={media.uri} />;
  return (
    <View style={styles.fill}>
      <Image source={{ uri: media.uri }} style={styles.fill} contentFit="contain" />
    </View>
  );
}

function VideoOverlay({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });
  return (
    <View style={styles.fill}>
      <VideoView
        player={player}
        style={styles.fill}
        contentFit="contain"
        nativeControls={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000000',
  },
});
