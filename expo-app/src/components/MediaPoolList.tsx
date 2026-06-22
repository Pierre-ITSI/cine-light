/**
 * Liste du pool média avec réordonnancement par cliquer-glisser.
 *
 * Chaque média est numéroté (1, 2, 3…) selon l'ordre de diffusion. On le saisit
 * par sa poignée (☰) et on le glisse verticalement ; les positions sont permutées
 * en direct (la liste reste sous le doigt). Pendant un glissement, on demande au
 * parent de figer le défilement du ScrollView pour éviter tout conflit de geste.
 */
import React, { useRef, useState } from 'react';
import { View, Text, Pressable, Animated, PanResponder, StyleSheet } from 'react-native';
import type { RemoteMediaItem } from '../lib/useMediaPool';

interface DragApi {
  begin: (id: string) => void;
  move: (dy: number) => void;
  end: () => void;
}

interface Props {
  items: RemoteMediaItem[];
  playingId: string | null;
  onPlay: (id: string) => void;
  onStop: () => void;
  onClear: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onDragChange: (active: boolean) => void;
}

export function MediaPoolList({
  items, playingId, onPlay, onStop, onClear, onMove, onDragChange,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const transY = useRef(new Animated.Value(0)).current;

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pitchRef = useRef(96);   // hauteur d'une ligne + marge (mesurée)
  const measuredRef = useRef(false);
  const startIndexRef = useRef(0);
  const baselineRef = useRef(0);

  // API de glissement, rafraîchie à chaque rendu et lue via un ref stable par
  // les PanResponder (créés une seule fois par ligne).
  const apiRef = useRef<DragApi>({ begin: () => {}, move: () => {}, end: () => {} });
  apiRef.current = {
    begin: (id: string) => {
      const idx = itemsRef.current.findIndex(it => it.id === id);
      if (idx < 0) return;
      startIndexRef.current = idx;
      baselineRef.current = idx;
      transY.setValue(0);
      setDragId(id);
      onDragChange(true);
    },
    move: (dy: number) => {
      const pitch = pitchRef.current || 96;
      const raw = startIndexRef.current + Math.round(dy / pitch);
      const target = Math.max(0, Math.min(itemsRef.current.length - 1, raw));
      if (target !== baselineRef.current) {
        onMove(baselineRef.current, target);
        baselineRef.current = target;
      }
      transY.setValue(dy - (baselineRef.current - startIndexRef.current) * pitch);
    },
    end: () => {
      transY.setValue(0);
      setDragId(null);
      onDragChange(false);
    },
  };

  return (
    <View style={styles.list}>
      {items.map((item, idx) => (
        <DragRow
          key={item.id}
          item={item}
          index={idx}
          total={items.length}
          dragging={item.id === dragId}
          transY={transY}
          api={apiRef}
          playing={playingId === item.id}
          onPlay={onPlay}
          onStop={onStop}
          onClear={onClear}
          onMeasure={(h) => {
            if (!measuredRef.current && h > 0) { pitchRef.current = h + 8; measuredRef.current = true; }
          }}
        />
      ))}
    </View>
  );
}

interface RowProps {
  item: RemoteMediaItem;
  index: number;
  total: number;
  dragging: boolean;
  playing: boolean;
  transY: Animated.Value;
  api: React.MutableRefObject<DragApi>;
  onPlay: (id: string) => void;
  onStop: () => void;
  onClear: (id: string) => void;
  onMeasure: (h: number) => void;
}

function DragRow({
  item, index, dragging, playing, transY, api, onPlay, onStop, onClear, onMeasure,
}: RowProps) {
  // PanResponder créé une seule fois ; lit l'API courante via le ref.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => api.current.begin(item.id),
      onPanResponderMove: (_e, g) => api.current.move(g.dy),
      onPanResponderRelease: () => api.current.end(),
      onPanResponderTerminate: () => api.current.end(),
    })
  ).current;

  return (
    <Animated.View
      onLayout={e => onMeasure(e.nativeEvent.layout.height)}
      style={[
        styles.row,
        dragging && styles.rowDragging,
        dragging && { transform: [{ translateY: transY }], zIndex: 20, elevation: 8 },
      ]}
    >
      <View style={styles.rowHead}>
        <View style={styles.num}><Text style={styles.numText}>{index + 1}</Text></View>
        <View style={styles.handle} hitSlop={10} {...pan.panHandlers}>
          <Text style={styles.handleText}>≡</Text>
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {item.kind === 'video' ? '🎬' : '🖼'} {item.name}
        </Text>
        <Text style={styles.status}>
          {item.status === 'uploading'
            ? `${Math.round(item.progress * 100)}%`
            : item.status === 'ready' ? '✓' : '⚠'}
        </Text>
      </View>
      {item.status === 'uploading' && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${item.progress * 100}%` }]} />
        </View>
      )}
      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, styles.playBtn, item.status !== 'ready' && styles.disabled, playing && styles.playActive]}
          disabled={item.status !== 'ready'}
          onPress={() => onPlay(item.id)}
        >
          <Text style={styles.btnText}>{playing ? '▶ En lecture' : '▶ Jouer'}</Text>
        </Pressable>
        {playing && (
          <Pressable style={styles.btn} onPress={onStop}>
            <Text style={styles.btnText}>■ Stop</Text>
          </Pressable>
        )}
        <Pressable style={styles.btn} onPress={() => onClear(item.id)}>
          <Text style={[styles.btnText, styles.danger]}>✕</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { alignSelf: 'stretch' },
  row: {
    alignSelf: 'stretch',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000',
    borderRadius: 8, padding: 12, gap: 10, marginBottom: 8,
  },
  rowDragging: { borderColor: '#e8c97a', backgroundColor: '#15140f' },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(232,201,122,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  numText: { color: '#e8c97a', fontSize: 11, fontWeight: '700' },
  handle: {
    width: 30, height: 30, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  handleText: { color: '#f0ede8', fontSize: 16, lineHeight: 18 },
  name: { color: '#f0ede8', fontSize: 12, flex: 1 },
  status: { color: '#777', fontSize: 11, minWidth: 28, textAlign: 'right' },
  track: { height: 4, backgroundColor: '#252528', borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: '#e8c97a' },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 6,
  },
  playBtn: { flex: 1, alignItems: 'center' },
  playActive: { borderColor: '#5fdf8a', backgroundColor: 'rgba(95,223,138,0.12)' },
  btnText: { color: '#f0ede8', fontSize: 12 },
  danger: { color: '#ff8080' },
  disabled: { opacity: 0.4 },
});
