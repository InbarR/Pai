import React from 'react';

const TYPE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  doc: { bg: '#185ABD', color: '#fff', label: 'W' },
  ppt: { bg: '#C43E1C', color: '#fff', label: 'P' },
  xls: { bg: '#107C41', color: '#fff', label: 'X' },
  pdf: { bg: '#D93025', color: '#fff', label: 'PDF' },
  loop: { bg: '#6264A7', color: '#fff', label: 'L' },
  onenote: { bg: '#7719AA', color: '#fff', label: 'N' },
  visio: { bg: '#3955A3', color: '#fff', label: 'V' },
  url: { bg: '#4285F4', color: '#fff', label: 'URL' },
  video: { bg: '#FF6D00', color: '#fff', label: 'VID' },
  image: { bg: '#00897B', color: '#fff', label: 'IMG' },
  other: { bg: '#555', color: '#ccc', label: '?' },
};

export function FileTypeIcon({ type }: { type: string }) {
  const s = TYPE_STYLES[type] || TYPE_STYLES.other;
  return (
    <span className="file-type-badge" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}
