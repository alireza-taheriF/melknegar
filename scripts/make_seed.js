// Builds SEED_DATA (base64 JSON with scrypt hashes). Usage:
// node scripts/make_seed.js '<json users with "password">'
process.env.MASTER_KEY ||= Buffer.alloc(32, 1).toString('base64');
const { hashPassword } = await import('../lib/crypto.js');
const input = JSON.parse(process.argv[2]);
for (const u of input.users) { u.passHash = await hashPassword(u.password); delete u.password; }
process.stdout.write(Buffer.from(JSON.stringify(input)).toString('base64'));
