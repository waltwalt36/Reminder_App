import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { CaptureState } from '../audio/useVoiceCapture';
import { useTheme } from '../theme';

const SIZE = 132;

interface Props {
  state: CaptureState;
  /** 0-1 mic amplitude; drives the ring while listening. */
  level: number;
  onPress: () => void;
}

export function MicButton({ state, level, onPress }: Props) {
  const theme = useTheme();
  const ring = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  // Ring tracks live amplitude, lightly smoothed so it breathes rather than jitters.
  useEffect(() => {
    Animated.timing(ring, {
      toValue: state === 'listening' ? level : 0,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [level, state, ring]);

  useEffect(() => {
    if (state !== 'thinking') {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [state, spin]);

  const scale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const opacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const label =
    state === 'listening' ? 'Listening…' : state === 'thinking' ? 'Working…' : 'Tap to speak';

  return (
    <View style={styles.wrap}>
      <View style={styles.stack}>
        {state === 'listening' && (
          <Animated.View
            style={[
              styles.halo,
              { backgroundColor: theme.accent, transform: [{ scale }], opacity },
            ]}
          />
        )}

        {state === 'thinking' && (
          <Animated.View
            style={[
              styles.spinner,
              { borderColor: theme.accentSoft, borderTopColor: theme.accent },
              { transform: [{ rotate }] },
            ]}
          />
        )}

        <Pressable
          onPress={onPress}
          disabled={state === 'thinking'}
          accessibilityRole="button"
          accessibilityLabel={
            state === 'listening' ? 'Stop recording' : 'Record a reminder'
          }
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: state === 'listening' ? theme.accent : theme.card,
              borderColor: state === 'listening' ? theme.accent : theme.border,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}
        >
          <Text style={styles.glyph}>{state === 'listening' ? '■' : '🎙'}</Text>
        </Pressable>
      </View>

      <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 20 },
  stack: { width: SIZE * 1.6, height: SIZE * 1.6, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  spinner: {
    position: 'absolute',
    width: SIZE + 22,
    height: SIZE + 22,
    borderRadius: (SIZE + 22) / 2,
    borderWidth: 3,
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  glyph: { fontSize: 44 },
  label: { fontSize: 15, fontWeight: '500' },
});
