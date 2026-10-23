import type { Metadata } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';
import './globals.css';

// OFL-licensed Thai typeface (BRAND-01: fonts must be licensed for use).
const thai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-thai',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SCM ศูนย์บริหารคอนเทนต์ | สปสช.',
    template: '%s | SCM สปสช.',
  },
  description: 'ระบบบริหารคอนเทนต์และช่องทางโซเชียลมีเดีย สำนักงานหลักประกันสุขภาพแห่งชาติ',
  icons: { icon: '/nhso-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={thai.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
