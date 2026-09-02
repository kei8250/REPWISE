import type { Metadata } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import { SyncRecovery } from '@/components/workouts/sync-recovery';
import './globals.css';

const notoSansJP = Noto_Sans_JP({
  variable: '--font-noto-sans-jp',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'REPWISE — トレーニング記録・AIコーチ',
  description:
    '日々の筋力トレーニングを記録し、成長を可視化。次回目標と改善ポイントを提案するパーソナルコーチ。',
  openGraph: {
    title: 'REPWISE — 記録から、次の一歩が見える。',
    description:
      '日々のトレーニングを記録・分析し、次回目標と改善ポイントを提案。',
    type: 'website',
    locale: 'ja_JP',
    images: [
      {
        url: '/og.png',
        width: 1536,
        height: 1024,
        alt: 'REPWISE — 記録から、次の一歩が見える。',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'REPWISE — 記録から、次の一歩が見える。',
    description:
      '日々のトレーニングを記録・分析し、次回目標と改善ポイントを提案。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${notoSansJP.variable} antialiased`}>
        <SyncRecovery />
        {children}
      </body>
    </html>
  );
}
