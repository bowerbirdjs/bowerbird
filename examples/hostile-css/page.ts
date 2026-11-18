/** The example page, shared with the e2e test (which renders the same page as published HTML). */
export const PAGE_OPS = [
  { op: 'section.insert', section: 'nav' },
  { op: 'section.insert', section: 'hero', content: { heading: { text: 'Host CSS stays out' } } },
  // A node style that loses to compound section selectors unless node rules outrank them.
  { op: 'style.set', id: 'hero-1/actions', css: 'justify-content: flex-start' },
  { op: 'section.insert', section: 'features' },
  { op: 'section.insert', section: 'cta' },
];
