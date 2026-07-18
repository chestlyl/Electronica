import { StyleSheet, Text, View } from 'react-native';

export default function AuthEntry() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Engagement Engine</Text>
      <Text style={styles.subtitle}>Authentication coming in Layer 2</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666' },
});
