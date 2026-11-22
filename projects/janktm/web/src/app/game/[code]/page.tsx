import { PartyView } from '../../../modules/game/party-view';

export default async function PartyPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ code }, { created }] = await Promise.all([params, searchParams]);
  return <PartyView code={code.toUpperCase()} justCreated={created === '1'} />;
}
