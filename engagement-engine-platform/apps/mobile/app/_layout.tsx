// Layer 1 shell — authentication entry point
// Stack from expo-router has @types/react@18 vs @19 mismatch in monorepos;
// this will be resolved in Layer 2 when the mobile app is developed standalone.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Stack } = require('expo-router') as { Stack: React.ComponentType };
import React from 'react';

export default function RootLayout() {
  return <Stack />;
}
