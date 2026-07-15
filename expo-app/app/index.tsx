import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, Animated } from 'react-native';
import { useRouter } from 'expo-router';

const ROLES = [
  'les accessoiristes',
  'les électros',
  'les pupitreurs',
  'la mise en scène',
  'les DOP',
];

export default function HomeScreen() {
  const router = useRouter();
  const [roleIdx, setRoleIdx] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 420, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -9, duration: 420, useNativeDriver: true }),
      ]).start(() => {
        setRoleIdx(i => (i + 1) % ROLES.length);
        translateY.setValue(9);
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 0, duration: 420, useNativeDriver: true }),
        ]).start();
      });
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.title}>SetRemote</Text>
        <View style={styles.tagline}>
          <Text style={styles.taglinePrefix}>Une app conçue pour</Text>
          <Animated.Text style={[styles.role, { opacity, transform: [{ translateY }] }]}>
            {ROLES[roleIdx]}
          </Animated.Text>
        </View>
      </View>

      <View style={styles.btns}>
        <Pressable
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => router.push('/remote')}
        >
          <Text style={[styles.btnText, styles.btnTextPrimary]}>📱→🎬  Télécommande</Text>
        </Pressable>
        <Pressable
          style={styles.btn}
          onPress={() => router.push('/screen')}
        >
          <Text style={styles.btnText}>🟡  Écran projecteur</Text>
        </Pressable>
      </View>

      <Text style={styles.credit}>by Pikoo</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
    paddingHorizontal: 24,
  },
  head: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', web: "'Playfair Display', serif" }),
    fontSize: 48,
    color: '#e8c97a',
    letterSpacing: -0.5,
  },
  tagline: {
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
  },
  taglinePrefix: {
    fontSize: 11,
    letterSpacing: 2,
    color: '#777',
    textTransform: 'uppercase',
  },
  role: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', web: "'Playfair Display', serif" }),
    fontStyle: 'italic',
    fontSize: 22,
    color: '#e8c97a',
    lineHeight: 30,
    minHeight: 30,
  },
  btns: {
    width: '100%',
    maxWidth: 340,
    gap: 16,
  },
  btn: {
    paddingVertical: 16,
    paddingHorizontal: 36,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#1c1c1f',
    borderRadius: 4,
    alignItems: 'center',
  },
  btnPrimary: {
    backgroundColor: '#e8c97a',
    borderColor: '#e8c97a',
  },
  btnText: {
    color: '#f0ede8',
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  btnTextPrimary: {
    color: '#000000',
    fontWeight: '600',
  },
  credit: {
    position: 'absolute',
    bottom: 20,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: '#3a3a3a',
  },
});
