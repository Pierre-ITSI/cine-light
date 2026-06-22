import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000000' }}>
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            // Désactive le swipe « retour » iOS : il déclenchait des retours
            // involontaires et capturait les gestes horizontaux (jauges).
            gestureEnabled: false,
            fullScreenGestureEnabled: false,
            contentStyle: { backgroundColor: '#000000' },
          }}
        />
      </View>
    </GestureHandlerRootView>
  );
}
