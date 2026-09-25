import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useTheme } from '../theme';

const items = [
  { label: 'Capture', path: '/' },
  { label: 'People', path: '/people' },
  { label: 'Follow-ups', path: '/reminders' },
];

export function AppBottomNav() {
  const theme = useTheme();
  const pathname = usePathname();
  return <View style={[styles.nav, { backgroundColor: theme.bg, borderColor: theme.border }]}>
    {items.map((item) => {
      const active = item.path === '/' ? pathname === '/' : item.path === '/people' ? pathname.startsWith('/people') || pathname.startsWith('/person/') : pathname.startsWith(item.path);
      return <Pressable key={item.path} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => router.replace(item.path)} style={styles.item}>
        <Text style={[styles.label, { color: active ? theme.accent : theme.muted, fontWeight: active ? '500' : '400' }]}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({ nav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8 }, item: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 }, label: { fontSize: 12 } });
