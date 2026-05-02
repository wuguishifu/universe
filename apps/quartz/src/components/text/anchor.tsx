import { RTLinkNode } from '@prismicio/client';
import Link from 'next/link';

type AnchorProps = {
  children: React.ReactNode;
  node: RTLinkNode;
};

const getTargetFromNode = (node: RTLinkNode) => {
  if (node.data.link_type === 'Web') {
    return node.data.target ?? '_top';
  }
  return '_top';
};

export function Anchor(props: AnchorProps) {
  const target = getTargetFromNode(props.node);
  const href = props.node.data.url ?? '#';

  return (
    <Link
      className="cursor-pointer text-blue underline-offset-4 hover:underline"
      href={href}
      target={target}
    >
      {props.children}
    </Link>
  );
}
