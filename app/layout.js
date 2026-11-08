import './globals.css';

export const metadata = { title: 'PlotBook', description: 'Plots, customers and installments in one ledger' };

export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
