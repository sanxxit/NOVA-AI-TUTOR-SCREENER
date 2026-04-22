import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nova — AI Tutor Screener',
  description: 'AI-powered 10-minute voice interview for tutor candidates.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div className="fixed top-0 left-0 z-50 h-14 flex items-center px-6 pointer-events-none select-none">
            <span className="text-base font-black tracking-widest text-slate-900 dark:text-white">
              NOVA
            </span>
          </div>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
