// GitHub Actions only (smoke.sh): sends one file to clamd as the worker does, and prints its answer.
import('node:net').then(({ connect }) => {
  const [host, kind] = process.argv.slice(1);
  // The test file of the antivirus makers.
  const sick = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  const body = Buffer.from(kind === 'sick' ? sick : 'nothing');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  const socket = connect({ host, port: 3310 });
  let said = '';
  socket.setTimeout(20_000, () => process.exit(2));
  socket.on('error', () => process.exit(2));
  socket.on('data', (chunk) => (said += chunk));
  socket.on('end', () => process.stdout.write(`${said.replace(/\0/g, '').trim()}\n`));
  socket.on('connect', () => {
    socket.write('zINSTREAM\0');
    socket.write(size);
    socket.write(body);
    socket.end(Buffer.alloc(4));
  });
});
