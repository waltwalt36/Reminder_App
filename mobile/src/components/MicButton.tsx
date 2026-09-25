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
  interactive?: boolean;
}

export function MicButton({ state, level, onPress, interactive = true }: Props) {
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
  const buttonScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] });
  const opacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const label =
    state === 'listening' ? 'Listening…' : state === 'thinking' ? 'Working…' : 'Tap to start';

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
          disabled={!interactive || state === 'thinking'}
          accessibilityRole={interactive ? 'button' : undefined}
          accessibilityLabel={
            interactive ? (state === 'listening' ? 'Stop recording' : 'Record a connection note') : undefined
          }
        >
          <Animated.View
            style={[
              styles.button,
              {
                backgroundColor: state === 'listening' ? theme.accent : theme.accentSoft,
                borderColor: state === 'listening' ? theme.accent : theme.accentSoft,
                transform: [{ scale: buttonScale }],
              },
            ]}
          >
            {state === 'listening' ? <View style={[styles.stopMark, { backgroundColor: theme.card }]} /> : <View style={styles.micIcon}>
              <View style={[styles.micHead, { backgroundColor: theme.accent }]} />
              <View style={[styles.micArc, { borderColor: theme.accent }]} />
              <View style={[styles.micStem, { backgroundColor: theme.accent }]} />
              <View style={[styles.micFoot, { backgroundColor: theme.accent }]} />
            </View>}
          </Animated.View>
        </Pressable>
      </View>

      {(interactive || state !== 'idle') && <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
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
    width: 150,
    height: 150,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  micIcon: { width: 40, height: 48, alignItems: 'center' },
  micHead: { position: 'absolute', top: 2, width: 14, height: 24, borderRadius: 7 },
  micArc: { position: 'absolute', top: 10, width: 30, height: 21, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 15, borderBottomRightRadius: 15 },
  micStem: { position: 'absolute', top: 30, width: 2, height: 9, borderRadius: 1 },
  micFoot: { position: 'absolute', top: 39, width: 16, height: 2, borderRadius: 1 },
  stopMark: { width: 18, height: 18, borderRadius: 3 },
  label: { fontSize: 15, fontWeight: '500' },
});
