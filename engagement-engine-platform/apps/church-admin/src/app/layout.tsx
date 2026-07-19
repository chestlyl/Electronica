import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Church Admin — Engagement Engine',
  description: 'Church administration',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
