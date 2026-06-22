import React, { useCallback, useRef, useState } from 'react';
import { View, PanResponder } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle, G, Path } from 'react-native-svg';
import { polarToHex, hexToWheelPos } from '../lib/color';

const SECTORS = 72; // 5° per sector

function sectorPath(i: number, total: number, r: number): string {
  const a0 = (i / total) * 2 * Math.PI - Math.PI / 2;
  const a1 = ((i + 1) / total) * 2 * Math.PI - Math.PI / 2;
  const x0 = r + r * Math.cos(a0), y0 = r + r * Math.sin(a0);
  const x1 = r + r * Math.cos(a1), y1 = r + r * Math.sin(a1);
  return `M ${r} ${r} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`;
}

function sectorColor(i: number, total: number): string {
  const hue = (i / total) * 360;
  return `hsl(${hue},100%,50%)`;
}

interface Props {
  size: number;
  onPick: (hex: string) => void;
  /** Couleur de roue actuellement sélectionnée (teinte/saturation, valeur = 1). */
  selectedHex?: string;
}

export function ColorWheel({ size, onPick, selectedHex }: Props) {
  const r = size / 2;

  // Position « live » du doigt + couleur, pour afficher la loupe pendant le glisser.
  const [drag, setDrag] = useState<{ x: number; y: number; hex: string } | null>(null);

  const pick = useCallback((px: number, py: number) => {
    const hex = polarToHex(px, py, r, r, r);
    onPick(hex);
    setDrag({ x: px, y: py, hex });
  }, [r, onPick]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const dx = locationX - r, dy = locationY - r;
        if (Math.hypot(dx, dy) <= r) pick(locationX, locationY);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        const dx = locationX - r, dy = locationY - r;
        if (Math.hypot(dx, dy) <= r) pick(locationX, locationY);
      },
      onPanResponderRelease: () => setDrag(null),
      onPanResponderTerminate: () => setDrag(null),
    })
  ).current;

  // Marqueur permanent : position de la couleur sélectionnée sur la roue.
  const markerPos = selectedHex ? hexToWheelPos(selectedHex) : null;
  const mx = markerPos ? markerPos.x * size : r;
  const my = markerPos ? markerPos.y * size : r;

  // Loupe : bulle agrandie de la couleur, décalée au-dessus du doigt.
  const loupeR = Math.max(24, size * 0.16);
  const loupeX = drag ? Math.min(size - loupeR, Math.max(loupeR, drag.x)) : 0;
  const loupeY = drag ? Math.max(loupeR, drag.y - loupeR - 18) : 0;

  return (
    <View style={{ width: size, height: size }} {...panResponder.panHandlers}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="sat" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <G>
          {Array.from({ length: SECTORS }).map((_, i) => (
            <Path key={i} d={sectorPath(i, SECTORS, r)} fill={sectorColor(i, SECTORS)} />
          ))}
        </G>
        <Circle cx={r} cy={r} r={r} fill="url(#sat)" />

        {/* Marqueur de la couleur sélectionnée */}
        {markerPos && (
          <>
            <Circle cx={mx} cy={my} r={11} fill="none" stroke="#000000" strokeOpacity={0.5} strokeWidth={4} />
            <Circle cx={mx} cy={my} r={11} fill="none" stroke="#ffffff" strokeWidth={2.5} />
            <Circle cx={mx} cy={my} r={6} fill={selectedHex} />
          </>
        )}

        {/* Loupe pendant le glisser */}
        {drag && (
          <>
            <Circle cx={loupeX} cy={loupeY} r={loupeR + 3} fill="#000000" fillOpacity={0.35} />
            <Circle cx={loupeX} cy={loupeY} r={loupeR} fill={drag.hex} stroke="#ffffff" strokeWidth={3} />
          </>
        )}
      </Svg>
    </View>
  );
}
