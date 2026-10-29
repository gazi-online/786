import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata = {
  title: 'WalletSync — Retailer Dashboard',
  description: 'Read-only sync of your recharge-portal transaction history.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 antialiased selection:bg-blue-500 selection:text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
