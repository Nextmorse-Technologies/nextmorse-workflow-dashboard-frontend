import React from 'react';
import { useLocale } from '../i18n.js';

/* A dropdown made of plain buttons: the button shows the current
   choice, the panel lists the options. Unlike a native <select>,
   the panel is part of the page — a re-render cannot collapse it,
   and it stays open until a pick is made or the page is clicked.
   The dashboard's native dropdowns kept collapsing before a pick
   could land, on every form, so every picker in the dashboard uses
   this instead of <select>. */
export default function MenuPicker({ buttonLabel, options, open, onToggle, onPick, emptyText, disabled, ariaLabel, buttonClassName, wrapStyle }) {
  const { t } = useLocale();
  return (
    <div style={{ position: 'relative', ...(wrapStyle || {}) }}>
      <button
        type="button"
        className={(buttonClassName || 'form-control') + ' text-left d-flex justify-content-between align-items-center'}
        onClick={onToggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="text-truncate">{buttonLabel}</span>
        <span aria-hidden="true" className="ml-2">▾</span>
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={onToggle}
            aria-hidden="true"
          />
          <div
            className="list-group shadow"
            style={{
              position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%',
              maxHeight: 240, overflowY: 'auto', background: '#fff',
              border: '1px solid #dee2e6', borderRadius: 4, marginTop: 2,
            }}
          >
            {(options || []).length ? options.map((o) => (
              <button
                key={o.value}
                type="button"
                className="list-group-item list-group-item-action text-left"
                onClick={() => onPick(o.value)}
              >
                {o.label}
              </button>
            )) : (
              <div className="list-group-item text-muted">{emptyText || t('Nothing to pick.')}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
