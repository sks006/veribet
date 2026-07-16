const crypto = require('crypto');

function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'secp256k1'
  });

  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const privateKeyHex = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');

  console.log('--- GENERATED ORACLE KEYPAIR ---');
  console.log(`ORACLE_PUBLIC_KEY=${publicKeyHex}`);
  console.log(`ORACLE_PRIVATE_KEY=${privateKeyHex}`);
  console.log('--------------------------------');
}

generateKeys();
