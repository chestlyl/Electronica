import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Platform Admin — Engagement Engine',
  description: 'SaaS platform administration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
