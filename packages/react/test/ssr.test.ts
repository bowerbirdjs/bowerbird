import { BowerbirdEditor } from '@bowerbirdjs/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';

it('renders a placeholder on the server, so hydration matches', () => {
  const html = renderToString(createElement(BowerbirdEditor, { className: 'editor' }));
  expect(html).toBe('<div class="editor" data-bowerbird-editor=""></div>');
});
