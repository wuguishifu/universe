import { RichTextField } from '@prismicio/client';
import { JSXMapSerializer, PrismicRichText } from '@prismicio/react';

import { Anchor } from './anchor';

type Props = Readonly<{
  children: React.ReactNode;
  text?: string;
}>;

function Heading1({ children }: Props) {
  return <h1>{children}</h1>;
}

function Heading2({ children }: Props) {
  return <h2>{children}</h2>;
}

function Heading3({ children }: Props) {
  return <h3>{children}</h3>;
}

function Heading4({ children }: Props) {
  return <h4>{children}</h4>;
}

function Heading5({ children }: Props) {
  return <h5>{children}</h5>;
}

function Heading6({ children }: Props) {
  return <h6>{children}</h6>;
}

function Paragraph({ children }: Props) {
  return <p>{children}</p>;
}

function Strong({ children }: Props) {
  return <strong className="font-semibold">{children}</strong>;
}

const richTextComponentMap: JSXMapSerializer = {
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  heading4: Heading4,
  heading5: Heading5,
  heading6: Heading6,
  paragraph: Paragraph,
  strong: Strong,
  hyperlink: Anchor,
};

export function RichText({ content }: { content: RichTextField }) {
  return <PrismicRichText field={content} components={richTextComponentMap} />;
}
