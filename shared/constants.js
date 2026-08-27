// Shared between the background service worker and the side panel.

export const PALETTE = [
  { id: 'indigo', hex: '#6366f1' },
  { id: 'blue', hex: '#3b82f6' },
  { id: 'teal', hex: '#14b8a6' },
  { id: 'green', hex: '#22c55e' },
  { id: 'amber', hex: '#f59e0b' },
  { id: 'orange', hex: '#f97316' },
  { id: 'red', hex: '#ef4444' },
  { id: 'pink', hex: '#ec4899' },
  { id: 'purple', hex: '#a855f7' },
  { id: 'slate', hex: '#64748b' }
];

export const DEFAULT_SPACE_NAME = 'General';

// Stamped into storage on install/update so future format changes can
// migrate data instead of duck-typing. Writers must preserve fields they
// don't recognize — synced data may come from a newer version.
export const SCHEMA_VERSION = 1;
