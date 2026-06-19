import React, { useCallback, useRef } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle, G, Path } from 'react-native-svg';
import { polarToHex } from '../lib/color';

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
}

export function ColorWheel({ size, onPick }: Props) {
  const r = size / 2;
  const layoutRef = useRef<{ x: number; y: number } | null>(null);

  const pick = useCallback((px: number, py: number) => {
    const hex = polarToHex(px, py, r, r, r);
    onPick(hex);
  }, [r, onPick]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
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
    })
  ).current;

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
      </Svg>
    </View>
  );
}
