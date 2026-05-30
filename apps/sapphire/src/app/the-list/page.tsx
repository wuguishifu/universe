import { Section } from '../../modules/layout/section';

import { ReadingList } from './components/reading-list';


export default function TheList() {
  return (
    <main className="flex flex-col gap-2">
      <Section>
        <h2>the list</h2>
      </Section>
      <ReadingList />
    </main>
  );
}
