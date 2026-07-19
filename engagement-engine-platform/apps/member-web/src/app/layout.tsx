import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Member Portal — Engagement Engine',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
