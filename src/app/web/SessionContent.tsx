export function SessionContent() {
  return <view id="web-content" className="flex-1 min-h-0" />;
}

// The first-frame fallback also stays empty in web preview.
export function TerminalContent(_props: { loading?: boolean }) {
  return <SessionContent />;
}
