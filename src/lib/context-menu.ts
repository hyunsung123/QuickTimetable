import type { MenuAnchor } from '../types/calendar';
import { clamp } from './timetable';

export function contextMenuSize(labels: string[], fontScale = 1) {
  const scale = Math.max(1, Math.min(fontScale, 1.4));
  return { width: labels.reduce((width, label) => width + label.length * 15 * scale + 24, 0) + Math.max(0, labels.length - 1), height: Math.max(38, Math.ceil(24 * scale + 14)) };
}

export function contextMenuPosition(anchor: MenuAnchor, viewport: { width: number; height: number }, insets: { top: number; bottom: number; left: number; right: number }, menuWidth = 109, menuHeight = 38) {
  const minX = insets.left + 12;
  const maxX = Math.max(minX, viewport.width - insets.right - menuWidth - 12);
  const minY = insets.top + 8;
  const maxY = Math.max(minY, viewport.height - insets.bottom - menuHeight - 8);
  const center = clamp(anchor.x + anchor.width / 2, minX + 8, viewport.width - insets.right - 20);
  const above = anchor.y - menuHeight - 10;
  const placement = above >= minY ? 'above' : 'below';
  const left = clamp(center - menuWidth / 2, minX, maxX);
  const top = clamp(placement === 'above' ? above : anchor.y + anchor.height + 10, minY, maxY);
  return { left, top, tailLeft: clamp(center - left - 6, 12, menuWidth - 24), placement };
}
