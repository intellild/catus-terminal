export function SessionContent() {
  return <view data-automation-id="web-content" className="flex-1 min-h-0" />;
}

// The first-frame fallback also stays empty in web preview.
export function PanelPlaceholder(_props: { loading?: boolean }) {
  return <SessionContent />;
}
