import { Section } from '../../components/section';
import { AppItem, AppItemProps } from './components/app-item';

const apps: AppItemProps[] = [
  {
    title: 'gtools',
    type: 'command',
    command: 'curl -fsSL https://wuguishifu.dev/d/gtools | sh',
    homepage: 'https://github.com/wuguishifu/gtools',
  },
  {
    title: 'homework downloader',
    type: 'command',
    command: 'curl -fsSL https://wuguishifu.dev/d/hwdl | sh',
    homepage: 'https://github.com/wuguishifu/homework-downloader',
  },
];

export default function AppsPage() {
  return (
    <main className="flex flex-col gap-2">
      <Section>
        <h2>apps</h2>
      </Section>
      <Section>
        <div className="font-vga divide-y divide-white/5">
          {apps.map((app) => (
            <AppItem {...app} key={app.title} />
          ))}
        </div>
      </Section>
    </main>
  );
}
