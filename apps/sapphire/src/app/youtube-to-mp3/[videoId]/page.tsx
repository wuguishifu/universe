import { Section } from '../../../modules/layout/section';
import { ConversionStatus } from './components/conversion-status';

export default async function VideoConvertPage({
  params: paramsPromise,
}: PageProps<'/youtube-to-mp3/[videoId]'>) {
  const params = await paramsPromise;
  const videoId = params.videoId;

  return (
    <main className="flex flex-col gap-2">
      <Section>
        <h2>youtube to mp3</h2>
      </Section>
      <ConversionStatus videoId={videoId} />
    </main>
  );
}
