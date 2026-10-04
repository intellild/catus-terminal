// A real PTY child shared by Lynx E2E and Rust session-rendering tests.
// Raw mode removes kernel echo; ANSI output, cursor and input are deterministic.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  throw new Error('fake-pty must run inside a PTY');
}
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let state = 'ready';
let input = '';

function draw() {
  const color = state === 'ready' ? 41 : 44;
  process.stdout.write(
    '\x1b[?25l\x1b[2J\x1b[H' +
      `\x1b[${color}m  FAKE PTY ${state.toUpperCase()}  \x1b[0m\r\n` +
      '\x1b[32mgreen\x1b[0m / \x1b[1mbold\x1b[0m / \x1b[4munderline\x1b[0m\r\n' +
      'UTF-8: 中文 / e\u0301 / 😀\r\n' +
      `SIZE ${process.stdout.columns}x${process.stdout.rows}\r\n` +
      `INPUT ${input}\r\n`,
  );
}

process.stdin.on('data', (text) => {
  for (const character of text) {
    if (character === '\x03') process.exit(0);
    if (character === '\r' || character === '\n') {
      if (input === 'update') state = 'updated';
      if (input === 'reset') state = 'ready';
      if (input === 'exit') process.exit(0);
      input = '';
    } else if (character === '\x7f') {
      input = [...input].slice(0, -1).join('');
    } else {
      input += character;
    }
  }
  draw();
});
process.stdout.on('resize', draw);
draw();
