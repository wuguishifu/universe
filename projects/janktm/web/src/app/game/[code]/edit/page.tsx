import { EditParty } from '../../../../modules/game/edit-party';

export default async function EditPartyPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <EditParty code={code.toUpperCase()} />;
}
