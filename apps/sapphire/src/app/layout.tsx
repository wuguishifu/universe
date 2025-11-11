import './global.css';

export const metadata = {
  title: 'son of bo',
  description: 'i hope you enjoy your stay',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
