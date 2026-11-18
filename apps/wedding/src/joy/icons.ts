/**
 * The editor's icons in Joy Phone's set: Phosphor, regular weight, in the text colour
 * (`currentColor`). Passed as `ui.icons`; Phosphor is MIT licensed.
 */
import type { EditorIcons } from '@bowerbirdjs/editor';
import arrowCounterClockwise from '@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw';
import arrowDown from '@phosphor-icons/core/assets/regular/arrow-down.svg?raw';
import arrowElbowLeftUp from '@phosphor-icons/core/assets/regular/arrow-elbow-left-up.svg?raw';
import arrowUUpLeft from '@phosphor-icons/core/assets/regular/arrow-u-up-left.svg?raw';
import arrowUUpRight from '@phosphor-icons/core/assets/regular/arrow-u-up-right.svg?raw';
import arrowUp from '@phosphor-icons/core/assets/regular/arrow-up.svg?raw';
import caretDown from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import caretRight from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import check from '@phosphor-icons/core/assets/regular/check.svg?raw';
import copy from '@phosphor-icons/core/assets/regular/copy.svg?raw';
import cursorClick from '@phosphor-icons/core/assets/regular/cursor-click.svg?raw';
import desktop from '@phosphor-icons/core/assets/regular/desktop.svg?raw';
import deviceMobile from '@phosphor-icons/core/assets/regular/device-mobile.svg?raw';
import deviceTablet from '@phosphor-icons/core/assets/regular/device-tablet.svg?raw';
import diamondsFour from '@phosphor-icons/core/assets/regular/diamonds-four.svg?raw';
import dotsSixVertical from '@phosphor-icons/core/assets/regular/dots-six-vertical.svg?raw';
import eye from '@phosphor-icons/core/assets/regular/eye.svg?raw';
import file from '@phosphor-icons/core/assets/regular/file.svg?raw';
import globe from '@phosphor-icons/core/assets/regular/globe.svg?raw';
import image from '@phosphor-icons/core/assets/regular/image.svg?raw';
import link from '@phosphor-icons/core/assets/regular/link.svg?raw';
import linkBreak from '@phosphor-icons/core/assets/regular/link-break.svg?raw';
import paragraph from '@phosphor-icons/core/assets/regular/paragraph.svg?raw';
import pencilSimple from '@phosphor-icons/core/assets/regular/pencil-simple.svg?raw';
import plus from '@phosphor-icons/core/assets/regular/plus.svg?raw';
import rows from '@phosphor-icons/core/assets/regular/rows.svg?raw';
import sidebarSimple from '@phosphor-icons/core/assets/regular/sidebar-simple.svg?raw';
import slidersHorizontal from '@phosphor-icons/core/assets/regular/sliders-horizontal.svg?raw';
import square from '@phosphor-icons/core/assets/regular/square.svg?raw';
import squaresFour from '@phosphor-icons/core/assets/regular/squares-four.svg?raw';
import textH from '@phosphor-icons/core/assets/regular/text-h.svg?raw';
import textT from '@phosphor-icons/core/assets/regular/text-t.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import uploadSimple from '@phosphor-icons/core/assets/regular/upload-simple.svg?raw';
import warningCircle from '@phosphor-icons/core/assets/regular/warning-circle.svg?raw';
import x from '@phosphor-icons/core/assets/regular/x.svg?raw';

export const JOY_ICONS: EditorIcons = {
  'panel-left': sidebarSimple,
  'panel-right': slidersHorizontal,
  undo: arrowUUpLeft,
  redo: arrowUUpRight,
  desktop: desktop,
  tablet: deviceTablet,
  mobile: deviceMobile,
  eye: eye,
  grip: dotsSixVertical,
  parent: arrowElbowLeftUp,
  'arrow-up': arrowUp,
  'arrow-down': arrowDown,
  copy: copy,
  trash: trash,
  close: x,
  'chevron-right': caretRight,
  'chevron-down': caretDown,
  plus: plus,
  check: check,
  section: rows,
  box: square,
  text: textT,
  heading: textH,
  paragraph: paragraph,
  image: image,
  link: link,
  button: cursorClick,
  component: diamondsFour,
  blocks: squaresFour,
  globe: globe,
  page: file,
  warning: warningCircle,
  upload: uploadSimple,
  edit: pencilSimple,
  unlink: linkBreak,
  reset: arrowCounterClockwise,
};
