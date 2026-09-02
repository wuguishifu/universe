import { Section } from '../../../modules/layout/section';
import { ConvertForm } from './components/convert-form';

export default function YoutubeToMp3Page() {
  return (
    <main className="flex flex-col gap-2">
      <Section>
        <h2>youtube to mp3</h2>
      </Section>
      <Section>
        <ConvertForm />
      </Section>
    </main>
  );
}
