import { LinksHighlighter } from '../../modules/links/links-highlighter';
import { Maintenance } from '../../modules/links/maintenance';
import { Tp } from '../../modules/links/tp';

export function SideColumn() {
  return (
    <>
      <Tp />
      <Maintenance />
      <LinksHighlighter />
    </>
  );
}
