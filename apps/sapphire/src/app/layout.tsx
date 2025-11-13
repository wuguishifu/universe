import './global.css';
import { ParallaxBackground } from '../components/parallax-background';

export const metadata = {
  title: 'son of bo',
  description: 'i hope you enjoy your stay',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ParallaxBackground />
        {children}
      </body>
    </html>
  );
}
