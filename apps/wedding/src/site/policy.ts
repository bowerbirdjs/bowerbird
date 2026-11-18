import type { DocView } from '@bowerbirdjs/core';
import {
  createPolicy,
  type Issue,
  type Policy,
  type PolicyOptions,
  sectionRootOf,
} from '@bowerbirdjs/core';

/** Most photos a gallery holds. */
export const MAX_GALLERY = 24;

/**
 * Structured editing: hosts (and agents) compose whole blocks. Sections can be added, moved,
 * duplicated and removed at page level; the parts inside a block stay where the block puts them,
 * except gallery photos, which can be added, reordered and removed. The look comes from designs,
 * so there is no custom CSS. Everyone gets the same rules, people and agents alike.
 */
export function eventPolicy(options: PolicyOptions = {}): Policy {
  const base = createPolicy({ protectHumanEdits: 'confirm', ...options });
  const refuse = (message: string, hint?: string, nodeId?: string): Issue => ({
    code: 'policy',
    message,
    ...(hint ? { hint } : {}),
    ...(nodeId ? { nodeId } : {}),
  });
  const isSectionRoot = (view: DocView, id: string) => {
    const node = view.node(id);
    return !!node?.section && !!node.parent && view.node(node.parent)?.type === 'root';
  };
  /** A photo directly inside a gallery's images box. */
  const galleryPhoto = (view: DocView, id: string) => {
    const node = view.node(id);
    if (node?.type !== 'image' || !node.parent) return false;
    return (
      view.node(node.parent)?.part === 'images' &&
      sectionRootOf(view, id)?.section?.name === 'gallery'
    );
  };
  const galleryCount = (view: DocView, imagesBox: string) =>
    view.children(imagesBox).filter((n) => n.type === 'image').length;

  return {
    ...base,
    check(ctx) {
      const denied = base.check(ctx);
      if (denied) return denied;
      const { op, view } = ctx;
      switch (op.op) {
        case 'section.insert':
        case 'symbol.insert':
          return op.parent && view.node(op.parent)?.type !== 'root'
            ? refuse('Sections go on the page, not inside other sections.')
            : undefined;
        case 'node.insert': {
          const parent = view.node(op.parent);
          const photos =
            parent?.part === 'images' &&
            sectionRootOf(view, op.parent)?.section?.name === 'gallery';
          if (!photos || op.node.type !== 'image' || op.node.children?.length)
            return refuse(
              'Blocks keep their own parts; only photos can be added, to a gallery.',
              'Add a section from the library instead.',
              op.parent,
            );
          return galleryCount(view, op.parent) >= MAX_GALLERY
            ? refuse(`A gallery holds up to ${MAX_GALLERY} photos.`, undefined, op.parent)
            : undefined;
        }
        case 'node.duplicate':
          if (galleryPhoto(view, op.id)) {
            const box = view.node(op.id)!.parent!;
            return galleryCount(view, box) >= MAX_GALLERY
              ? refuse(`A gallery holds up to ${MAX_GALLERY} photos.`, undefined, op.id)
              : undefined;
          }
          return isSectionRoot(view, op.id)
            ? undefined
            : refuse('Only whole sections can be duplicated.', 'Select the section.', op.id);
        case 'node.remove':
          return isSectionRoot(view, op.id) || galleryPhoto(view, op.id)
            ? undefined
            : refuse(
                'Parts of a section can’t be removed; leave the text empty or remove the whole section.',
                undefined,
                op.id,
              );
        case 'node.move': {
          const node = view.node(op.id);
          const target =
            op.parent ??
            (op.before
              ? view.node(op.before)?.parent
              : op.after
                ? view.node(op.after)?.parent
                : node?.parent);
          if (isSectionRoot(view, op.id))
            return target && view.node(target)?.type === 'root'
              ? undefined
              : refuse('Sections stay on the page level.', undefined, op.id);
          if (galleryPhoto(view, op.id))
            return target === node?.parent
              ? undefined
              : refuse('Photos stay in their gallery.', undefined, op.id);
          return refuse(
            'Parts of a section stay where the section puts them.',
            'Move the whole section.',
            op.id,
          );
        }
        case 'style.set':
        case 'vars.set':
          return refuse(
            'The look comes from the design.',
            'Pick another design, or change the accent colour, corners or spacing.',
            op.id,
          );
        case 'symbol.create':
        case 'symbol.remove':
        case 'symbol.reset':
        case 'symbol.update':
        case 'symbol.detach':
          return refuse('Linked components aren’t part of event sites.');
        default:
          return undefined;
      }
    },
  };
}
